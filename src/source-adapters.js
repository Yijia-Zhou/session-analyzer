'use strict';

const os = require('node:os');
const path = require('node:path');
const codex = require('./codex');
const claude = require('./claude');
const { buildClaudeEventDetail } = require('./claude-detail');
const {
  inspectDataProperty,
  validateCanonicalIndexFields,
  validateCanonicalLogicalEventShape,
  validateCanonicalRawEventShape,
  validateCanonicalSessionShape,
  validateCanonicalSessionsProperty,
} = require('./canonical-contract');
const { createSessionQuery } = require('./session-query');

const SOURCE_KIND = Object.freeze({
  CODEX: 'codex',
  CLAUDE_CODE: 'claude-code',
});

const claudeQuery = createSessionQuery();

function normalizeSourceKind(value) {
  const normalized = String(value || SOURCE_KIND.CODEX).trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claudecode' || normalized === 'claude_code') {
    return SOURCE_KIND.CLAUDE_CODE;
  }
  return normalized;
}

const adapters = new Map([
  [SOURCE_KIND.CODEX, {
    kind: SOURCE_KIND.CODEX,
    label: 'Codex',
    homeOption: 'codexHome',
    homeLabel: 'Codex home',
    defaultHome: () => path.join(os.homedir(), '.codex'),
    query: codex.query,
    async discoverConfiguredProjects(context) {
      return codex.discoverConfiguredProjects({ codexHome: context.sourceHome });
    },
    async discoverProjects(context) {
      return codex.discoverProjects({ codexHome: context.sourceHome });
    },
    async buildIndex(context) {
      return codex.buildIndex({
        ...context,
        codexHome: context.sourceHome,
      });
    },
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
    async readImagePreview(index, sessionId, eventId, previewId, options) {
      return codex.readImagePreview(index, sessionId, eventId, previewId, options);
    },
    resolveLegacyRaw(index, file, line) {
      return codex.resolveIndexedCodexLegacyRaw(index, file, line);
    },
    async readLegacyRaw(index, match, options) {
      return codex.readIndexedCodexRawRecord(index, match.session, match.raw, options);
    },
  }],
  [SOURCE_KIND.CLAUDE_CODE, {
    kind: SOURCE_KIND.CLAUDE_CODE,
    label: 'Claude Code',
    homeOption: 'claudeHome',
    homeLabel: 'Claude home',
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
      return claude.buildClaudeIndex({
        ...context,
        claudeHome: context.sourceHome,
      });
    },
    async buildEventDetail(index, session, eventId, layer, options) {
      return buildClaudeEventDetail(session, eventId, layer, options);
    },
    async readRawRecord(index, session, raw, options) {
      return claude.readClaudeRawRecord(index, session, raw, options);
    },
    async readImagePreview() {
      return { statusCode: 404, error: 'Image previews are not available for this transcript source' };
    },
    resolveLegacyRaw() {
      return null;
    },
    async readLegacyRaw() {
      return null;
    },
  }],
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

function validateIndexOwnership(index, { allowUninspectableSessions = false } = {}) {
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const sessionsById = index?.sessionsById;
  const sessionsPropertyDescriptor = inspectDataProperty(index, 'sessions');
  const validatedSessions = new Set();
  const listedSessionIds = new Set();
  const validateSession = (session, { fromArray = false, mapKey } = {}) => {
    const sessionKind = requireExplicitSourceKind(session?.sourceKind, `session ${session?.id || '<unknown>'}`);
    if (sessionKind !== indexKind) {
      const error = new Error(`Source ownership mismatch: index ${indexKind}, session ${session?.id || '<unknown>'} ${sessionKind}`);
      error.code = 'SOURCE_OWNERSHIP_MISMATCH';
      throw error;
    }
    if (!validatedSessions.has(session)) {
      validateCanonicalSessionShape(session, indexKind);
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
  return indexKind;
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
  if (requestedLayer === 'raw') {
    const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
    if (!raw) return null;
    validateCanonicalRawEventShape(raw, sessionSourceKind);
  } else {
    const event = session.logicalEvents.find((candidate) => (
      candidate.id === eventId && candidate.layer === requestedLayer
    ));
    if (!event) return null;
    validateCanonicalLogicalEventShape(event, sessionSourceKind);
    validateLogicalEventRawReferences(session, event, sessionSourceKind);
  }
  const adapter = adapterForSession(session);
  if (adapter.kind !== indexKind) {
    const error = new Error(`Source ownership mismatch: index ${indexKind}, session ${session?.id || '<unknown>'} ${adapter.kind}`);
    error.code = 'SOURCE_OWNERSHIP_MISMATCH';
    throw error;
  }
  return adapter.buildEventDetail(index, session, eventId, layer, options);
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
  return adapter.readImagePreview(index, session.id, eventId, previewId, {
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

async function readLegacyRawLineForIndex(index, file, line, options = {}) {
  const indexKind = requireExplicitSourceKind(index?.sourceKind, 'index');
  const adapter = requireSourceAdapter(indexKind);
  const match = adapter.resolveLegacyRaw(index, file, line);
  if (!match) return null;
  const sessionSourceKind = validateCanonicalSessionShape(match.session, indexKind);
  validateCanonicalRawEventShape(match.raw, sessionSourceKind);
  return adapter.readLegacyRaw(index, match, options);
}

module.exports = {
  SOURCE_KIND,
  adapterForSession,
  buildEventDetailForSession,
  getSourceAdapter,
  normalizeSourceKind,
  queryForIndex,
  readImagePreviewForSession,
  readIndexedRawRecord,
  readLegacyRawLineForIndex,
  requireSourceAdapter,
  requireExplicitSourceKind,
  supportedSourceOptions,
  supportedSourceKinds,
  validateIndexOwnership,
};
