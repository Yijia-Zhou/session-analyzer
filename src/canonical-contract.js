'use strict';

// Small adapter -> shared-runtime contract. This is deliberately structural:
// source adapters keep ownership of source-specific interpretation, locators,
// and raw payloads. The shared runtime only requires the identity and
// collection fields it actually consumes.
const CANONICAL_LAYERS = new Set(['main', 'protocol']);

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
  inspectDataProperty,
  validateCanonicalIndexFields,
  validateCanonicalSessionsProperty,
  validateCanonicalLogicalEventShape,
  validateCanonicalRawEventShape,
  validateCanonicalRawReferenceShape,
  validateCanonicalSessionShape,
};
