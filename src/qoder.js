'use strict';

const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const { isPathInsideOrSame } = require('./shared/fs-path');
const { projectPathContains } = require('./shared/project-path');
const { createProjectPathContext, projectPathFor, projectSelection, projectContextIndexFields } = require('./project-path-context');
const { CANONICAL_SCHEMA_VERSION } = require('./shared/canonical-schema');
const { createSessionQuery } = require('./session-query');
const { createProjectQueryStoreBuilder } = require('./project-query-store');
const { createSourceDiagnostics } = require('./source-diagnostics');
const storage = require('./qoder-storage');
const logical = require('./qoder-logical');
const { buildQoderEventDetail } = require('./qoder-detail');
const { readQoderImagePreview } = require('./qoder-images');

const SOURCE_KIND = 'qoder';
function defaultQoderHome() { return path.join(os.homedir(), '.qoder-cn'); }
function rootFor(sourceHome) { return path.resolve(sourceHome, 'projects'); }
function report(error, filePath, callback, signal) {
  storage.abort(signal);
  if (error.name === 'AbortError') throw error;
  if (!/^QODER_/.test(error.code || '') && !['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'ELOOP', 'INDEXED_SOURCE_STALE'].includes(error.code)) throw error;
  callback?.({ code: error.code || 'SOURCE_ARTIFACT_UNREADABLE', path: filePath, message: error.message });
}
function projectCarried(session) {
  const { rawEvents, logicalEvents, analysis, presentationIndexes, ...carried } = session;
  return structuredClone(carried);
}
function catalog(sessions, options = {}) {
  const maps = { main: new Map(), protocol: new Map(), raw: new Map() };
  for (const session of sessions) {
    for (const event of session.logicalEvents) {
      const value = event.layer === 'protocol' ? event.subtype : event.kind;
      const map = maps[event.layer]; map.set(value, (map.get(value) || 0) + 1);
    }
    for (const raw of session.rawEvents) maps.raw.set(raw.payloadType, (maps.raw.get(raw.payloadType) || 0) + 1);
  }
  return Object.fromEntries(Object.entries(maps).map(([layer, map]) => [layer,
    [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value,
      label: value, count }))]));
}
const qoderQuery = createSessionQuery({ schemaVersion: CANONICAL_SCHEMA_VERSION, rawRef: logical.qoderRawRef, eventKindCatalog: catalog });

async function parseQoderSessionArtifact(filePath, relFile, _repoRoot, signal, options = {}) {
  const snapshot = await storage.readQoderSnapshot(filePath, { ...options, signal });
  const document = storage.parseQoderDocument(snapshot, relFile);
  return logical.makeQoderSession(document, relFile);
}

async function discoverQoderProjects(options) {
  const { signal, onDiagnostic } = options;
  const context = createProjectPathContext({ ...options, sourceKind: SOURCE_KIND });
  const sourceHome = context.sourceHome;
  const sessionsRoot = rootFor(sourceHome);
  const files = await storage.collectQoderFiles(sessionsRoot, signal, onDiagnostic);
  const projects = new Map();
  for (const file of files) {
    storage.abort(signal);
    try {
      const document = storage.parseQoderDocument(await storage.readQoderSnapshot(file, { sessionsRoot, signal }), path.relative(sessionsRoot, file));
      if (!document.cwd) continue;
      const projectPath = projectPathFor(document.cwd, context, file, onDiagnostic);
      if (projectPath.status !== 'valid') continue;
      const repoRoot = projectPath.path;
      const project = projects.get(projectPath.key) || { repoRoot, projectPath,
        projectPathPolicyId: context.digest, projectPathEvidence: [], legacyAssumption: false,
        sessionCount: 0, updatedAt: '', bytes: 0, exists: false, source: 'qoder-sessions' };
      project.projectPathEvidence = [...new Set([...project.projectPathEvidence, projectPath.evidence])].sort();
      project.legacyAssumption ||= projectPath.legacyAssumption;
      project.sessionCount += 1;
      project.bytes += document.acceptedBytes;
      const updatedAt = document.rows.map((row) => logical.iso(row.parsed?.timestamp)).filter(Boolean).at(-1) || '';
      if (updatedAt > project.updatedAt) project.updatedAt = updatedAt;
      projects.set(projectPath.key, project);
    } catch (error) { report(error, file, onDiagnostic, signal); }
  }
  for (const project of projects.values()) {
    try { project.exists = (await fsp.stat(project.repoRoot)).isDirectory(); } catch { project.exists = false; }
  }
  return [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.repoRoot.localeCompare(b.repoRoot));
}

const dependencyId = (entries) => `qoder-dependencies:${storage.hash(JSON.stringify(entries))}`;
const snapshotId = (dependencySet, payload) => `qoder-snapshot:${storage.hash(JSON.stringify({ dependencySet, payload }))}`;

async function buildQoderIndex(options) {
  const { repoRoot, signal, onProgress, onDiagnostic } = options;
  const context = createProjectPathContext({ ...options, sourceKind: SOURCE_KIND });
  const sourceHome = context.sourceHome;
  const selection = projectSelection(repoRoot, undefined, options.projectPathSemantics);
  const projectFields = { ...projectContextIndexFields(context, selection.path), projectPath: selection };
  const started = Date.now();
  const sessionsRoot = rootFor(sourceHome); const resolvedRepo = projectFields.projectPath.path;
  const diagnostics = createSourceDiagnostics();
  const addDiagnostic = diagnostics.add;
  diagnostics.add = (value) => { addDiagnostic(value); onDiagnostic?.(value); };
  const files = await storage.collectQoderFiles(sessionsRoot, signal, diagnostics.add);
  const candidates = [];
  let skippedFileCount = 0; let unknownFileCount = 0; let candidateBytes = 0;
  for (const file of files) {
    storage.abort(signal);
    const relative = path.relative(sessionsRoot, file);
    const sourceFile = relative.split(path.sep).join('/');
    try {
      const document = storage.parseQoderDocument(await storage.readQoderSnapshot(file, { sessionsRoot, signal }), relative);
      const projectPath = document.cwd && projectPathFor(document.cwd, context, file, diagnostics.add);
      if (!projectPath || !projectPathContains(projectPath, projectFields.projectPath)) {
        if (!document.cwd) unknownFileCount++; else skippedFileCount++;
        continue;
      }
      if (document.torn) diagnostics.add({ code: 'QODER_TORN_TAIL', path: file, message: 'Uncommitted final bytes were excluded from the indexed snapshot.' });
      candidateBytes += document.acceptedBytes;
      candidates.push({ header: { id: document.id, cwd: document.cwd },
        acceptedSnapshot: { acceptedBytes: document.acceptedBytes, digest: document.digest, fileIdentity: document.fileIdentity },
        // Normalize only host separators: a POSIX backslash is part of the
        // physical filename and must survive every later snapshot read.
        sourceFile });
    } catch (error) { report(error, file, diagnostics.add, signal); skippedFileCount++; }
  }
  const builder = createProjectQueryStoreBuilder({ signal, presentationForEvent: qoderQuery.projectQueryPresentation,
    shareTextRanges: true });
  try {
    const sessions = []; const sessionsById = new Map(); const materializationDependencies = new Map();
    const kindCounts = { main: new Map(), protocol: new Map(), raw: new Map() };
    let indexedFileCount = 0; let indexedBytes = 0; let eventCount = 0; let rawEventCount = 0;
    for (const { header, sourceFile, acceptedSnapshot } of candidates) {
      storage.abort(signal);
      onProgress?.({ phase: 'parsing', sessionId: header.id });
      // Replay one admitted artifact at a time; retained indexes contain no corpus messages.
      let document;
      try {
        document = storage.parseQoderDocument(await storage.readQoderSnapshot(path.resolve(sessionsRoot, sourceFile),
          { sessionsRoot, acceptedSnapshot, signal }), sourceFile);
      } catch (error) { report(error, sourceFile, diagnostics.add, signal); skippedFileCount++; continue; }
      const nativeSessions = [logical.makeQoderSession(document, sourceFile)];
      const entries = [{ role: 'primary_transcript', pathIdentity: sourceFile, existence: 'present', kind: 'file',
        policy: 'accepted_prefix', acceptedBytes: document.acceptedBytes, lineCount: document.lines.length,
        digest: document.digest, directoryEntries: [], evidence: { fileIdentity: document.fileIdentity } }];
      const dependencySet = { schemaVersion: 1, id: dependencyId(entries), sourceKind: SOURCE_KIND, entries };
      materializationDependencies.set(dependencySet.id, dependencySet);
      for (const session of nativeSessions) {
        const payload = { sourceFile, parentToolUseId: document.parentToolUseId };
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
      ...projectFields,
      repoRoot: resolvedRepo, generatedAt: new Date().toISOString(), sourceDiagnostics: diagnostics.summary,
      sessions, sessionsById, materializationDependencies, projectQueryStore: builder.finish(), eventKinds,
      legacyRawOwners: { schemaVersion: 1, sourceKind: SOURCE_KIND, entryCount: 0, accountedBytes: 2, payload: {} },
      totals: { fileCount: files.length, candidateFileCount: candidates.length, indexedFileCount, skippedFileCount, unknownFileCount,
        candidateBytes, indexedBytes, sessionCount: sessions.length, eventCount, rawEventCount, elapsedMs: Date.now() - started } };
  } catch (error) { builder.dispose(); throw error; }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) throw new Error('Invalid Qoder materialization fields');
}
function validSourceFile(sourceFile) {
  if (typeof sourceFile !== 'string') return false;
  const parts = sourceFile.split('/');
  return (parts.length === 2 || (parts.length === 4 && parts[2] === 'subagents'))
    && parts.every((part) => part && part !== '.' && part !== '..') && parts.at(-1).endsWith('.jsonl');
}
function validateQoderMaterializationDescriptor({ materializationContext, indexedSession, descriptor, dependencySet }) {
  exactKeys(descriptor.payload, ['sourceFile', 'parentToolUseId']);
  const { sourceFile } = descriptor.payload;
  if (typeof sourceFile !== 'string' || !sourceFile || sourceFile !== indexedSession.sourceFile
      || !validSourceFile(sourceFile) || path.isAbsolute(sourceFile) || !isPathInsideOrSame(path.resolve(materializationContext.sessionsRoot, sourceFile), materializationContext.sessionsRoot)
      || dependencySet.entries.length !== 1 || typeof descriptor.payload.parentToolUseId !== 'string'
      || (sourceFile.split('/').length !== 4 && descriptor.payload.parentToolUseId)) throw new Error('Invalid Qoder transcript descriptor');
  const entry = dependencySet.entries[0];
  exactKeys(entry, ['role', 'pathIdentity', 'existence', 'kind', 'policy', 'acceptedBytes', 'lineCount', 'digest', 'directoryEntries', 'evidence']);
  exactKeys(entry.evidence, ['fileIdentity']); exactKeys(entry.evidence.fileIdentity, ['device', 'inode']);
  if (entry.role !== 'primary_transcript' || entry.pathIdentity !== sourceFile || entry.existence !== 'present'
      || entry.kind !== 'file' || entry.policy !== 'accepted_prefix' || entry.acceptedBytes !== indexedSession.bytes
      || entry.lineCount !== indexedSession.lineCount || !/^[a-f0-9]{64}$/.test(entry.digest)
      || entry.directoryEntries.length !== 0 || !Object.values(entry.evidence.fileIdentity).every((v) => typeof v === 'string' && /^\d+$/.test(v))
      || dependencySet.id !== dependencyId(dependencySet.entries) || descriptor.dependencySetId !== dependencySet.id
      || descriptor.sourceSnapshotId !== snapshotId(dependencySet, descriptor.payload)) throw new Error('Invalid Qoder accepted-prefix dependency');
}
function validateQoderLegacyRawOwnerIndex({ legacyRawOwners }) {
  exactKeys(legacyRawOwners.payload, []);
  if (legacyRawOwners.sourceKind !== SOURCE_KIND || legacyRawOwners.entryCount !== 0 || legacyRawOwners.accountedBytes !== 2) throw new Error('Invalid Qoder legacy Raw ownership');
}
function accepted(entry) { return { acceptedBytes: entry.acceptedBytes, digest: entry.digest, fileIdentity: entry.evidence.fileIdentity }; }

async function materializeQoderSession({ materializationContext, indexedSession, dependencySet, signal }) {
  const payload = indexedSession.materializationDescriptor.payload;
  const session = await parseQoderSessionArtifact(path.resolve(materializationContext.sessionsRoot, payload.sourceFile), payload.sourceFile,
    materializationContext.repoRoot, signal, { sessionsRoot: materializationContext.sessionsRoot,
      acceptedSnapshot: accepted(dependencySet.entries[0]) });
  if (!session || session.id !== indexedSession.id || session.rawEventCount !== indexedSession.rawEventCount || session.logicalEventCount !== indexedSession.logicalEventCount) throw storage.stale();
  return { ...session, materializationSnapshotId: indexedSession.materializationDescriptor.sourceSnapshotId };
}

async function snapshotForSession(index, session, signal) {
  const indexed = index.sessionsById.get(session.id);
  const descriptor = indexed?.materializationDescriptor;
  const dependency = descriptor && index.materializationDependencies.get(descriptor.dependencySetId);
  if (!dependency || indexed.sourceKind !== SOURCE_KIND
      || session.materializationSnapshotId !== descriptor.sourceSnapshotId) throw storage.stale();
  return storage.readQoderSnapshot(path.resolve(index.sessionsRoot, descriptor.payload.sourceFile), {
    sessionsRoot: index.sessionsRoot, acceptedSnapshot: accepted(dependency.entries[0]), signal,
  });
}
async function readQoderRawRecord(index, session, raw, options = {}) {
  if (!session.rawEvents.some((candidate) => candidate.rawId === raw.rawId && candidate.source.line === raw.source.line)) return null;
  const snapshot = await snapshotForSession(index, session, options.signal);
  const text = snapshot.lines[raw.source.line - 1];
  if (text === undefined) throw storage.stale();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* Preserve malformed bytes verbatim. */ }
  // The raw string is exact evidence. Bound its parsed companion as well so
  // HTTP JSON encoding cannot overflow on a record deeper than the JS stack.
  return { raw: text, parsed: logical.sanitizeQoderValue(parsed), rawId: raw.rawId, sourceKind: SOURCE_KIND, sourceLocator: raw.sourceLocator };
}

const qoderAdapter = {
  kind: SOURCE_KIND, label: 'Qoder', homeOption: 'qoderHome', homeLabel: 'Qoder home',
  sessionLifecycle: 'indexed-materialized-v1',
  defaultHome: defaultQoderHome,
  query: qoderQuery, discoverConfiguredProjects: async () => [], discoverProjects: discoverQoderProjects,
  buildIndex: buildQoderIndex, materializeSession: materializeQoderSession, buildEventDetail: buildQoderEventDetail,
  readRawRecord: readQoderRawRecord, validateMaterializationDescriptor: validateQoderMaterializationDescriptor,
  readImagePreview: readQoderImagePreview,
  validateLegacyRawOwnerIndex: validateQoderLegacyRawOwnerIndex, validateMaterializedPrivateState() {},
  materializationContextFields: ['sessionsRoot'], materializedPrivateFields: [],
};

module.exports = { QODER_SOURCE_KIND: SOURCE_KIND, qoderAdapter, buildQoderIndex, discoverQoderProjects, parseQoderSessionArtifact,
  materializeQoderSession, readQoderRawRecord, snapshotForSession, validateQoderMaterializationDescriptor, buildQoderEventDetail };
