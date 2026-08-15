'use strict';

// Small adapter -> shared-runtime contract. This is deliberately structural:
// source adapters keep ownership of source-specific interpretation, locators,
// and raw payloads. The shared runtime only requires the identity and
// collection fields it actually consumes.
const CANONICAL_LAYERS = new Set(['main', 'protocol']);
const INDEXED_SESSION_STRING_FIELDS = Object.freeze([
  'id',
  'sourceKind',
  'sourceSessionId',
  'sourceDerivedId',
  'sourceClientVersion',
  'projectAssociation',
  'title',
  'sourceFile',
  'agentNickname',
  'primarySessionMetaKind',
  'derivedRunId',
  'startedAt',
  'updatedAt',
]);
const INDEXED_SESSION_COUNT_FIELDS = Object.freeze([
  'turns',
  'messages',
  'userMessages',
  'assistantMessages',
  'reasoning',
  'toolCalls',
  'failedCommands',
  'issueEvents',
  'patches',
  'compactions',
  'aborts',
  'errors',
  'protocol',
  'planArtifacts',
  'planEvents',
]);
const INDEXED_SESSION_RELATIONSHIP_STRING_FIELDS = Object.freeze([
  'parentSessionId',
  'forkedFromSessionId',
  'forkStorageMode',
  'forkedAt',
  'forkPointUuid',
  'forkContinuationState',
  'supersededBySessionId',
  'supersededAt',
  'supersededReason',
]);
const INDEXED_SESSION_OPTIONAL_FIELDS = Object.freeze([
  'derivedRelationship',
  'subagentToolUseId',
  'spawnDepth',
]);
const INDEXED_SESSION_CARRIED_FIELDS = Object.freeze([
  ...INDEXED_SESSION_STRING_FIELDS,
  'bytes',
  'lineCount',
  'cwdSet',
  'counts',
  'rawEventCount',
  'logicalEventCount',
  ...INDEXED_SESSION_RELATIONSHIP_STRING_FIELDS,
  'parentSessionInferred',
  'forkEvidence',
  'inheritedContext',
  'summary',
  ...INDEXED_SESSION_OPTIONAL_FIELDS,
]);
const INDEXED_SESSION_ALLOWED_FIELDS = new Set([
  ...INDEXED_SESSION_CARRIED_FIELDS,
  'materializationDescriptor',
  'queryShardId',
]);
const STRICT_INDEXED_FORBIDDEN_FIELDS = Object.freeze([
  'rawEvents',
  'logicalEvents',
  'analysis',
  'presentationIndexes',
  '_logicalEvents',
  '_canonicalRawDigests',
  '_reviewMarkers',
]);
const MATERIALIZED_ALWAYS_FORBIDDEN_PRIVATE_FIELDS = new Set([
  '_logicalEvents',
  '_canonicalRawDigests',
  '_reviewMarkers',
]);
const MATERIALIZED_SESSION_ALLOWED_PUBLIC_FIELDS = new Set([
  ...INDEXED_SESSION_CARRIED_FIELDS,
  'materializationSnapshotId',
  'rawEvents',
  'logicalEvents',
  'analysis',
  'presentationIndexes',
]);
const MATERIALIZED_ANALYSIS_FIELDS = Object.freeze([
  'sessionId',
  'title',
  'counts',
  'toolUsage',
  'failedCommands',
  'slowCommands',
  'patchedFiles',
  'tokenStats',
  'timelineStats',
  'protocolStats',
]);
const MATERIALIZED_PRESENTATION_INDEX_FIELDS = Object.freeze([
  'codeModeDeclaredRequests',
]);
const CODE_MODE_REQUEST_EVIDENCE = 'declared_source';

const CANONICAL_CONTRACT = Object.freeze({
  index: Object.freeze([
    'sourceKind',
    'repoRoot',
    'sessions',
    'sessionsById',
  ]),
  session: Object.freeze([
    'id',
    'sourceKind',
    'rawEvents',
    'logicalEvents',
    'counts.messages',
    'counts.toolCalls',
    'counts.failedCommands',
  ]),
  logicalEvent: Object.freeze([
    'id',
    'sourceKind',
    'kind',
    'layer',
    'timestamp',
    'rawRefs',
  ]),
  rawEvent: Object.freeze([
    'rawId',
    'sourceKind',
  ]),
  rawReference: Object.freeze([
    'rawId',
  ]),
});

function contractError(owner, field, expectation) {
  const error = new Error(`Canonical ${owner}.${field} ${expectation}`);
  error.code = 'CANONICAL_CONTRACT_VIOLATION';
  return error;
}

function missingOwnership(owner) {
  const error = new Error(`Missing source ownership on ${owner}`);
  error.code = 'MISSING_SOURCE_OWNERSHIP';
  return error;
}

function ownershipMismatch(owner, expected, actual) {
  const error = new Error(`Source ownership mismatch on ${owner}: expected ${expected}, received ${actual}`);
  error.code = 'SOURCE_OWNERSHIP_MISMATCH';
  return error;
}

function requireObject(value, owner) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(owner, '<value>', 'must be an object');
  }
  return value;
}

function requireString(value, owner, field, { nonEmpty = false } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) {
    throw contractError(owner, field, nonEmpty ? 'must be a non-empty string' : 'must be a string');
  }
  return value;
}

function requireArray(value, owner, field) {
  if (!Array.isArray(value)) throw contractError(owner, field, 'must be an array');
  return value;
}

function requireNonNegativeNumber(value, owner, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw contractError(owner, field, 'must be a finite non-negative number');
  }
  return value;
}

function requireNonNegativeSafeInteger(value, owner, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw contractError(owner, field, 'must be a non-negative safe integer');
  }
  return value;
}

function requireBoolean(value, owner, field) {
  if (typeof value !== 'boolean') throw contractError(owner, field, 'must be a boolean');
  return value;
}

function requirePlainObject(value, owner, field = '<value>') {
  requireObject(value, owner);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(owner, field, 'must be a plain object');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw contractError(owner, field, 'must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw contractError(owner, `${field}.${key}`, 'must be an enumerable data property');
    }
  }
  return value;
}

function requireExactOwnKeys(value, expectedKeys, owner) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length
    || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw contractError(owner, '<keys>', `must contain exactly ${sortedExpected.join(', ')}`);
  }
}

function validateBoundedPlainValue(value, owner, limits = {}) {
  const state = {
    entries: 0,
    seen: new Set(),
    maxDepth: limits.maxDepth ?? 8,
    maxEntries: limits.maxEntries ?? 16_384,
    maxStringBytes: limits.maxStringBytes ?? 64 * 1024,
  };
  const visit = (current, depth, path) => {
    if (depth > state.maxDepth) throw contractError(owner, path, 'exceeds maximum depth');
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (Buffer.byteLength(current, 'utf8') > state.maxStringBytes) {
        throw contractError(owner, path, 'exceeds maximum string bytes');
      }
      state.entries += 1;
    } else if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw contractError(owner, path, 'must be finite');
      state.entries += 1;
    } else if (Array.isArray(current)) {
      if (state.seen.has(current)) throw contractError(owner, path, 'must be acyclic');
      state.seen.add(current);
      const keys = Reflect.ownKeys(current);
      const indexedDescriptors = new Map();
      for (const key of keys) {
        if (typeof key === 'symbol') throw contractError(owner, path, 'must not contain symbol properties');
        if (key === 'length') continue;
        if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= current.length) {
          throw contractError(owner, `${path}.${key}`, 'must not contain extra properties');
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
          throw contractError(owner, `${path}[${key}]`, 'must be an enumerable data property');
        }
        indexedDescriptors.set(Number(key), descriptor);
      }
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = indexedDescriptors.get(index);
        if (!descriptor) throw contractError(owner, `${path}[${index}]`, 'must not be sparse');
        visit(descriptor.value, depth + 1, `${path}[${index}]`);
      }
      state.seen.delete(current);
      state.entries += current.length;
    } else if (current && typeof current === 'object') {
      requirePlainObject(current, owner, path);
      if (state.seen.has(current)) throw contractError(owner, path, 'must be acyclic');
      state.seen.add(current);
      for (const [key, nested] of Object.entries(current)) {
        if (Buffer.byteLength(key, 'utf8') > state.maxStringBytes) {
          throw contractError(owner, `${path}.${key}`, 'has an overlong key');
        }
        visit(nested, depth + 1, `${path}.${key}`);
      }
      state.seen.delete(current);
      state.entries += Object.keys(current).length;
    } else {
      throw contractError(owner, path, 'must be a JSON-compatible plain value');
    }
    if (state.entries > state.maxEntries) throw contractError(owner, path, 'exceeds maximum entries');
  };
  visit(value, 0, '<value>');
  return value;
}

function requireCanonicalSourceKind(value, owner) {
  if (typeof value !== 'string' || value.trim() === '') throw missingOwnership(owner);
  const sourceKind = value.trim();
  if (sourceKind !== value || sourceKind !== sourceKind.toLowerCase()) {
    throw contractError(owner, 'sourceKind', 'must use the exact canonical spelling');
  }
  return sourceKind;
}

function validateCanonicalIndexFields(index) {
  requireObject(index, 'index');
  const sourceKind = requireCanonicalSourceKind(index.sourceKind, 'index');
  requireString(index.repoRoot, 'index', 'repoRoot', { nonEmpty: true });
  if (!(index.sessionsById instanceof Map)) {
    throw contractError('index', 'sessionsById', 'must be a Map');
  }
  return sourceKind;
}

function validateCanonicalSessionsProperty(index, { allowUninspectableSessions = false } = {}) {
  const property = inspectDataProperty(index, 'sessions');
  if (property.kind === 'missing') {
    throw contractError('index', 'sessions', 'must be an array');
  }
  if (property.kind === 'accessor') {
    if (!allowUninspectableSessions) {
      throw contractError('index', 'sessions', 'must be a data-property array');
    }
    return { inspectable: false, sessions: [] };
  }
  if (!Array.isArray(property.value)) throw contractError('index', 'sessions', 'must be an array');
  return { inspectable: true, sessions: property.value };
}

function validateCanonicalSessionShape(session, expectedSourceKind = '') {
  requireObject(session, 'session');
  requireString(session.id, 'session', 'id', { nonEmpty: true });
  const sourceKind = requireCanonicalSourceKind(session.sourceKind, `session ${session.id}`);
  if (expectedSourceKind && sourceKind !== expectedSourceKind) {
    throw ownershipMismatch(`session ${session.id}`, expectedSourceKind, sourceKind);
  }
  requireArray(session.rawEvents, `session ${session.id}`, 'rawEvents');
  requireArray(session.logicalEvents, `session ${session.id}`, 'logicalEvents');
  requireObject(session.counts, `session ${session.id}.counts`);
  requireNonNegativeNumber(session.counts.messages, `session ${session.id}`, 'counts.messages');
  requireNonNegativeNumber(session.counts.toolCalls, `session ${session.id}`, 'counts.toolCalls');
  requireNonNegativeNumber(session.counts.failedCommands, `session ${session.id}`, 'counts.failedCommands');
  return sourceKind;
}

function validateCanonicalIndexedSessionShape(
  session,
  expectedSourceKind = '',
  { allowResidentComplete = false } = {},
) {
  if (allowResidentComplete) return validateCanonicalSessionShape(session, expectedSourceKind);

  requirePlainObject(session, 'indexed session');
  const owner = `indexed session ${session.id || '<unknown>'}`;
  for (const field of Object.keys(session)) {
    if (!INDEXED_SESSION_ALLOWED_FIELDS.has(field)) {
      throw contractError(owner, field, 'is not an allowed indexed field');
    }
  }
  for (const field of STRICT_INDEXED_FORBIDDEN_FIELDS) {
    if (Object.hasOwn(session, field)) throw contractError(owner, field, 'must not be retained');
  }
  for (const field of INDEXED_SESSION_STRING_FIELDS) {
    requireString(session[field], owner, field, { nonEmpty: field === 'id' });
  }
  const sourceKind = requireCanonicalSourceKind(session.sourceKind, owner);
  if (expectedSourceKind && sourceKind !== expectedSourceKind) {
    throw ownershipMismatch(owner, expectedSourceKind, sourceKind);
  }
  requireNonNegativeSafeInteger(session.bytes, owner, 'bytes');
  requireNonNegativeSafeInteger(session.lineCount, owner, 'lineCount');
  const cwdSet = requireArray(session.cwdSet, owner, 'cwdSet');
  if (cwdSet.length > 16_384) throw contractError(owner, 'cwdSet', 'exceeds maximum entries');
  const cwdSeen = new Set();
  let cwdBytes = 0;
  for (const cwd of cwdSet) {
    requireString(cwd, owner, 'cwdSet entry');
    cwdBytes += Buffer.byteLength(cwd, 'utf8');
    if (cwdSeen.has(cwd)) throw contractError(owner, 'cwdSet', 'must be deduplicated');
    cwdSeen.add(cwd);
  }
  if (cwdBytes > 4 * 1024 * 1024) throw contractError(owner, 'cwdSet', 'exceeds maximum bytes');

  requirePlainObject(session.counts, `${owner}.counts`);
  requireExactOwnKeys(session.counts, INDEXED_SESSION_COUNT_FIELDS, `${owner}.counts`);
  for (const field of INDEXED_SESSION_COUNT_FIELDS) {
    requireNonNegativeSafeInteger(session.counts[field], owner, `counts.${field}`);
  }
  requireNonNegativeSafeInteger(session.rawEventCount, owner, 'rawEventCount');
  requireNonNegativeSafeInteger(session.logicalEventCount, owner, 'logicalEventCount');
  for (const field of INDEXED_SESSION_RELATIONSHIP_STRING_FIELDS) {
    requireString(session[field], owner, field);
  }
  requireBoolean(session.parentSessionInferred, owner, 'parentSessionInferred');
  for (const field of ['forkEvidence', 'inheritedContext']) {
    if (session[field] !== null) {
      validateBoundedPlainValue(session[field], `${owner}.${field}`);
      if (Buffer.byteLength(JSON.stringify(session[field]), 'utf8') > 256 * 1024) {
        throw contractError(owner, field, 'exceeds maximum accounted bytes');
      }
    }
  }

  requirePlainObject(session.summary, `${owner}.summary`);
  requireExactOwnKeys(
    session.summary,
    ['topTools', 'failedCommandCount', 'patchedFiles', 'protocolCount'],
    `${owner}.summary`,
  );
  const topTools = requireArray(session.summary.topTools, owner, 'summary.topTools');
  const patchedFiles = requireArray(session.summary.patchedFiles, owner, 'summary.patchedFiles');
  if (topTools.length > 5) throw contractError(owner, 'summary.topTools', 'must contain at most 5 entries');
  if (patchedFiles.length > 5) throw contractError(owner, 'summary.patchedFiles', 'must contain at most 5 entries');
  topTools.forEach((entry, index) => {
    requirePlainObject(entry, `${owner}.summary.topTools[${index}]`);
    validateBoundedPlainValue(entry, `${owner}.summary.topTools[${index}]`);
  });
  patchedFiles.forEach((entry, index) => validateBoundedPlainValue(entry, `${owner}.summary.patchedFiles[${index}]`));
  requireNonNegativeSafeInteger(session.summary.failedCommandCount, owner, 'summary.failedCommandCount');
  requireNonNegativeSafeInteger(session.summary.protocolCount, owner, 'summary.protocolCount');
  if (Buffer.byteLength(JSON.stringify(session.summary), 'utf8') > 256 * 1024) {
    throw contractError(owner, 'summary', 'exceeds maximum accounted bytes');
  }

  requirePlainObject(session.materializationDescriptor, `${owner}.materializationDescriptor`);
  requireExactOwnKeys(
    session.materializationDescriptor,
    ['schemaVersion', 'dependencySetId', 'sourceSnapshotId', 'payload'],
    `${owner}.materializationDescriptor`,
  );
  if (session.materializationDescriptor.schemaVersion !== 1) {
    throw contractError(owner, 'materializationDescriptor.schemaVersion', 'must equal 1');
  }
  requireString(
    session.materializationDescriptor.dependencySetId,
    owner,
    'materializationDescriptor.dependencySetId',
    { nonEmpty: true },
  );
  requireString(
    session.materializationDescriptor.sourceSnapshotId,
    owner,
    'materializationDescriptor.sourceSnapshotId',
    { nonEmpty: true },
  );
  validateBoundedPlainValue(session.materializationDescriptor.payload, `${owner}.materializationDescriptor.payload`);
  if (Buffer.byteLength(JSON.stringify(session.materializationDescriptor), 'utf8') > 512 * 1024) {
    throw contractError(owner, 'materializationDescriptor', 'exceeds maximum accounted bytes');
  }
  requireString(session.queryShardId, owner, 'queryShardId', { nonEmpty: true });
  if (session.queryShardId !== session.id) throw contractError(owner, 'queryShardId', 'must equal id');

  if (Object.hasOwn(session, 'derivedRelationship') && session.derivedRelationship !== null) {
    validateBoundedPlainValue(session.derivedRelationship, `${owner}.derivedRelationship`);
    if (Buffer.byteLength(JSON.stringify(session.derivedRelationship), 'utf8') > 256 * 1024) {
      throw contractError(owner, 'derivedRelationship', 'exceeds maximum accounted bytes');
    }
  }
  if (Object.hasOwn(session, 'subagentToolUseId')) {
    requireString(session.subagentToolUseId, owner, 'subagentToolUseId');
  }
  if (Object.hasOwn(session, 'spawnDepth')
    && session.spawnDepth !== null) {
    requireNonNegativeSafeInteger(session.spawnDepth, owner, 'spawnDepth');
  }
  return sourceKind;
}

function validateCanonicalDependencySet(dependencySet, expectedSourceKind, expectedId = '') {
  requirePlainObject(dependencySet, 'materialization dependency set');
  requireExactOwnKeys(
    dependencySet,
    ['schemaVersion', 'id', 'sourceKind', 'entries'],
    'materialization dependency set',
  );
  if (dependencySet.schemaVersion !== 1) {
    throw contractError('materialization dependency set', 'schemaVersion', 'must equal 1');
  }
  requireString(dependencySet.id, 'materialization dependency set', 'id', { nonEmpty: true });
  if (expectedId && dependencySet.id !== expectedId) {
    throw contractError('materialization dependency set', 'id', `must equal ${expectedId}`);
  }
  const sourceKind = requireCanonicalSourceKind(
    dependencySet.sourceKind,
    `materialization dependency set ${dependencySet.id}`,
  );
  if (expectedSourceKind && sourceKind !== expectedSourceKind) {
    throw ownershipMismatch(
      `materialization dependency set ${dependencySet.id}`,
      expectedSourceKind,
      sourceKind,
    );
  }
  const entries = requireArray(
    dependencySet.entries,
    `materialization dependency set ${dependencySet.id}`,
    'entries',
  );
  if (entries.length > 65_536) {
    throw contractError('materialization dependency set', 'entries', 'exceeds maximum entries');
  }
  const existenceValues = new Set(['present', 'absent']);
  const kindValues = new Set(['file', 'directory']);
  const policyValues = new Set(['accepted_prefix', 'exact', 'copied_value', 'directory_snapshot']);
  entries.forEach((entry, index) => {
    const owner = `materialization dependency set ${dependencySet.id}.entries[${index}]`;
    requirePlainObject(entry, owner);
    requireExactOwnKeys(entry, [
      'role',
      'pathIdentity',
      'existence',
      'kind',
      'policy',
      'acceptedBytes',
      'lineCount',
      'digest',
      'directoryEntries',
      'evidence',
    ], owner);
    requireString(entry.role, owner, 'role', { nonEmpty: true });
    requireString(entry.pathIdentity, owner, 'pathIdentity', { nonEmpty: true });
    if (!existenceValues.has(entry.existence)) {
      throw contractError(owner, 'existence', 'must be present or absent');
    }
    if (!kindValues.has(entry.kind)) throw contractError(owner, 'kind', 'must be file or directory');
    if (!policyValues.has(entry.policy)) throw contractError(owner, 'policy', 'is invalid');
    requireNonNegativeSafeInteger(entry.acceptedBytes, owner, 'acceptedBytes');
    requireNonNegativeSafeInteger(entry.lineCount, owner, 'lineCount');
    requireString(entry.digest, owner, 'digest');
    const directoryEntries = requireArray(entry.directoryEntries, owner, 'directoryEntries');
    directoryEntries.forEach((value) => requireString(value, owner, 'directoryEntries entry'));
    if (entry.evidence !== null) {
      validateBoundedPlainValue(entry.evidence, `${owner}.evidence`, {
        maxEntries: 65_536,
      });
    }
    if (entry.existence === 'absent'
      && (entry.acceptedBytes !== 0
        || entry.lineCount !== 0
        || entry.digest !== ''
        || entry.directoryEntries.length !== 0)) {
      throw contractError(owner, '<absence>', 'must use zero/empty accepted values');
    }
  });
  const accountedBytes = Buffer.byteLength(JSON.stringify(dependencySet), 'utf8');
  if (accountedBytes > 4 * 1024 * 1024) {
    throw contractError('materialization dependency set', '<value>', 'exceeds maximum accounted bytes');
  }
  return accountedBytes;
}

function validateCanonicalLegacyRawOwnerIndex(legacyRawOwners, expectedSourceKind) {
  requirePlainObject(legacyRawOwners, 'legacy Raw owner index');
  requireExactOwnKeys(
    legacyRawOwners,
    ['schemaVersion', 'sourceKind', 'entryCount', 'accountedBytes', 'payload'],
    'legacy Raw owner index',
  );
  if (legacyRawOwners.schemaVersion !== 1) {
    throw contractError('legacy Raw owner index', 'schemaVersion', 'must equal 1');
  }
  const sourceKind = requireCanonicalSourceKind(
    legacyRawOwners.sourceKind,
    'legacy Raw owner index',
  );
  if (expectedSourceKind && sourceKind !== expectedSourceKind) {
    throw ownershipMismatch('legacy Raw owner index', expectedSourceKind, sourceKind);
  }
  requireNonNegativeSafeInteger(legacyRawOwners.entryCount, 'legacy Raw owner index', 'entryCount');
  requireNonNegativeSafeInteger(
    legacyRawOwners.accountedBytes,
    'legacy Raw owner index',
    'accountedBytes',
  );
  if (legacyRawOwners.entryCount > 1_000_000) {
    throw contractError('legacy Raw owner index', 'entryCount', 'exceeds maximum entries');
  }
  if (legacyRawOwners.accountedBytes > 64 * 1024 * 1024) {
    throw contractError('legacy Raw owner index', 'accountedBytes', 'exceeds maximum bytes');
  }
  validateBoundedPlainValue(legacyRawOwners.payload, 'legacy Raw owner index.payload', {
    maxEntries: 1_000_000,
  });
  const actualAccountedBytes = Buffer.byteLength(JSON.stringify(legacyRawOwners.payload), 'utf8');
  if (legacyRawOwners.accountedBytes !== actualAccountedBytes) {
    throw contractError(
      'legacy Raw owner index',
      'accountedBytes',
      `must equal the payload byte count ${actualAccountedBytes}`,
    );
  }
  return legacyRawOwners;
}

function validateCanonicalRawReferenceShape(reference, owner = 'raw reference') {
  requireObject(reference, owner);
  requireString(reference.rawId, owner, 'rawId', { nonEmpty: true });
  return reference;
}

function validateCanonicalRawEventShape(raw, expectedSourceKind = '') {
  requireObject(raw, 'raw event');
  requireString(raw.rawId, 'raw event', 'rawId', { nonEmpty: true });
  const sourceKind = requireCanonicalSourceKind(raw.sourceKind, `raw event ${raw.rawId}`);
  if (expectedSourceKind && sourceKind !== expectedSourceKind) {
    throw ownershipMismatch(`raw event ${raw.rawId}`, expectedSourceKind, sourceKind);
  }
  return sourceKind;
}

function validateCanonicalLogicalEventShape(event, expectedSourceKind = '') {
  requireObject(event, 'logical event');
  requireString(event.id, 'logical event', 'id', { nonEmpty: true });
  const sourceKind = requireCanonicalSourceKind(event.sourceKind, `logical event ${event.id}`);
  if (expectedSourceKind && sourceKind !== expectedSourceKind) {
    throw ownershipMismatch(`logical event ${event.id}`, expectedSourceKind, sourceKind);
  }
  requireString(event.kind, `logical event ${event.id}`, 'kind', { nonEmpty: true });
  requireString(event.layer, `logical event ${event.id}`, 'layer', { nonEmpty: true });
  if (!CANONICAL_LAYERS.has(event.layer)) {
    throw contractError(`logical event ${event.id}`, 'layer', 'must be main or protocol');
  }
  requireString(event.timestamp, `logical event ${event.id}`, 'timestamp');
  const rawRefs = requireArray(event.rawRefs, `logical event ${event.id}`, 'rawRefs');
  rawRefs.forEach((reference, index) => validateCanonicalRawReferenceShape(
    reference,
    `logical event ${event.id}.rawRefs[${index}]`,
  ));
  return sourceKind;
}

function materializationContractError(message, cause) {
  const error = new Error(message);
  error.code = 'MATERIALIZATION_CONTRACT_VIOLATION';
  if (cause) error.cause = cause;
  return error;
}

function deepEqualPlainValue(left, right, seen = new Map()) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqualPlainValue(value, right[index], seen));
  }
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length
    || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => deepEqualPlainValue(left[key], right[key], seen));
}

function validateMaterializedAnalysis(analysis) {
  requirePlainObject(analysis, 'materialized session.analysis');
  requireExactOwnKeys(
    analysis,
    MATERIALIZED_ANALYSIS_FIELDS,
    'materialized session.analysis',
  );
  validateBoundedPlainValue(analysis, 'materialized session.analysis', {
    maxDepth: 32,
    maxEntries: 1_000_000,
    maxStringBytes: 16 * 1024 * 1024,
  });
}

function validateMaterializedPresentationIndexes(presentationIndexes, logicalEvents) {
  requirePlainObject(presentationIndexes, 'materialized session.presentationIndexes');
  requireExactOwnKeys(
    presentationIndexes,
    MATERIALIZED_PRESENTATION_INDEX_FIELDS,
    'materialized session.presentationIndexes',
  );
  const declaredRequests = presentationIndexes.codeModeDeclaredRequests;
  if (!(declaredRequests instanceof Map)
    || Object.getPrototypeOf(declaredRequests) !== Map.prototype
    || Reflect.ownKeys(declaredRequests).length !== 0) {
    throw contractError(
      'materialized session.presentationIndexes',
      'codeModeDeclaredRequests',
      'must be a plain Map without custom properties',
    );
  }
  const logicalIds = new Set(logicalEvents.map((event) => event.id));
  for (const [eventId, fact] of Map.prototype.entries.call(declaredRequests)) {
    requireString(eventId, 'materialized session.presentationIndexes', 'eventId', { nonEmpty: true });
    if (!logicalIds.has(eventId)) {
      throw contractError(
        'materialized session.presentationIndexes',
        'eventId',
        `must identify an owned Logical Event: ${eventId}`,
      );
    }
    requirePlainObject(fact, 'materialized session.presentationIndexes.codeModeDeclaredRequests');
    requireExactOwnKeys(
      fact,
      ['toolNames', 'requestEvidence'],
      'materialized session.presentationIndexes.codeModeDeclaredRequests fact',
    );
    requireArray(
      fact.toolNames,
      'materialized session.presentationIndexes.codeModeDeclaredRequests fact',
      'toolNames',
    );
    if (fact.toolNames.length === 0) {
      throw contractError(
        'materialized session.presentationIndexes.codeModeDeclaredRequests fact',
        'toolNames',
        'must not be empty',
      );
    }
    validateBoundedPlainValue(
      fact.toolNames,
      'materialized session.presentationIndexes.codeModeDeclaredRequests fact.toolNames',
    );
    const uniqueNames = new Set();
    for (const toolName of fact.toolNames) {
      requireString(
        toolName,
        'materialized session.presentationIndexes.codeModeDeclaredRequests fact',
        'toolNames entry',
        { nonEmpty: true },
      );
      if (uniqueNames.has(toolName)) {
        throw contractError(
          'materialized session.presentationIndexes.codeModeDeclaredRequests fact',
          'toolNames',
          'must contain unique names',
        );
      }
      uniqueNames.add(toolName);
    }
    if (fact.requestEvidence !== CODE_MODE_REQUEST_EVIDENCE) {
      throw contractError(
        'materialized session.presentationIndexes.codeModeDeclaredRequests fact',
        'requestEvidence',
        `must equal ${CODE_MODE_REQUEST_EVIDENCE}`,
      );
    }
  }
}

function validateCompleteSessionEventOwnership(session, expectedSourceKind, { strictReferences = false } = {}) {
  validateCanonicalSessionShape(session, expectedSourceKind);
  const rawById = new Map();
  for (const raw of session.rawEvents) {
    validateCanonicalRawEventShape(raw, expectedSourceKind);
    if (rawById.has(raw.rawId)) {
      throw contractError(`session ${session.id}`, 'rawEvents', `contains duplicate rawId ${raw.rawId}`);
    }
    rawById.set(raw.rawId, raw);
  }
  const logicalIds = new Set();
  for (const event of session.logicalEvents) {
    validateCanonicalLogicalEventShape(event, expectedSourceKind);
    if (logicalIds.has(event.id)) {
      throw contractError(`session ${session.id}`, 'logicalEvents', `contains duplicate id ${event.id}`);
    }
    logicalIds.add(event.id);
    for (const reference of event.rawRefs) {
      const raw = rawById.get(reference.rawId);
      if (!raw) {
        throw contractError(
          `logical event ${event.id}`,
          'rawRefs',
          `references missing raw event ${reference.rawId}`,
        );
      }
      validateCanonicalRawEventShape(raw, expectedSourceKind);
      if (strictReferences) {
        for (const field of ['sourceKind', 'sourceLocator']) {
          if (Object.hasOwn(reference, field)
            && !deepEqualPlainValue(reference[field], raw[field])) {
            throw contractError(
              `logical event ${event.id}`,
              `rawRefs.${field}`,
              `must equal owned raw event ${reference.rawId}`,
            );
          }
        }
      }
    }
  }
  return session;
}

function validateCanonicalMaterializedSessionShape(
  indexedSession,
  materializedSession,
  expectedSourceKind = '',
  {
    allowResidentComplete = false,
    index = null,
    allowedPrivateFields = [],
  } = {},
) {
  try {
    if (allowResidentComplete) {
      if (!index || !(index.sessionsById instanceof Map)) {
        throw contractError('materialized session', 'index', 'must own sessionsById');
      }
      if (materializedSession !== indexedSession
        || index.sessionsById.get(indexedSession?.id) !== indexedSession) {
        throw contractError(
          'materialized session',
          'identity',
          'must equal the resident indexed Session owned by the captured Index',
        );
      }
      validateCompleteSessionEventOwnership(materializedSession, expectedSourceKind);
      return materializedSession;
    }

    validateCanonicalIndexedSessionShape(indexedSession, expectedSourceKind);
    if (materializedSession === indexedSession) {
      throw contractError('materialized session', 'identity', 'must be distinct from the Indexed Session');
    }
    validateCompleteSessionEventOwnership(materializedSession, expectedSourceKind, {
      strictReferences: true,
    });
    requirePlainObject(materializedSession, 'materialized session');
    requireString(
      materializedSession.materializationSnapshotId,
      'materialized session',
      'materializationSnapshotId',
      { nonEmpty: true },
    );
    if (materializedSession.materializationSnapshotId
      !== indexedSession.materializationDescriptor.sourceSnapshotId) {
      throw contractError(
        'materialized session',
        'materializationSnapshotId',
        'must equal indexed materializationDescriptor.sourceSnapshotId',
      );
    }
    if (materializedSession.rawEvents.length !== indexedSession.rawEventCount) {
      throw contractError('materialized session', 'rawEvents.length', 'must equal indexed rawEventCount');
    }
    if (materializedSession.logicalEvents.length !== indexedSession.logicalEventCount) {
      throw contractError('materialized session', 'logicalEvents.length', 'must equal indexed logicalEventCount');
    }
    for (const field of INDEXED_SESSION_CARRIED_FIELDS) {
      const indexedHasField = Object.hasOwn(indexedSession, field);
      if (!indexedHasField && INDEXED_SESSION_OPTIONAL_FIELDS.includes(field)) {
        if (Object.hasOwn(materializedSession, field)) {
          throw contractError('materialized session', field, 'must remain absent when absent from Indexed Session');
        }
        continue;
      }
      if (!Object.hasOwn(materializedSession, field)
        || !deepEqualPlainValue(materializedSession[field], indexedSession[field])) {
        throw contractError('materialized session', field, 'must equal the Indexed Session copied fact');
      }
    }
    validateMaterializedAnalysis(materializedSession.analysis);
    validateMaterializedPresentationIndexes(
      materializedSession.presentationIndexes,
      materializedSession.logicalEvents,
    );
    const allowedPrivate = new Set(allowedPrivateFields);
    for (const key of Object.keys(materializedSession)) {
      if (MATERIALIZED_SESSION_ALLOWED_PUBLIC_FIELDS.has(key)) continue;
      if (MATERIALIZED_ALWAYS_FORBIDDEN_PRIVATE_FIELDS.has(key)
        || !key.startsWith('_')
        || !allowedPrivate.has(key)) {
        throw contractError('materialized session', key, 'is not an allowed Materialized Session field');
      }
    }
    return materializedSession;
  } catch (error) {
    if (error?.code === 'MATERIALIZATION_CONTRACT_VIOLATION') throw error;
    throw materializationContractError(`Materialized Session validation failed: ${error.message}`, error);
  }
}

function inspectDataProperty(value, property) {
  let current = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (!descriptor) {
      current = Object.getPrototypeOf(current);
      continue;
    }
    if (descriptor.get || descriptor.set) return { kind: 'accessor', value: undefined };
    return { kind: 'data', value: descriptor.value };
  }
  return { kind: 'missing', value: undefined };
}

module.exports = {
  CANONICAL_CONTRACT,
  INDEXED_SESSION_COUNT_FIELDS,
  INDEXED_SESSION_STRING_FIELDS,
  inspectDataProperty,
  validateCanonicalIndexFields,
  validateCanonicalDependencySet,
  validateCanonicalIndexedSessionShape,
  validateCanonicalLegacyRawOwnerIndex,
  validateCanonicalMaterializedSessionShape,
  validateCanonicalSessionsProperty,
  validateCanonicalLogicalEventShape,
  validateCanonicalRawEventShape,
  validateCanonicalRawReferenceShape,
  validateCanonicalSessionShape,
};
