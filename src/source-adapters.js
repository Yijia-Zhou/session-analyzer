'use strict';

const codex = require('./codex');
const claude = require('./claude');
const { buildClaudeEventDetail } = require('./claude-detail');

const SOURCE_KIND = Object.freeze({
  CODEX: 'codex',
  CLAUDE_CODE: 'claude-code',
});

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
    homeOption: 'codexHome',
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
    async readRawRecord(index, session, raw) {
      const value = await codex.readIndexedCodexRawRecord(index, session, raw);
      if (!value) return null;
      return {
        ...value,
        rawId: raw.rawId,
        sourceKind: SOURCE_KIND.CODEX,
        sourceLocator: raw.sourceLocator,
      };
    },
    async readImagePreview(index, sessionId, eventId, previewId) {
      return codex.readImagePreview(index, sessionId, eventId, previewId);
    },
    async readLegacyRawLine(index, file, line) {
      return codex.readIndexedCodexLegacyRawLine(index, file, line);
    },
  }],
  [SOURCE_KIND.CLAUDE_CODE, {
    kind: SOURCE_KIND.CLAUDE_CODE,
    homeOption: 'claudeHome',
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
    async readRawRecord(index, session, raw) {
      return claude.readClaudeRawRecord(index, session, raw);
    },
    async readImagePreview() {
      return { statusCode: 404, error: 'Image previews are not available for this transcript source' };
    },
    async readLegacyRawLine() {
      return null;
    },
  }],
]);

function getSourceAdapter(value) {
  return adapters.get(normalizeSourceKind(value)) || null;
}

function requireSourceAdapter(value) {
  const adapter = getSourceAdapter(value);
  if (adapter) return adapter;
  const error = new Error(`Unsupported transcript source: ${value}`);
  error.code = 'UNSUPPORTED_SOURCE';
  throw error;
}

function supportedSourceKinds() {
  return [...adapters.keys()];
}

function adapterForSession(session, fallbackKind = SOURCE_KIND.CODEX) {
  return requireSourceAdapter(session?.sourceKind || fallbackKind);
}

async function buildEventDetailForSession(index, session, eventId, layer, options = {}) {
  return adapterForSession(session, index?.sourceKind).buildEventDetail(index, session, eventId, layer, options);
}

async function readIndexedRawRecord(index, session, rawId) {
  const raw = session?.rawEvents?.find((candidate) => candidate.rawId === rawId);
  if (!raw) return null;
  return adapterForSession(session, index?.sourceKind).readRawRecord(index, session, raw);
}

module.exports = {
  SOURCE_KIND,
  adapterForSession,
  buildEventDetailForSession,
  getSourceAdapter,
  normalizeSourceKind,
  readIndexedRawRecord,
  requireSourceAdapter,
  supportedSourceKinds,
};
