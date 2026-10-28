'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createSessionQuery } = require('./session-query');
const { createProjectQueryStoreBuilder } = require('./project-query-store');
const { createSourceDiagnostics } = require('./source-diagnostics');
const { registerIndexResource, attachIndexResource, withIndexResources } = require('./index-resources');
const storage = require('./opencode-storage');
const logical = require('./opencode-logical');
const { buildOpenCodeEventDetail } = require('./opencode-detail');

const SOURCE_KIND = 'opencode';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const dependencyId = (entries) => 'opencode-dependencies:' + hash(JSON.stringify(entries));
const snapshotId = (dependencies, payload) => 'opencode-snapshot:' + hash(JSON.stringify({
  mapperVersion: logical.MAPPER_VERSION, dependencies, payload,
}));
const query = createSessionQuery({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  rawRef: logical.openCodeRawRef,
  eventKindCatalog: logical.eventKindCatalog,
});

function stale(message = 'The captured OpenCode snapshot is unavailable or changed; rebuild the project.') {
  const error = new Error(message);
  error.code = 'INDEXED_SOURCE_STALE';
  error.statusCode = 409;
  return error;
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    throw new Error('Invalid OpenCode materialization descriptor');
  }
}
function carried(session) {
  const { rawEvents, logicalEvents, analysis, presentationIndexes, ...metadata } = session;
  return structuredClone(metadata);
}
function metadataFromDescriptor(descriptor, dependencySet) {
  const entry = dependencySet.entries[0];
  return { sessionId: descriptor.payload.sessionId, fileName: descriptor.payload.fileName,
    snapshotId: descriptor.payload.storageSnapshotId, bytes: entry.acceptedBytes, digest: entry.digest };
}

async function buildOpenCodeIndex({ sourceHome = storage.defaultOpenCodeHome(), repoRoot, signal, onProgress, onDiagnostic, limits, snapshotBase } = {}) {
  const started = Date.now();
  const diagnostics = createSourceDiagnostics();
  const report = (value) => { diagnostics.add(value); onDiagnostic?.(value); };
  const captured = await storage.captureOpenCodeProject({
    sourceHome, repoRoot, signal, limits, snapshotBase, onProgress, onDiagnostic: report,
  });
  const resource = registerIndexResource({
    label: 'OpenCode immutable project snapshot',
    dispose: () => captured.dispose(),
    ...(captured.disposeSync ? { disposeSync: () => captured.disposeSync() } : {}),
  });
  let builder;
  try {
    builder = createProjectQueryStoreBuilder({
      signal, presentationForEvent: query.projectQueryPresentation, shareTextRanges: true,
      // Enforce a byte ceiling before each derived-store write, including small
      // projects; the captured source and this disposable projection are separate budgets.
      memoryBytes: 0,
      maxBytes: limits?.maxQueryBytes ?? 256 * 1024 * 1024,
    });
    const sessions = [];
    const sessionsById = new Map();
    const materializationDependencies = new Map();
    const kinds = { main: new Map(), protocol: new Map(), raw: new Map() };
    let indexedBytes = 0;
    let eventCount = 0;
    let rawEventCount = 0;
    for (const meta of captured.sessions) {
      signal?.throwIfAborted();
      const snapshot = await resource.withReader(() => storage.readOpenCodeSnapshot(captured.snapshotRoot, meta, { signal }));
      const entries = [{
        role: 'opencode_session_snapshot', pathIdentity: meta.fileName,
        existence: 'present', kind: 'file', policy: 'exact',
        acceptedBytes: meta.bytes, lineCount: 0, digest: meta.digest,
        directoryEntries: [], evidence: {
          databaseIdentity: captured.source.identity, schemaProfile: captured.source.schemaProfile,
          storageSnapshotId: meta.snapshotId, mapperVersion: logical.MAPPER_VERSION,
        },
      }];
      const dependencySet = { schemaVersion: 1, id: dependencyId(entries), sourceKind: SOURCE_KIND, entries };
      const payload = { fileName: meta.fileName, sessionId: meta.sessionId, storageSnapshotId: meta.snapshotId };
      const descriptor = { schemaVersion: 1, dependencySetId: dependencySet.id,
        sourceSnapshotId: snapshotId(dependencySet, payload), payload };
      const session = logical.sessionFromOpenCodeSnapshot(snapshot, {
        sourceFile: captured.source.databasePath, snapshotId: descriptor.sourceSnapshotId, bytes: meta.bytes,
      });
      const queryProjectionDigest = await builder.addSessionAsync(session);
      const indexed = { ...carried(session), materializationDescriptor: descriptor,
        queryShardId: session.id, queryProjectionDigest };
      if (sessionsById.has(indexed.id)) throw stale('Duplicate OpenCode session identity in captured project.');
      sessions.push(indexed);
      sessionsById.set(indexed.id, indexed);
      materializationDependencies.set(dependencySet.id, dependencySet);
      for (const [layer, catalog] of Object.entries(logical.eventKindCatalog([session]))) {
        for (const item of catalog) kinds[layer].set(item.value, (kinds[layer].get(item.value) || 0) + item.count);
      }
      indexedBytes += meta.bytes;
      eventCount += session.logicalEventCount;
      rawEventCount += session.rawEventCount;
      onProgress?.({ phase: 'parsing', sessionId: meta.sessionId,
        candidateFileCount: captured.sessions.length, indexedFileCount: sessions.length,
        sessionCount: sessions.length, indexedBytes });
      if (Date.now() - started > (limits?.maxBuildMs ?? 60_000)) {
        const error = new Error('OpenCode project build time budget exceeded; the candidate Index was not published.');
        error.code = 'OPENCODE_BUDGET_EXCEEDED';
        error.statusCode = 413;
        throw error;
      }
    }
    signal?.throwIfAborted();
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const index = {
      sourceKind: SOURCE_KIND, sourceHome: path.resolve(sourceHome),
      sourceRoot: path.dirname(captured.source.databasePath), sourceDatabase: captured.source.databasePath,
      snapshotRoot: captured.snapshotRoot,
      repoRoot: captured.manifest.repoRoot, generatedAt: new Date().toISOString(),
      sourceDiagnostics: diagnostics.summary, sessions, sessionsById, materializationDependencies,
      projectQueryStore: builder.finish(),
      eventKinds: Object.fromEntries(Object.entries(kinds).map(([layer, counts]) => [
        layer, [...counts].sort((a, b) => a[0].localeCompare(b[0]))
          .map(([value, count]) => ({ value, label: value, count })),
      ])),
      legacyRawOwners: { schemaVersion: 1, sourceKind: SOURCE_KIND, entryCount: 0, accountedBytes: 2, payload: {} },
      totals: { fileCount: 1, candidateFileCount: captured.sessions.length,
        indexedFileCount: captured.sessions.length, skippedFileCount: 0, unknownFileCount: 0,
        candidateBytes: indexedBytes, indexedBytes, sessionCount: sessions.length,
        eventCount, rawEventCount, elapsedMs: Date.now() - started },
    };
    resource.seal();
    attachIndexResource(index, resource);
    return index;
  } catch (error) {
    builder?.dispose();
    await resource.dispose();
    if (error.code === 'PROJECT_QUERY_STORAGE_LIMIT') {
      error.code = 'OPENCODE_BUDGET_EXCEEDED';
      error.statusCode = 413;
    }
    throw error;
  }
}

function validateOpenCodeMaterializationDescriptor({ materializationContext, indexedSession, descriptor, dependencySet }) {
  exactKeys(descriptor.payload, ['fileName', 'sessionId', 'storageSnapshotId']);
  const payload = descriptor.payload;
  if (typeof payload.fileName !== 'string' || !/^[a-zA-Z0-9_-]+\.json$/.test(payload.fileName)
      || typeof payload.sessionId !== 'string' || payload.sessionId !== indexedSession.sourceSessionId
      || typeof payload.storageSnapshotId !== 'string' || !payload.storageSnapshotId
      || indexedSession.sourceFile !== materializationContext.sourceDatabase
      || dependencySet.entries.length !== 1) throw new Error('Invalid OpenCode snapshot descriptor');
  const entry = dependencySet.entries[0];
  exactKeys(entry.evidence, ['databaseIdentity', 'schemaProfile', 'storageSnapshotId', 'mapperVersion']);
  if (entry.role !== 'opencode_session_snapshot' || entry.kind !== 'file' || entry.policy !== 'exact'
      || entry.existence !== 'present' || entry.pathIdentity !== payload.fileName
      || entry.lineCount !== 0 || indexedSession.lineCount !== 0 || entry.acceptedBytes !== indexedSession.bytes
      || !/^[a-f0-9]{64}$/.test(entry.digest) || entry.directoryEntries.length !== 0
      || typeof entry.evidence.databaseIdentity !== 'string' || !entry.evidence.databaseIdentity
      || entry.evidence.schemaProfile !== 'opencode-2.1.4'
      || entry.evidence.mapperVersion !== logical.MAPPER_VERSION
      || entry.evidence.storageSnapshotId !== payload.storageSnapshotId
      || dependencySet.id !== dependencyId(dependencySet.entries)
      || descriptor.dependencySetId !== dependencySet.id
      || descriptor.sourceSnapshotId !== snapshotId(dependencySet, payload)) {
    throw new Error('Invalid OpenCode immutable snapshot dependency');
  }
}
function validateOpenCodeLegacyRawOwnerIndex({ legacyRawOwners }) {
  exactKeys(legacyRawOwners.payload, []);
  if (legacyRawOwners.sourceKind !== SOURCE_KIND || legacyRawOwners.entryCount !== 0 || legacyRawOwners.accountedBytes !== 2) {
    throw new Error('Invalid OpenCode legacy Raw ownership');
  }
}
async function materializeOpenCodeSession({ materializationContext, indexedSession, dependencySet, signal }) {
  const descriptor = indexedSession.materializationDescriptor;
  const snapshot = await storage.readOpenCodeSnapshot(materializationContext.snapshotRoot,
    metadataFromDescriptor(descriptor, dependencySet), { signal });
  if (snapshot.source.databasePath !== materializationContext.sourceDatabase
      || snapshot.source.identity !== dependencySet.entries[0].evidence.databaseIdentity) throw stale();
  const session = logical.sessionFromOpenCodeSnapshot(snapshot, {
    sourceFile: indexedSession.sourceFile, snapshotId: descriptor.sourceSnapshotId, bytes: indexedSession.bytes,
  });
  return { ...session, materializationSnapshotId: descriptor.sourceSnapshotId };
}
async function snapshotForSession(index, session, signal) {
  const indexed = index.sessionsById.get(session.id);
  const descriptor = indexed?.materializationDescriptor;
  const dependency = descriptor && index.materializationDependencies.get(descriptor.dependencySetId);
  if (!dependency || indexed.sourceKind !== SOURCE_KIND
      || session.materializationSnapshotId !== descriptor.sourceSnapshotId) throw stale();
  return withIndexResources(index, () => storage.readOpenCodeSnapshot(index.snapshotRoot,
    metadataFromDescriptor(descriptor, dependency), { signal }));
}
async function readOpenCodeRawRecord(index, session, raw, options = {}) {
  if (!session.rawEvents.some((candidate) => candidate === raw)) return null;
  const snapshot = await snapshotForSession(index, session, options.signal);
  const locator = raw.sourceLocator;
  if (locator.snapshotId !== session.materializationSnapshotId || locator.sessionID !== snapshot.session.id) throw stale();
  const row = locator.table === 'session_v2' ? snapshot.session
    : locator.table === 'session_message' ? snapshot.messages.find((item) => item.id === locator.messageID) : null;
  if (!row) throw stale();
  return { raw: JSON.stringify(row), parsed: logical.sanitizeOpenCodeValue(row),
    rawId: raw.rawId, sourceKind: SOURCE_KIND, sourceLocator: locator };
}
const opencodeAdapter = {
  kind: SOURCE_KIND, label: 'OpenCode', homeOption: 'opencodeHome', homeLabel: 'OpenCode data directory or SQLite database',
  sessionLifecycle: 'indexed-materialized-v1', defaultHome: storage.defaultOpenCodeHome, query,
  discoverConfiguredProjects: async () => [], discoverProjects: storage.discoverOpenCodeProjects,
  buildIndex: buildOpenCodeIndex, materializeSession: materializeOpenCodeSession,
  buildEventDetail: buildOpenCodeEventDetail, readRawRecord: readOpenCodeRawRecord,
  validateMaterializationDescriptor: validateOpenCodeMaterializationDescriptor,
  validateLegacyRawOwnerIndex: validateOpenCodeLegacyRawOwnerIndex,
  validateMaterializedPrivateState() {},
  materializationContextFields: ['snapshotRoot', 'sourceDatabase'], materializedPrivateFields: [],
};
module.exports = { opencodeAdapter, buildOpenCodeIndex,
  discoverOpenCodeProjects: storage.discoverOpenCodeProjects,
  materializeOpenCodeSession, snapshotForSession, readOpenCodeRawRecord,
  validateOpenCodeMaterializationDescriptor, buildOpenCodeEventDetail };
