'use strict';

const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const fsp = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const { isPathInsideOrSame, resolveFsPath } = require('./shared/fs-path');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createSessionQuery } = require('./session-query');
const { createProjectQueryStoreBuilder } = require('./project-query-store');
const { createSourceDiagnostics } = require('./source-diagnostics');
const storage = require('./pi-storage');
const logical = require('./pi-logical');
const { buildPiEventDetail } = require('./pi-detail');

const SOURCE_KIND = 'pi';
function defaultPiHome() {
  let value = process.env.PI_CODING_AGENT_DIR;
  if (!value) return path.join(os.homedir(), '.pi', 'agent');
  // Match pi 1.4.0 config.getAgentDir()/utils/paths.normalizePath without
  // importing its runtime or changing other sources' path semantics.
  if (process.platform === 'win32' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
    const drive = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive) value = `${drive[1].toUpperCase()}:\\${(drive[2] || '').replaceAll('/', '\\')}`;
  }
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (value.startsWith('file://')) {
    try { return fileURLToPath(value); } catch {
      // All sources' defaults are prepared at server startup. An invalid pi
      // URL must not prevent opening another source; retain it for root diagnostics.
    }
  }
  return value;
}
function rootFor(sourceHome) { return path.resolve(sourceHome, 'sessions'); }
function report(error, filePath, callback, signal) {
  storage.abort(signal);
  if (error.name === 'AbortError') throw error;
  if (!/^PI_/.test(error.code || '') && !['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'ELOOP', 'INDEXED_SOURCE_STALE'].includes(error.code)) throw error;
  callback?.({ code: error.code || 'SOURCE_ARTIFACT_UNREADABLE', path: filePath, message: error.message });
}
function projectCarried(session) {
  const { rawEvents, logicalEvents, analysis, presentationIndexes, ...carried } = session;
  return structuredClone(carried);
}
function catalog(sessions) {
  const maps = { main: new Map(), protocol: new Map(), raw: new Map() };
  for (const session of sessions) {
    for (const event of session.logicalEvents) {
      const value = event.layer === 'protocol' ? event.subtype : event.kind;
      const map = maps[event.layer]; map.set(value, (map.get(value) || 0) + 1);
    }
    for (const raw of session.rawEvents) maps.raw.set(raw.payloadType, (maps.raw.get(raw.payloadType) || 0) + 1);
  }
  return Object.fromEntries(Object.entries(maps).map(([layer, map]) => [layer,
    [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }))]));
}
const piQuery = createSessionQuery({ schemaVersion: CANONICAL_SCHEMA_VERSION, rawRef: logical.piRawRef, eventKindCatalog: catalog });

async function parsePiSessionArtifact(filePath, relFile, _repoRoot, signal, options = {}) {
  const snapshot = await storage.readPiSnapshot(filePath, { ...options, signal });
  const document = storage.parsePiDocument(snapshot);
  return logical.sessionsFromPiDocument(document, relFile, options.leafId);
}

async function discoverPiProjects({ sourceHome, signal, onDiagnostic }) {
  const sessionsRoot = rootFor(sourceHome);
  const files = await storage.collectPiFiles(sessionsRoot, signal, onDiagnostic);
  const projects = new Map();
  for (const file of files) {
    storage.abort(signal);
    try {
      const document = storage.parsePiDocument(await storage.readPiSnapshot(file, { sessionsRoot, signal }));
      if (!document.header.cwd) continue;
      const repoRoot = resolveFsPath(document.header.cwd);
      const project = projects.get(repoRoot) || { repoRoot, sessionCount: 0, updatedAt: '', bytes: 0, exists: false, source: 'pi-sessions' };
      project.sessionCount += document.invalidTree ? 1 : Math.max(document.leaves.length, 1);
      project.bytes += document.acceptedBytes;
      const updatedAt = logical.lastRecordedTimestamp(document.entries, document.header.timestamp);
      if (updatedAt > project.updatedAt) project.updatedAt = updatedAt;
      projects.set(repoRoot, project);
    } catch (error) { report(error, file, onDiagnostic, signal); }
  }
  for (const project of projects.values()) {
    try { project.exists = (await fsp.stat(project.repoRoot)).isDirectory(); } catch { project.exists = false; }
  }
  return [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.repoRoot.localeCompare(b.repoRoot));
}

const dependencyId = (entries) => `pi-dependencies:${storage.hash(JSON.stringify(entries))}`;
const snapshotId = (dependencySet, payload) => `pi-snapshot:${storage.hash(JSON.stringify({ dependencySet, payload }))}`;

async function buildPiIndex({ sourceHome, repoRoot, signal, onProgress, onDiagnostic }) {
  const started = Date.now();
  const sessionsRoot = rootFor(sourceHome); const resolvedRepo = resolveFsPath(repoRoot);
  const diagnostics = createSourceDiagnostics();
  const addDiagnostic = diagnostics.add;
  diagnostics.add = (value) => { addDiagnostic(value); onDiagnostic?.(value); };
  const files = await storage.collectPiFiles(sessionsRoot, signal, diagnostics.add);
  const candidates = [];
  let skippedFileCount = 0; let unknownFileCount = 0; let candidateBytes = 0;
  for (const file of files) {
    storage.abort(signal);
    try {
      const document = storage.parsePiDocument(await storage.readPiSnapshot(file, { sessionsRoot, signal }));
      if (!document.header.cwd || !isPathInsideOrSame(resolveFsPath(document.header.cwd), resolvedRepo)) {
        if (!document.header.cwd) unknownFileCount++; else skippedFileCount++;
        continue;
      }
      if (document.torn) diagnostics.add({ code: 'PI_TORN_TAIL', path: file, message: 'Uncommitted final bytes were excluded from the indexed snapshot.' });
      if (document.invalidTree) diagnostics.add({ code: 'PI_TREE_INVALID', path: file, message: 'Invalid ancestry retained as Protocol/Raw evidence.' });
      candidateBytes += document.acceptedBytes;
      candidates.push({ header: { id: document.header.id },
        acceptedSnapshot: { acceptedBytes: document.acceptedBytes, digest: document.digest, fileIdentity: document.fileIdentity },
        sourceFile: path.relative(sessionsRoot, file).replace(/\\/g, '/') });
    } catch (error) { report(error, file, diagnostics.add, signal); skippedFileCount++; }
  }
  // Duplicate physical session identity is ambiguous. Exclude both copies rather
  // than silently overwrite a Session or route an old link to another artifact.
  const counts = new Map();
  for (const { header } of candidates) counts.set(header.id, (counts.get(header.id) || 0) + 1);
  const builder = createProjectQueryStoreBuilder({ signal, presentationForEvent: piQuery.projectQueryPresentation });
  const sessions = []; const sessionsById = new Map(); const materializationDependencies = new Map();
  const kindCounts = { main: new Map(), protocol: new Map(), raw: new Map() };
  let indexedFileCount = 0; let indexedBytes = 0; let eventCount = 0; let rawEventCount = 0;
  for (const { header, sourceFile, acceptedSnapshot } of candidates) {
    storage.abort(signal);
    if (counts.get(header.id) !== 1) {
      skippedFileCount++;
      diagnostics.add({ code: 'PI_SESSION_ID_AMBIGUOUS', path: sourceFile, message: 'Multiple files claim the same pi session id; neither is indexed.' });
      continue;
    }
    onProgress?.({ phase: 'parsing', sessionId: header.id });
    // Candidates carry identities, never the corpus's parsed messages. Replay
    // one admitted artifact at a time and release it after its query shards.
    let document;
    try {
      document = storage.parsePiDocument(await storage.readPiSnapshot(path.resolve(sessionsRoot, sourceFile),
        { sessionsRoot, acceptedSnapshot, signal }));
    } catch (error) { report(error, sourceFile, diagnostics.add, signal); skippedFileCount++; continue; }
    // Project one branch at a time. Keeping every full branch Session alive here
    // multiplies shared-prefix payloads before the bounded query shards own them.
    const branchSessions = logical.iteratePiSessions(document, sourceFile);
    const entries = [{ role: 'primary_transcript', pathIdentity: sourceFile, existence: 'present', kind: 'file',
      policy: 'accepted_prefix', acceptedBytes: document.acceptedBytes, lineCount: document.lines.length,
      digest: document.digest, directoryEntries: [], evidence: { fileIdentity: document.fileIdentity } }];
    const dependencySet = { schemaVersion: 1, id: dependencyId(entries), sourceKind: SOURCE_KIND, entries };
    materializationDependencies.set(dependencySet.id, dependencySet);
    for (const session of branchSessions) {
      const payload = { sourceFile, leafId: session.sourceDerivedId };
      const descriptor = { schemaVersion: 1, dependencySetId: dependencySet.id,
        sourceSnapshotId: snapshotId(dependencySet, payload), payload };
      const queryProjectionDigest = await builder.addSessionAsync(session);
      const indexed = { ...projectCarried(session), materializationDescriptor: descriptor, queryShardId: session.id, queryProjectionDigest };
      sessions.push(indexed); sessionsById.set(indexed.id, indexed);
      const kinds = catalog([session]);
      for (const layer of Object.keys(kindCounts)) for (const item of kinds[layer]) kindCounts[layer].set(item.value, (kindCounts[layer].get(item.value) || 0) + item.count);
      eventCount += session.logicalEventCount; rawEventCount += session.rawEventCount;
    }
    indexedFileCount++; indexedBytes += document.acceptedBytes;
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const eventKinds = Object.fromEntries(Object.entries(kindCounts).map(([layer, map]) => [layer,
    [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }))]));
  return { sourceKind: SOURCE_KIND, sourceHome: path.resolve(sourceHome), sourceRoot: sessionsRoot, sessionsRoot,
    repoRoot: resolvedRepo, generatedAt: new Date().toISOString(), sourceDiagnostics: diagnostics.summary,
    sessions, sessionsById, materializationDependencies, projectQueryStore: builder.finish(), eventKinds,
    legacyRawOwners: { schemaVersion: 1, sourceKind: SOURCE_KIND, entryCount: 0, accountedBytes: 2, payload: {} },
    totals: { fileCount: files.length, candidateFileCount: candidates.length, indexedFileCount, skippedFileCount, unknownFileCount,
      candidateBytes, indexedBytes, sessionCount: sessions.length, eventCount, rawEventCount, elapsedMs: Date.now() - started } };
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) throw new Error('Invalid pi materialization fields');
}
function validatePiMaterializationDescriptor({ materializationContext, indexedSession, descriptor, dependencySet }) {
  exactKeys(descriptor.payload, ['sourceFile', 'leafId']);
  const { sourceFile, leafId } = descriptor.payload;
  if (typeof sourceFile !== 'string' || !sourceFile || sourceFile !== indexedSession.sourceFile
      || path.isAbsolute(sourceFile) || !isPathInsideOrSame(path.resolve(materializationContext.sessionsRoot, sourceFile), materializationContext.sessionsRoot)
      || typeof leafId !== 'string' || !leafId || leafId !== indexedSession.sourceDerivedId
      || dependencySet.entries.length !== 1) throw new Error('Invalid pi branch descriptor');
  const entry = dependencySet.entries[0];
  exactKeys(entry, ['role', 'pathIdentity', 'existence', 'kind', 'policy', 'acceptedBytes', 'lineCount', 'digest', 'directoryEntries', 'evidence']);
  exactKeys(entry.evidence, ['fileIdentity']); exactKeys(entry.evidence.fileIdentity, ['device', 'inode']);
  if (entry.role !== 'primary_transcript' || entry.pathIdentity !== sourceFile || entry.existence !== 'present'
      || entry.kind !== 'file' || entry.policy !== 'accepted_prefix' || entry.acceptedBytes !== indexedSession.bytes
      || entry.lineCount !== indexedSession.lineCount || !/^[a-f0-9]{64}$/.test(entry.digest)
      || entry.directoryEntries.length !== 0 || !Object.values(entry.evidence.fileIdentity).every((v) => typeof v === 'string' && /^\d+$/.test(v))
      || dependencySet.id !== dependencyId(dependencySet.entries) || descriptor.dependencySetId !== dependencySet.id
      || descriptor.sourceSnapshotId !== snapshotId(dependencySet, descriptor.payload)) throw new Error('Invalid pi accepted-prefix dependency');
}
function validatePiLegacyRawOwnerIndex({ legacyRawOwners }) {
  exactKeys(legacyRawOwners.payload, []);
  if (legacyRawOwners.sourceKind !== SOURCE_KIND || legacyRawOwners.entryCount !== 0 || legacyRawOwners.accountedBytes !== 2) throw new Error('Invalid pi legacy Raw ownership');
}
function accepted(entry) { return { acceptedBytes: entry.acceptedBytes, digest: entry.digest, fileIdentity: entry.evidence.fileIdentity }; }

async function materializePiSession({ materializationContext, indexedSession, dependencySet, signal }) {
  const payload = indexedSession.materializationDescriptor.payload;
  const branches = await parsePiSessionArtifact(path.resolve(materializationContext.sessionsRoot, payload.sourceFile), payload.sourceFile,
    materializationContext.repoRoot, signal, { sessionsRoot: materializationContext.sessionsRoot,
      acceptedSnapshot: accepted(dependencySet.entries[0]), leafId: payload.leafId });
  const session = branches.find((item) => item.id === indexedSession.id);
  if (!session || session.rawEventCount !== indexedSession.rawEventCount || session.logicalEventCount !== indexedSession.logicalEventCount) throw storage.stale();
  return { ...session, materializationSnapshotId: indexedSession.materializationDescriptor.sourceSnapshotId };
}

async function snapshotForSession(index, session, signal) {
  const indexed = index.sessionsById.get(session.id);
  const descriptor = indexed?.materializationDescriptor;
  const dependency = descriptor && index.materializationDependencies.get(descriptor.dependencySetId);
  if (!dependency || indexed.sourceKind !== SOURCE_KIND) throw storage.stale();
  return storage.readPiSnapshot(path.resolve(index.sessionsRoot, descriptor.payload.sourceFile), {
    sessionsRoot: index.sessionsRoot, acceptedSnapshot: accepted(dependency.entries[0]), signal,
  });
}
async function readPiRawRecord(index, session, raw, options = {}) {
  if (!session.rawEvents.some((candidate) => candidate.rawId === raw.rawId && candidate.source.line === raw.source.line)) return null;
  const snapshot = await snapshotForSession(index, session, options.signal);
  const text = snapshot.lines[raw.source.line - 1];
  if (text === undefined) throw storage.stale();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* Preserve malformed bytes verbatim. */ }
  // The raw string is exact evidence. Bound its parsed companion as well so
  // HTTP JSON encoding cannot overflow on a record deeper than the JS stack.
  return { raw: text, parsed: logical.sanitizePiValue(parsed), rawId: raw.rawId, sourceKind: SOURCE_KIND, sourceLocator: raw.sourceLocator };
}

const piAdapter = {
  kind: SOURCE_KIND, label: 'pi', homeOption: 'piHome', homeLabel: 'pi agent directory',
  sessionLifecycle: 'indexed-materialized-v1',
  defaultHome: defaultPiHome,
  query: piQuery, discoverConfiguredProjects: async () => [], discoverProjects: discoverPiProjects,
  buildIndex: buildPiIndex, materializeSession: materializePiSession, buildEventDetail: buildPiEventDetail,
  readRawRecord: readPiRawRecord, validateMaterializationDescriptor: validatePiMaterializationDescriptor,
  validateLegacyRawOwnerIndex: validatePiLegacyRawOwnerIndex, validateMaterializedPrivateState() {},
  materializationContextFields: ['sessionsRoot'], materializedPrivateFields: [],
};

module.exports = { PI_SOURCE_KIND: SOURCE_KIND, piAdapter, buildPiIndex, discoverPiProjects, parsePiSessionArtifact,
  materializePiSession, readPiRawRecord, snapshotForSession, validatePiMaterializationDescriptor, buildPiEventDetail };
