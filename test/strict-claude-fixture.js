'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { INDEXED_SESSION_COUNT_FIELDS } = require('../src/canonical-contract');
const { buildProjectQueryStore } = require('../src/project-query-store');
const { getSourceAdapter } = require('../src/source-adapters');

const SOURCE_KIND = 'claude-code';
const PROJECTION_FIELDS = [
  'projectAssociation',
  'parentSessionId',
  'parentSessionInferred',
  'forkedFromSessionId',
  'forkStorageMode',
  'forkedAt',
  'forkPointUuid',
  'forkContinuationState',
  'forkEvidence',
  'inheritedContext',
  'startedAt',
  'updatedAt',
];

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('base64url');
}

function emptyCounts(source) {
  return Object.fromEntries(INDEXED_SESSION_COUNT_FIELDS.map((field) => [
    field,
    Number.isSafeInteger(source?.[field]) && source[field] >= 0 ? source[field] : 0,
  ]));
}

function strictClaudeIndexFromComplete(index, options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || process.cwd());
  const query = getSourceAdapter(SOURCE_KIND).query;
  const completeSessions = index.sessions.map((session) => {
    session.sourceKind = SOURCE_KIND;
    for (const event of session.logicalEvents) event.sourceKind = SOURCE_KIND;
    for (const raw of session.rawEvents) raw.sourceKind = SOURCE_KIND;
    return session;
  });
  const projectQueryStore = buildProjectQueryStore(completeSessions, {
    presentationForEvent: query.projectQueryPresentation,
  });
  const materializationDependencies = new Map();
  const sessions = completeSessions.map((session) => {
    const indexed = {
      id: String(session.id || ''),
      sourceKind: SOURCE_KIND,
      sourceSessionId: String(session.sourceSessionId || session.id || ''),
      sourceDerivedId: String(session.sourceDerivedId || ''),
      sourceClientVersion: String(session.sourceClientVersion || ''),
      projectAssociation: String(session.projectAssociation || ''),
      title: String(session.title || ''),
      sourceFile: String(session.sourceFile || `${session.id}.jsonl`),
      agentNickname: String(session.agentNickname || ''),
      primarySessionMetaKind: String(session.primarySessionMetaKind || ''),
      derivedRunId: String(session.derivedRunId || ''),
      startedAt: String(session.startedAt || ''),
      updatedAt: String(session.updatedAt || ''),
      bytes: Number.isSafeInteger(session.bytes) && session.bytes >= 0 ? session.bytes : 0,
      lineCount: Number.isSafeInteger(session.lineCount) && session.lineCount >= 0 ? session.lineCount : 0,
      cwdSet: [...(session.cwdSet || [])].map(String),
      counts: emptyCounts(session.counts),
      rawEventCount: session.rawEvents.length,
      logicalEventCount: session.logicalEvents.length,
      parentSessionId: String(session.parentSessionId || ''),
      forkedFromSessionId: String(session.forkedFromSessionId || ''),
      forkStorageMode: String(session.forkStorageMode || ''),
      forkedAt: String(session.forkedAt || ''),
      forkPointUuid: String(session.forkPointUuid || ''),
      forkContinuationState: String(session.forkContinuationState || ''),
      supersededBySessionId: String(session.supersededBySessionId || ''),
      supersededAt: String(session.supersededAt || ''),
      supersededReason: String(session.supersededReason || ''),
      parentSessionInferred: Boolean(session.parentSessionInferred),
      forkEvidence: session.forkEvidence || null,
      inheritedContext: session.inheritedContext || null,
      summary: query.projectSessionMetadata(session).summary,
      derivedRelationship: session.derivedRelationship || null,
      subagentToolUseId: String(session.subagentToolUseId || ''),
      spawnDepth: Number.isSafeInteger(session.spawnDepth) && session.spawnDepth >= 0
        ? session.spawnDepth
        : null,
    };
    const projection = Object.fromEntries(PROJECTION_FIELDS.map((field) => [
      field,
      indexed[field],
    ]));
    projection.cwdSet = [...indexed.cwdSet];
    const entries = [
      {
        role: 'session_transcript',
        pathIdentity: indexed.sourceFile,
        existence: 'present',
        kind: 'file',
        policy: 'accepted_prefix',
        acceptedBytes: indexed.bytes,
        lineCount: indexed.lineCount,
        digest: '0'.repeat(64),
        directoryEntries: [],
        evidence: { fileIdentity: { device: 'fixture', inode: indexed.id } },
      },
      {
        role: 'directory_0',
        pathIdentity: '.',
        existence: 'present',
        kind: 'directory',
        policy: 'directory_snapshot',
        acceptedBytes: 0,
        lineCount: 0,
        digest: hash([]),
        directoryEntries: [],
        evidence: { fileIdentity: { device: 'fixture', inode: 'root' } },
      },
    ];
    const dependencySet = {
      schemaVersion: 1,
      id: `claude-dependency:${hash(entries)}`,
      sourceKind: SOURCE_KIND,
      entries,
    };
    const payload = { sourceFile: indexed.sourceFile, description: '', projection };
    indexed.materializationDescriptor = {
      schemaVersion: 1,
      dependencySetId: dependencySet.id,
      sourceSnapshotId: `claude-snapshot:${hash({ dependencySet, payload })}`,
      payload,
    };
    indexed.queryShardId = indexed.id;
    materializationDependencies.set(dependencySet.id, dependencySet);
    return indexed;
  });
  return {
    ...index,
    sourceKind: SOURCE_KIND,
    sourceRoot,
    sourceHome: sourceRoot,
    claudeHome: sourceRoot,
    sessions,
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
    projectQueryStore,
    materializationDependencies,
    legacyRawOwners: {
      schemaVersion: 1,
      sourceKind: SOURCE_KIND,
      entryCount: 0,
      accountedBytes: 2,
      payload: {},
    },
    eventKinds: index.eventKinds || { main: [], protocol: [], raw: [] },
    codeModeRequests: index.codeModeRequests || [],
  };
}

module.exports = { strictClaudeIndexFromComplete };
