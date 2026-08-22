'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');
const {
  fsPathApi,
  isPathInsideOrSame,
  normalizeFsPath,
  resolveFsPath,
} = require('./shared/fs-path');
const {
  CANONICAL_SCHEMA_VERSION,
  CLAUDE_SOURCE_KIND,
  claudeRawRef,
  isPlainObject,
  makeClaudeRawEvent,
  safeIso,
  truncate,
} = require('./claude-source');
const { createClaudeLogicalBuilder } = require('./claude-logical');
const {
  compactClaudeForkRelationshipFacts,
  inferClaudeForkRelationships,
} = require('./claude-forks');
const { createProjectQueryStoreBuilder } = require('./project-query-store');
const { createSessionQuery } = require('./session-query');
const { validateCanonicalLegacyRawOwnerIndex } = require('./canonical-contract');
const {
  hasMaterializationObserver,
  notifyMaterializationObserver,
  observeMaterializationPhase,
  recordMaterializationDuration,
} = require('./materialization-observer');
const {
  isPlanArtifactEvent,
  isPlanEvent,
} = require('./shared/plan-facet');

const POINTER_PROVISIONAL_ASSOCIATION = 'pointer-provisional';
// Keep the ordinary UUID/agent spelling stable, but never let an identity
// component contribute a delimiter or a percent escape of its own.  The
// explicit surrogate handling below also makes this total over JavaScript
// strings instead of inheriting encodeURIComponent's lone-surrogate throw.
const CLAUDE_ID_COMPONENT_SAFE = /^[A-Za-z0-9\-._!~*'()]$/u;
// Reindex evidence deliberately stays out of the serialized index.  An index is
// only reused while it remains in this process (the server keeps it in memory),
// and persisting these implementation details would make the public index shape
// depend on an optimisation.
const claudeReuseEvidenceBySession = new WeakMap();
const claudeStrictReuseEvidenceByIndex = new WeakMap();
const CLAUDE_MATERIALIZATION_SCHEMA_VERSION = 1;
const claudeSearch = createSessionQuery();

function sourceFileIdentity(stat) {
  return {
    device: String(stat?.dev ?? ''),
    inode: String(stat?.ino ?? ''),
  };
}

function sameSourceIdentity(left, right) {
  return Boolean(left && right)
    && left.device === right.device
    && left.inode === right.inode;
}

function sourceSnapshotChangedError() {
  const error = new Error('Claude source changed during indexing; retry required');
  error.code = 'SOURCE_CHANGED_DURING_INDEX';
  return error;
}

function indexedSourceStaleError() {
  const error = new Error('Indexed Claude source changed; reindex required');
  error.name = 'IndexedSourceStaleError';
  error.code = 'INDEXED_SOURCE_STALE';
  error.statusCode = 409;
  return error;
}

function encodeClaudeIdentityComponent(value) {
  const source = String(value);
  let encoded = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const codeUnit = source.charCodeAt(index);
    if (CLAUDE_ID_COMPONENT_SAFE.test(character)) {
      encoded += character;
      continue;
    }

    const nextCodeUnit = source.charCodeAt(index + 1);
    if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && nextCodeUnit >= 0xdc00
      && nextCodeUnit <= 0xdfff
    ) {
      encoded += encodeURIComponent(source.slice(index, index + 2));
      index += 1;
      continue;
    }

    if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
      encoded += `%u${codeUnit.toString(16).toUpperCase().padStart(4, '0')}`;
      continue;
    }

    encoded += encodeURIComponent(character);
  }
  return encoded;
}

function stableSetValues(values) {
  return [...(values || [])].map((value) => String(value)).sort();
}

function candidateReuseEvidence(candidate) {
  return {
    relFile: String(candidate.relFile || ''),
    sourceSessionId: String(candidate.sourceSessionId || ''),
    sourceIdentityConflict: Boolean(candidate.sourceIdentityConflict),
    bytes: Number(candidate.bytes || 0),
    sourceUpdatedAt: String(candidate.sourceUpdatedAt || ''),
    transcriptFingerprint: String(candidate.transcriptFingerprint || ''),
    cwdSet: stableSetValues(candidate.cwdSet),
    agentIds: stableSetValues(candidate.agentIds),
    foreignSessionIds: stableSetValues(candidate.foreignSessionIds),
  };
}

async function candidateStatStillMatches(candidate) {
  try {
    const stat = await fsp.stat(candidate.filePath);
    return stat.size === candidate.bytes && safeIso(stat.mtime) === candidate.sourceUpdatedAt;
  } catch {
    return false;
  }
}

function sameReuseEvidence(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function relationshipReuseEvidence(candidates) {
  return candidates
    .map((candidate) => ({
      candidate: candidateReuseEvidence(candidate),
      projectAssociation: String(candidate.projectAssociation || ''),
    }))
    .sort((left, right) => left.candidate.relFile.localeCompare(right.candidate.relFile));
}

function derivedReuseEvidence(derived) {
  return {
    candidate: candidateReuseEvidence(derived.candidate),
    metadata: derived.metadataEvidence || { exists: false },
    relationship: derived.relationshipReuseEvidence || null,
    derivedKind: String(derived.context.derivedKind || 'subagent'),
    derivedId: String(derived.context.derivedId || derived.context.agentId || ''),
    agentId: String(derived.context.agentId || ''),
    runId: String(derived.context.runId || ''),
    parentSessionId: String(derived.context.parentSessionId || ''),
    toolUseId: String(derived.context.toolUseId || ''),
    agentNickname: String(derived.context.agentNickname || ''),
    description: String(derived.context.description || ''),
    spawnDepth: derived.context.spawnDepth ?? null,
  };
}

function mainReuseEvidence(candidate, derivedCandidates, relationships) {
  return {
    source: candidateReuseEvidence(candidate),
    derived: derivedCandidates.map(derivedReuseEvidence)
      .sort((left, right) => left.candidate.relFile.localeCompare(right.candidate.relFile)),
    relationships,
  };
}

function comparableMainReuseEvidence(evidence) {
  return {
    source: evidence?.source,
    derived: evidence?.derived,
    relationships: evidence?.relationships,
  };
}

function resetInferredForkFields(session) {
  session.forkedFromSessionId = '';
  session.forkStorageMode = '';
  session.forkedAt = '';
  session.forkPointUuid = '';
  session.forkContinuationState = '';
  session.forkEvidence = null;
  session.inheritedContext = null;
}

function cloneReusedClaudeSession(previousSession, candidate, context) {
  const session = {
    ...previousSession,
    sourceSessionId: candidate.sourceSessionId,
    sourceClientVersion: candidate.sourceClientVersion || previousSession.sourceClientVersion,
    projectAssociation: context.projectAssociation || previousSession.projectAssociation,
    sourceFile: candidate.relFile,
    sourceAbsFile: candidate.filePath,
    sourceRoot: candidate.sourceRoot,
    sourceUpdatedAt: candidate.sourceUpdatedAt,
    bytes: candidate.bytes,
    cwdSet: new Set(context.inheritedCwds || candidate.cwdSet || []),
    matchesRepo: Boolean(context.matchesRepo),
    parentSessionId: context.parentSessionId || '',
    parentSessionInferred: false,
    agentNickname: context.agentNickname || previousSession.agentNickname,
    primarySessionMetaKind: context.parentSessionId
      ? String(context.derivedKind || previousSession.primarySessionMetaKind || 'subagent')
      : '',
    sourceDerivedId: context.derivedId || context.agentId || previousSession.sourceDerivedId || '',
    derivedRunId: context.runId || '',
    derivedRelationship: context.derivedRelationship || null,
    subagentToolUseId: context.toolUseId || '',
    spawnDepth: context.spawnDepth ?? null,
  };
  resetInferredForkFields(session);
  // Fork inference removes these private collections.  Restore fresh copies so
  // unchanged sessions can safely participate in a new relationship pass.
  const evidence = claudeReuseEvidenceBySession.get(previousSession);
  session._foreignSessionIds = new Set(evidence?.foreignSessionIds || []);
  session._rawUuidSet = new Set(evidence?.rawUuidSet || []);
  return session;
}

function usableSourceSessionIdentity(value) {
  if (typeof value !== 'string') return '';
  const identity = value.trim();
  return identity && identity === value ? identity : '';
}

function usableRecordCwd(record) {
  if (!isPlainObject(record) || typeof record.cwd !== 'string') return '';
  const cwd = record.cwd.trim();
  if (!cwd || !fsPathApi(cwd).isAbsolute(cwd)) return '';
  return resolveFsPath(cwd);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Indexing cancelled');
  error.name = 'AbortError';
  throw error;
}

function emitProgress(onProgress, progress) {
  if (typeof onProgress === 'function') onProgress(progress);
}

async function directoryExists(target) {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function directJsonlFiles(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => path.join(directory, entry.name));
}

async function containedRealPath(sourceRoot, target) {
  const resolvedRoot = path.resolve(sourceRoot);
  const resolvedTarget = path.resolve(target);
  if (!isPathInsideOrSame(resolvedTarget, resolvedRoot)) return '';
  try {
    const [realRoot, realTarget] = await Promise.all([
      fsp.realpath(resolvedRoot),
      fsp.realpath(resolvedTarget),
    ]);
    return isPathInsideOrSame(realTarget, realRoot) ? realTarget : '';
  } catch {
    return '';
  }
}

async function claudeLayout(claudeHome) {
  const resolvedHome = path.resolve(claudeHome);
  let physicalHome = resolvedHome;
  try {
    physicalHome = await fsp.realpath(resolvedHome);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const canonicalRoot = path.join(physicalHome, 'projects');
  if (await directoryExists(canonicalRoot)) {
    const entries = await fsp.readdir(canonicalRoot, { withFileTypes: true });
    const containers = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        key: entry.name,
        path: path.join(canonicalRoot, entry.name),
      }));
    if (containers.length) {
      return {
        claudeHome: resolvedHome,
        sourceRoot: canonicalRoot,
        projectsRoot: canonicalRoot,
        containers,
        layout: 'claude-home',
      };
    }
  }

  const exportedFiles = await directJsonlFiles(physicalHome);
  if (exportedFiles.length) {
    return {
      claudeHome: resolvedHome,
      sourceRoot: physicalHome,
      projectsRoot: physicalHome,
      containers: [{ key: path.basename(physicalHome), path: physicalHome }],
      layout: 'project-container',
    };
  }

  return {
    claudeHome: resolvedHome,
    sourceRoot: canonicalRoot,
    projectsRoot: canonicalRoot,
    containers: [],
    layout: 'claude-home',
  };
}

async function discoverMainCandidates(claudeHome) {
  const layout = await claudeLayout(claudeHome);
  const candidates = [];
  for (const container of layout.containers) {
    const files = await directJsonlFiles(container.path);
    for (const filePath of files) {
      candidates.push({
        filePath,
        containerKey: container.key,
        containerPath: container.path,
        sourceRoot: layout.sourceRoot,
        relFile: path.relative(layout.sourceRoot, filePath).replace(/\\/g, '/'),
      });
    }
  }
  return { ...layout, candidates };
}

async function inspectClaudeSessionFile(candidate, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const stat = await fsp.stat(candidate.filePath);
  const acceptedBytes = stat.size;
  const acceptedIdentity = sourceFileIdentity(stat);
  const transcriptFingerprint = crypto.createHash('sha256');
  const cwdSet = new Set();
  const uuids = new Set();
  const agentIds = new Set();
  const declaredSourceSessionIds = new Set();
  const referencedSessionIds = new Set();
  let invalidSourceSessionIdentity = false;
  let sourceClientVersion = '';
  let lineCount = 0;
  let startedAt = '';
  let updatedAt = '';

  const stream = acceptedBytes > 0
    ? fs.createReadStream(candidate.filePath, { start: 0, end: acceptedBytes - 1 })
    : fs.createReadStream(candidate.filePath, { start: 0, end: 0 });
  let sourceBytesRead = 0;
  stream.on('data', (chunk) => {
    sourceBytesRead += chunk.length;
    transcriptFingerprint.update(chunk);
  });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      throwIfAborted(signal);
      if (!line.trim()) continue;
      lineCount += 1;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isPlainObject(record)) continue;
      const cwd = usableRecordCwd(record);
      if (cwd) cwdSet.add(cwd);
      if (Object.hasOwn(record, 'sessionId')) {
        const declaredIdentity = usableSourceSessionIdentity(record.sessionId);
        if (declaredIdentity) declaredSourceSessionIds.add(declaredIdentity);
        else invalidSourceSessionIdentity = true;
      }
      if (record.version && !sourceClientVersion) sourceClientVersion = String(record.version);
      if (record.uuid) uuids.add(String(record.uuid));
      if (record.agentId) agentIds.add(String(record.agentId));
      const referencedIdentity = usableSourceSessionIdentity(record.session_id);
      if (referencedIdentity) referencedSessionIds.add(referencedIdentity);
      const timestamp = safeIso(record.timestamp);
      if (timestamp && (!startedAt || timestamp < startedAt)) startedAt = timestamp;
      if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  const verifiedStat = await fsp.stat(candidate.filePath);
  if (sourceBytesRead !== acceptedBytes
      || verifiedStat.size < acceptedBytes
      || !sameSourceIdentity(sourceFileIdentity(verifiedStat), acceptedIdentity)) {
    throw sourceSnapshotChangedError();
  }

  const fileIdentity = usableSourceSessionIdentity(path.basename(candidate.filePath, '.jsonl'));
  let sourceIdentityConflict = invalidSourceSessionIdentity || declaredSourceSessionIds.size > 1;
  const sourceSessionId = sourceIdentityConflict
    ? ''
    : [...declaredSourceSessionIds][0] || fileIdentity;
  if (!sourceSessionId) sourceIdentityConflict = true;
  const foreignSessionIds = new Set(
    [...referencedSessionIds].filter((identity) => identity !== sourceSessionId),
  );

  return {
    ...candidate,
    bytes: acceptedBytes,
    sourceIdentity: acceptedIdentity,
    sourceUpdatedAt: safeIso(stat.mtime),
    lineCount,
    cwdSet,
    sourceSessionId,
    sourceIdentityConflict,
    transcriptFingerprint: transcriptFingerprint.digest('hex'),
    sourceClientVersion,
    uuids,
    agentIds,
    foreignSessionIds,
    startedAt,
    updatedAt,
  };
}

function comparePrimaryIdentityCandidates(left, right) {
  const leftCanonical = path.basename(left.filePath, '.jsonl') === left.sourceSessionId ? 0 : 1;
  const rightCanonical = path.basename(right.filePath, '.jsonl') === right.sourceSessionId ? 0 : 1;
  return leftCanonical - rightCanonical || left.relFile.localeCompare(right.relFile);
}

function resolvePrimaryIdentityCandidates(inspected) {
  const accepted = [];
  const duplicates = [];
  const conflicts = [];
  const bySourceIdentity = new Map();

  for (const candidate of inspected) {
    if (candidate.sourceIdentityConflict || !candidate.sourceSessionId) {
      conflicts.push(candidate);
      continue;
    }
    const matches = bySourceIdentity.get(candidate.sourceSessionId) || [];
    matches.push(candidate);
    bySourceIdentity.set(candidate.sourceSessionId, matches);
  }

  for (const matches of bySourceIdentity.values()) {
    const fingerprints = new Set(matches.map((candidate) => candidate.transcriptFingerprint));
    if (fingerprints.size !== 1) {
      conflicts.push(...matches);
      continue;
    }
    matches.sort(comparePrimaryIdentityCandidates);
    accepted.push(matches[0]);
    duplicates.push(...matches.slice(1));
  }

  accepted.sort((left, right) => left.relFile.localeCompare(right.relFile));
  return { accepted, conflicts, duplicates };
}

function resolveClaudeAnalyzerIdentities(sessions) {
  const byId = new Map();
  const conflicts = [];
  const conflictSet = new Set();
  const addConflict = (session) => {
    if (conflictSet.has(session)) return;
    conflictSet.add(session);
    conflicts.push(session);
  };

  for (const session of sessions) {
    if (!session || typeof session.id !== 'string' || !session.id) {
      addConflict(session);
      continue;
    }
    const matches = byId.get(session.id) || [];
    matches.push(session);
    byId.set(session.id, matches);
  }

  for (const matches of byId.values()) {
    if (matches.length > 1) matches.forEach(addConflict);
  }

  // A derived session whose parent Analyzer identity was itself ambiguous is
  // not independently trustworthy.  Remove that dependent candidate too,
  // while leaving unrelated identities available to the index.
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions) {
      if (!session || conflictSet.has(session) || !session.parentSessionId) continue;
      const parentIsConflicted = sessions.some((candidate) => (
        candidate
        && candidate.id === session.parentSessionId
        && conflictSet.has(candidate)
      ));
      if (!parentIsConflicted) continue;
      addConflict(session);
      changed = true;
    }
  }

  return {
    accepted: sessions.filter((session) => !conflictSet.has(session)),
    conflicts,
  };
}

function projectFor(map, repoRoot) {
  const key = normalizeFsPath(repoRoot);
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      repoRoot,
      sessionCount: 0,
      updatedAt: '',
      bytes: 0,
      exists: false,
      source: 'claude-code-transcripts',
    });
  }
  return map.get(key);
}

async function discoverClaudeConfiguredProjects() {
  return [];
}

async function discoverClaudeProjects({ claudeHome, signal }) {
  const { candidates } = await discoverMainCandidates(claudeHome);
  const projects = new Map();
  const inspected = [];
  for (const candidate of candidates) {
    throwIfAborted(signal);
    inspected.push(await inspectClaudeSessionFile(candidate, { signal }));
  }
  const identityResolution = resolvePrimaryIdentityCandidates(inspected);
  for (const candidate of identityResolution.accepted) {
    for (const repoRoot of new Set(candidate.cwdSet)) {
      const project = projectFor(projects, repoRoot);
      if (!project) continue;
      project.sessionCount += 1;
      project.bytes += candidate.bytes;
      if (candidate.updatedAt > project.updatedAt) project.updatedAt = candidate.updatedAt;
    }
  }
  for (const project of projects.values()) {
    project.exists = await directoryExists(project.repoRoot);
  }
  return [...projects.values()].sort((left, right) => (
    String(right.updatedAt).localeCompare(String(left.updatedAt))
    || right.sessionCount - left.sessionCount
    || left.repoRoot.localeCompare(right.repoRoot)
  ));
}

function analyzerSessionId(sourceSessionId) {
  return `${CLAUDE_SOURCE_KIND}:${encodeClaudeIdentityComponent(sourceSessionId)}`;
}

function analyzerSubagentSessionId(parentSourceSessionId, agentId) {
  return `${CLAUDE_SOURCE_KIND}:${encodeClaudeIdentityComponent(parentSourceSessionId)}:agent:${encodeClaudeIdentityComponent(agentId)}`;
}

function analyzerForkedSkillSessionId(parentSourceSessionId, agentId) {
  return `${CLAUDE_SOURCE_KIND}:${encodeClaudeIdentityComponent(parentSourceSessionId)}:forked-skill:${encodeClaudeIdentityComponent(agentId)}`;
}

function analyzerWorkflowAgentSessionId(parentSourceSessionId, runId, agentId) {
  return `${CLAUDE_SOURCE_KIND}:${encodeClaudeIdentityComponent(parentSourceSessionId)}:workflow-agent:${encodeClaudeIdentityComponent(runId)}:${encodeClaudeIdentityComponent(agentId)}`;
}

function emptyCounts() {
  return {
    turns: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    reasoning: 0,
    toolCalls: 0,
    failedCommands: 0,
    issueEvents: 0,
    patches: 0,
    compactions: 0,
    aborts: 0,
    errors: 0,
    protocol: 0,
    planArtifacts: 0,
    planEvents: 0,
  };
}

function makeSession(candidate, context) {
  const id = context.id || analyzerSessionId(candidate.sourceSessionId);
  return {
    id,
    sourceKind: CLAUDE_SOURCE_KIND,
    sourceSessionId: candidate.sourceSessionId,
    sourceDerivedId: context.derivedId || context.agentId || '',
    sourceClientVersion: candidate.sourceClientVersion || '',
    projectAssociation: context.projectAssociation || '',
    sourceFile: candidate.relFile,
    sourceAbsFile: candidate.filePath,
    sourceRoot: candidate.sourceRoot,
    sourceUpdatedAt: candidate.sourceUpdatedAt,
    bytes: candidate.bytes,
    lineCount: 0,
    title: '',
    transcriptTitle: '',
    transcriptUpdatedAt: '',
    cwdSet: new Set(context.inheritedCwds || candidate.cwdSet || []),
    startedAt: '',
    updatedAt: '',
    matchesRepo: Boolean(context.matchesRepo),
    parentSessionId: context.parentSessionId || '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    forkEvidence: null,
    inheritedContext: null,
    agentNickname: context.agentNickname || '',
    primarySessionMetaKind: context.parentSessionId ? String(context.derivedKind || 'subagent') : '',
    derivedRunId: context.runId || '',
    derivedRelationship: context.derivedRelationship || null,
    shell: '',
    rawEvents: [],
    logicalEvents: [],
    counts: emptyCounts(),
    analysis: null,
    presentationIndexes: { codeModeDeclaredRequests: new Map() },
    _customTitle: '',
    _aiTitle: '',
    _agentName: '',
    _lastPrompt: '',
    _foreignSessionIds: new Set(candidate.foreignSessionIds || []),
    _rawUuidSet: new Set(),
    _subagentDescription: context.description || '',
    subagentToolUseId: context.toolUseId || '',
    spawnDepth: context.spawnDepth ?? null,
  };
}

function updateSessionMetadata(session, record, raw, repoRoot) {
  const cwd = usableRecordCwd(record);
  if (cwd) {
    session.cwdSet.add(cwd);
    if (isPathInsideOrSame(cwd, repoRoot)) session.matchesRepo = true;
  }
  if (!isPlainObject(record)) return;
  if (record.version && !session.sourceClientVersion) session.sourceClientVersion = String(record.version);
  if (record.type === 'custom-title' && record.customTitle) session._customTitle = String(record.customTitle);
  if (record.type === 'ai-title' && record.aiTitle) session._aiTitle = String(record.aiTitle);
  if (record.type === 'agent-name' && record.agentName) session._agentName = String(record.agentName);
  if (record.type === 'last-prompt' && record.lastPrompt) session._lastPrompt = String(record.lastPrompt);
  if (record.session_id && String(record.session_id) !== String(record.sessionId || session.sourceSessionId)) {
    session._foreignSessionIds.add(String(record.session_id));
  }
  if (raw.uuid) session._rawUuidSet.add(raw.uuid);
  if (raw.timestamp && (!session.startedAt || raw.timestamp < session.startedAt)) session.startedAt = raw.timestamp;
  if (raw.timestamp && (!session.updatedAt || raw.timestamp > session.updatedAt)) session.updatedAt = raw.timestamp;
}

function cleanTitle(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  for (const line of source.split(/\r?\n/)) {
    const cleaned = line
      .trim()
      .replace(/^>\s*/, '')
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/[*_`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) return truncate(cleaned, 120);
  }
  return '';
}

function inferTitle(session) {
  if (session._customTitle) return cleanTitle(session._customTitle);
  if (session._aiTitle) return cleanTitle(session._aiTitle);
  if (session.parentSessionId) {
    const task = cleanTitle(session._subagentDescription)
      || cleanTitle([...session.logicalEvents].reverse().find((event) => event.kind === 'user_message')?.searchText);
    const type = cleanTitle(session.agentNickname) || 'Subagent';
    return truncate(task ? `${type}: ${task}` : `${type} session`, 160);
  }
  const firstUser = session.logicalEvents.find((event) => event.kind === 'user_message');
  return cleanTitle(firstUser?.searchText)
    || cleanTitle(session._lastPrompt)
    || path.basename(session.sourceFile, '.jsonl')
    || 'Imported session';
}

function addCounts(session, event, turnIds) {
  if (event.turnId) turnIds.add(event.turnId);
  if (event.layer === 'protocol') {
    session.counts.protocol += 1;
    return;
  }
  if (['user_message', 'assistant_message'].includes(event.kind)) session.counts.messages += 1;
  if (event.kind === 'user_message') session.counts.userMessages += 1;
  if (event.kind === 'assistant_message') session.counts.assistantMessages += 1;
  if (event.kind === 'reasoning') session.counts.reasoning += 1;
  if (['command', 'read', 'patch', 'mcp_call', 'web_search', 'agent_coordination', 'other_tool_call'].includes(event.kind)) {
    session.counts.toolCalls += 1;
  }
  if (event.kind === 'command' && event.status === 'failed') session.counts.failedCommands += 1;
  if (event.status === 'failed' || event.severity !== 'normal') session.counts.issueEvents += 1;
  if (event.kind === 'patch') session.counts.patches += 1;
  if (event.kind === 'compaction') session.counts.compactions += 1;
  if (event.kind === 'abort') session.counts.aborts += 1;
  if (event.kind === 'error') session.counts.errors += 1;
  if (isPlanArtifactEvent(event)) session.counts.planArtifacts += 1;
  if (isPlanEvent(event)) session.counts.planEvents += 1;
}

function countBy(items, keyFor) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }));
}

function responseUsage(rawEvents) {
  const byMessageId = new Map();
  for (const raw of rawEvents) {
    if (raw.recordType !== 'assistant' || !raw.messageId || !raw.usage || byMessageId.has(raw.messageId)) continue;
    byMessageId.set(raw.messageId, raw.usage);
  }
  const tokenStats = {
    maxObserved: 0,
    responseCount: byMessageId.size,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  for (const usage of byMessageId.values()) {
    const input = Number(usage.input_tokens || 0);
    const output = Number(usage.output_tokens || 0);
    const creation = Number(usage.cache_creation_input_tokens || 0);
    const read = Number(usage.cache_read_input_tokens || 0);
    tokenStats.inputTokens += Number.isFinite(input) ? input : 0;
    tokenStats.outputTokens += Number.isFinite(output) ? output : 0;
    tokenStats.cacheCreationInputTokens += Number.isFinite(creation) ? creation : 0;
    tokenStats.cacheReadInputTokens += Number.isFinite(read) ? read : 0;
    tokenStats.maxObserved = Math.max(tokenStats.maxObserved, Number.isFinite(input) ? input : 0);
  }
  return tokenStats;
}

function finalizeSession(session) {
  const turnIds = new Set();
  for (const event of session.logicalEvents) addCounts(session, event, turnIds);
  session.counts.turns = turnIds.size;
  session.title = inferTitle(session);
  session.transcriptTitle = session.title;
  session.transcriptUpdatedAt = session.updatedAt;
  if (!session.startedAt) session.startedAt = session.sourceUpdatedAt;
  if (!session.updatedAt) session.updatedAt = session.sourceUpdatedAt;

  const toolEvents = session.logicalEvents.filter((event) => event.toolName);
  const commandEvents = session.logicalEvents.filter((event) => event.kind === 'command');
  const patchCounts = new Map();
  for (const event of session.logicalEvents.filter((candidate) => candidate.kind === 'patch')) {
    for (const file of event.touchedFiles) patchCounts.set(file, (patchCounts.get(file) || 0) + 1);
  }
  session.analysis = {
    sessionId: session.id,
    title: session.title,
    counts: session.counts,
    toolUsage: countBy(toolEvents, (event) => event.toolName),
    failedCommands: commandEvents
      .filter((event) => event.status === 'failed')
      .slice(0, 100)
      .map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        command: event.preview,
        status: event.status,
        exitCode: event.outputStats.exitCode,
        durationMs: event.outputStats.durationMs || 0,
        source: event.source,
      })),
    slowCommands: [...commandEvents]
      .sort((left, right) => Number(right.outputStats.durationMs || 0) - Number(left.outputStats.durationMs || 0))
      .slice(0, 25)
      .map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        command: event.preview,
        status: event.status,
        exitCode: event.outputStats.exitCode,
        durationMs: event.outputStats.durationMs || 0,
        source: event.source,
      })),
    patchedFiles: [...patchCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([file, count]) => ({ file, count })),
    tokenStats: responseUsage(session.rawEvents),
    timelineStats: countBy(session.logicalEvents.filter((event) => event.layer !== 'protocol'), (event) => event.kind),
    protocolStats: countBy(session.logicalEvents.filter((event) => event.layer === 'protocol'), (event) => event.subtype),
  };
  delete session._customTitle;
  delete session._aiTitle;
  delete session._agentName;
  delete session._lastPrompt;
  delete session._subagentDescription;
  return session;
}

const logicalBuilder = createClaudeLogicalBuilder({
  CANONICAL_SCHEMA_VERSION,
  CLAUDE_SOURCE_KIND,
  blockText: require('./claude-source').blockText,
  rawRef: claudeRawRef,
  stringifyValue: require('./claude-source').stringifyValue,
  truncate,
});

async function parseClaudeSession(candidate, context) {
  throwIfAborted(context.signal);
  const acceptedSnapshot = context.acceptedSourceSnapshot || null;
  let stat;
  try {
    stat = await observeMaterializationPhase(
      'adapter_source_metadata',
      () => fsp.stat(candidate.filePath),
    );
  } catch (error) {
    if (acceptedSnapshot && (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')) {
      throw indexedSourceStaleError();
    }
    throw error;
  }
  const acceptedBytes = acceptedSnapshot ? acceptedSnapshot.acceptedBytes : stat.size;
  const snapshotFailure = context.materialization ? indexedSourceStaleError : sourceSnapshotChangedError;
  if (!Number.isSafeInteger(acceptedBytes)
      || acceptedBytes < 0
      || stat.size < acceptedBytes
      || (acceptedSnapshot
        && !sameSourceIdentity(sourceFileIdentity(stat), acceptedSnapshot.fileIdentity))) {
    throw snapshotFailure();
  }
  const session = makeSession(candidate, context);
  const sourceHash = crypto.createHash('sha256');
  let sourceBytesRead = 0;
  const stream = acceptedBytes > 0
    ? fs.createReadStream(candidate.filePath, { start: 0, end: acceptedBytes - 1 })
    : fs.createReadStream(candidate.filePath, { start: 0, end: 0 });
  stream.on('data', (chunk) => {
    sourceBytesRead += chunk.length;
    sourceHash.update(chunk);
  });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  const observeSourcePhases = hasMaterializationObserver();
  const streamStartedAt = observeSourcePhases ? performance.now() : 0;
  let recordCpuMs = 0;
  if (observeSourcePhases) {
    notifyMaterializationObserver({ phase: 'adapter_source_stream', state: 'start' });
  }
  try {
    for await (const line of lines) {
      throwIfAborted(context.signal);
      lineNumber += 1;
      if (!line.trim()) continue;
      const recordStartedAt = observeSourcePhases ? performance.now() : 0;
      try {
        let record;
        let parseError = '';
        try {
          record = JSON.parse(line);
        } catch (error) {
          parseError = error instanceof Error ? error.message : 'Invalid JSON';
        }
        session.lineCount += 1;
        const raw = makeClaudeRawEvent(
          record,
          lineNumber,
          candidate.relFile,
          session.id,
          session.sourceSessionId,
          { parseError, rawText: line },
        );
        if (!parseError) updateSessionMetadata(session, record, raw, context.repoRoot);
        session.rawEvents.push(raw);
      } finally {
        if (observeSourcePhases) recordCpuMs += performance.now() - recordStartedAt;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
    if (observeSourcePhases) {
      const streamDurationMs = performance.now() - streamStartedAt;
      notifyMaterializationObserver({ phase: 'adapter_source_stream', state: 'end' });
      recordMaterializationDuration('adapter_source_record_parse', recordCpuMs);
      recordMaterializationDuration(
        'adapter_source_read_wait',
        Math.max(0, streamDurationMs - recordCpuMs),
      );
    }
  }
  const sourceFingerprint = sourceHash.digest('hex');
  const verifiedStat = await observeMaterializationPhase(
    'adapter_source_parse_final_verification',
    () => fsp.stat(candidate.filePath),
  );
  if (sourceBytesRead !== acceptedBytes
      || verifiedStat.size < acceptedBytes
      || (acceptedSnapshot && sourceFingerprint !== acceptedSnapshot.digest)
      || (acceptedSnapshot
        && !sameSourceIdentity(sourceFileIdentity(verifiedStat), acceptedSnapshot.fileIdentity))) {
    throw snapshotFailure();
  }
  return observeMaterializationPhase('adapter_source_canonical_construction', () => {
    session.logicalEvents = logicalBuilder.buildLogicalEvents(session.rawEvents);
    return finalizeSession(session);
  });
}

function relativeSourceFile(sourceRoot, filePath) {
  return path.relative(sourceRoot, filePath).replace(/\\/g, '/');
}

async function containedFileState(sourceRoot, target) {
  const resolvedRoot = path.resolve(sourceRoot);
  const resolvedTarget = path.resolve(target);
  if (!isPathInsideOrSame(resolvedTarget, resolvedRoot)) return { status: 'unsafe', filePath: '' };
  try {
    const entry = await fsp.lstat(resolvedTarget);
    if (!entry.isFile() && !entry.isSymbolicLink()) return { status: 'unsafe', filePath: '' };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', filePath: '' };
    throw error;
  }
  const filePath = await containedRealPath(sourceRoot, resolvedTarget);
  if (!filePath) return { status: 'unsafe', filePath: '' };
  const stat = await fsp.stat(filePath);
  return stat.isFile() ? { status: 'file', filePath } : { status: 'unsafe', filePath: '' };
}

async function readContainedTextWithEvidence(sourceRoot, target) {
  const state = await containedFileState(sourceRoot, target);
  if (state.status !== 'file') {
    return {
      text: '',
      valid: state.status === 'missing',
      evidence: {
        exists: state.status !== 'missing',
        unsafe: state.status === 'unsafe',
        relFile: relativeSourceFile(sourceRoot, path.resolve(target)),
      },
    };
  }
  const stat = await fsp.stat(state.filePath);
  const bytes = await fsp.readFile(state.filePath);
  const verifiedStat = await fsp.stat(state.filePath);
  if (bytes.length !== stat.size
      || verifiedStat.size !== stat.size
      || !sameSourceIdentity(sourceFileIdentity(verifiedStat), sourceFileIdentity(stat))) {
    throw sourceSnapshotChangedError();
  }
  const text = bytes.toString('utf8');
  return {
    text,
    valid: true,
    evidence: {
      exists: true,
      unsafe: false,
      relFile: relativeSourceFile(sourceRoot, state.filePath),
      bytes: stat.size,
      sourceUpdatedAt: safeIso(stat.mtime),
      sourceIdentity: sourceFileIdentity(stat),
      fingerprint: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

async function readJsonObjectWithEvidence(sourceRoot, target) {
  const value = await readContainedTextWithEvidence(sourceRoot, target);
  if (!value.evidence.exists) return { metadata: {}, valid: true, evidence: value.evidence };
  if (!value.valid || value.evidence.unsafe) return { metadata: {}, valid: false, evidence: value.evidence };
  try {
    const metadata = JSON.parse(value.text);
    return {
      metadata: isPlainObject(metadata) ? metadata : {},
      valid: isPlainObject(metadata),
      evidence: value.evidence,
    };
  } catch {
    return { metadata: {}, valid: false, evidence: value.evidence };
  }
}

function parentAgentEvidence(parentSession, agentId, toolUseId) {
  const matches = (parentSession.logicalEvents || []).filter((event) => (
    event.kind === 'agent_coordination'
    && event.toolName === 'Agent'
    && event.agentId === agentId
  ));
  if (matches.length !== 1) return null;
  const [evidence] = matches;
  return !toolUseId || evidence.callId === toolUseId ? evidence : null;
}

function exactText(value) {
  return typeof value === 'string' && value.trim() && value === value.trim() ? value : '';
}

function derivedTranscriptMatches(inspected, parentSession, agentId, requireParentSessionIdentity) {
  if (inspected.sourceIdentityConflict) return false;
  if (inspected.agentIds.size !== 1 || !inspected.agentIds.has(agentId)) return false;
  if (requireParentSessionIdentity && inspected.sourceSessionId !== parentSession.sourceSessionId) return false;
  if (requireParentSessionIdentity && (
    !inspected.sourceClientVersion
    || inspected.sourceClientVersion !== parentSession.sourceClientVersion
  )) return false;
  return true;
}

function forkedSkillLaunches(parentSession) {
  const launches = [];
  for (const raw of parentSession.rawEvents || []) {
    if (raw.recordType !== 'system' || raw.payloadType !== 'local_command') continue;
    const content = String(raw.parsed?.content || '');
    const match = content.match(
      /^\s*<local-command-stdout>[^<>]*<\/local-command-stdout>\s*<forked-skill-launch>([^<>]+)<\/forked-skill-launch>\s*$/u,
    );
    if (!match) continue;
    let payload;
    try {
      payload = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (!isPlainObject(payload)) continue;
    const skillName = exactText(payload.skillName);
    const sourceAgentId = exactText(payload.agentId);
    if (!skillName || !sourceAgentId) continue;
    launches.push({
      raw,
      skillName,
      sourceAgentId,
      rawRef: claudeRawRef(raw),
    });
  }
  return launches;
}

function parentWorkflowLaunches(parentSession) {
  return (parentSession.logicalEvents || []).filter((event) => (
    event.toolName === 'Workflow'
    && event.lifecycle?.kind === 'async_workflow'
    && event.lifecycle.workflow
  )).map((event) => ({
    event,
    taskId: String(event.lifecycle.taskId || ''),
    toolUseId: String(event.callId || ''),
    runId: String(event.lifecycle.workflow.runId || ''),
    workflowName: String(event.lifecycle.workflow.workflowName || ''),
    scriptPath: String(event.lifecycle.workflow.scriptPath || ''),
  }));
}

function publicEvidenceFiles(values) {
  return values
    .filter((value) => value?.valid !== false && value?.evidence?.exists && !value.evidence.unsafe)
    .map((value) => ({
      role: value.role,
      file: value.evidence.relFile,
    }));
}

function reuseEvidenceFiles(values) {
  return values.filter(Boolean).map((value) => ({
    role: value.role,
    ...value.evidence,
  }));
}

async function inspectDerivedTranscript(parentCandidate, filePath, signal) {
  return inspectClaudeSessionFile({
    filePath,
    containerKey: parentCandidate.containerKey,
    containerPath: parentCandidate.containerPath,
    sourceRoot: parentCandidate.sourceRoot,
    relFile: relativeSourceFile(parentCandidate.sourceRoot, filePath),
  }, { signal });
}

function normalSubagentCandidate(
  parentSession,
  inspected,
  agentId,
  metadataValue,
  skillValue,
  markerValue,
) {
  if (!derivedTranscriptMatches(inspected, parentSession, agentId, false)) return null;
  const metadata = metadataValue.valid ? metadataValue.metadata : {};
  const metadataToolUseId = String(metadata.toolUseId || '');
  const evidence = parentAgentEvidence(parentSession, agentId, metadataToolUseId);
  if (!evidence) return null;
  inspected.sourceSessionId = parentSession.sourceSessionId;
  return {
    candidate: inspected,
    metadataEvidence: metadataValue.evidence,
    relationshipReuseEvidence: {
      kind: 'subagent',
      parentEventId: evidence.id,
      parentRawRefs: evidence.rawRefs,
      files: reuseEvidenceFiles([
        { role: 'metadata', evidence: metadataValue.evidence },
        { role: 'forked-skill', evidence: skillValue.evidence },
        { role: 'forked-skill-marker', evidence: markerValue.evidence },
      ]),
    },
    context: {
      id: analyzerSubagentSessionId(parentSession.sourceSessionId, agentId),
      derivedKind: 'subagent',
      derivedId: agentId,
      agentId,
      parentSessionId: parentSession.id,
      agentNickname: String(metadata.agentType || ''),
      description: String(metadata.description || ''),
      toolUseId: evidence.callId,
      spawnDepth: metadata.spawnDepth,
      inheritedCwds: parentSession.cwdSet,
      matchesRepo: true,
      projectAssociation: 'parent-inherited',
      derivedRelationship: {
        kind: 'subagent',
        ownerSessionId: parentSession.id,
        parentEventId: evidence.id,
        parentRawRefs: evidence.rawRefs,
        evidenceFiles: publicEvidenceFiles([{
          role: 'metadata',
          valid: metadataValue.valid,
          evidence: metadataValue.evidence,
        }]),
      },
    },
  };
}

function forkedSkillCandidate(parentSession, provisional, launch) {
  const {
    inspected,
    agentId,
    metadataValue,
    skillValue,
    markerValue,
  } = provisional;
  if (!derivedTranscriptMatches(inspected, parentSession, agentId, true)) return null;
  if (!metadataValue.evidence.exists || !metadataValue.valid) return null;
  if (!skillValue.evidence.exists || !skillValue.valid) return null;
  if (!markerValue.evidence.exists || !markerValue.valid) return null;
  const skillName = exactText(skillValue.metadata.skillName);
  const attributionName = exactText(skillValue.metadata.attributionName);
  if (!skillName || attributionName !== skillName || launch.skillName !== skillName) return null;
  if (markerValue.metadata.forkedSkill !== true || markerValue.metadata.skillName !== skillName) return null;
  inspected.sourceSessionId = parentSession.sourceSessionId;
  const files = [
    { role: 'metadata', evidence: metadataValue.evidence },
    { role: 'forked-skill', evidence: skillValue.evidence },
    { role: 'forked-skill-marker', evidence: markerValue.evidence },
  ];
  return {
    candidate: inspected,
    metadataEvidence: metadataValue.evidence,
    relationshipReuseEvidence: {
      kind: 'forked-skill',
      launchRawId: launch.raw.rawId,
      skillName,
      files: reuseEvidenceFiles(files),
    },
    context: {
      id: analyzerForkedSkillSessionId(parentSession.sourceSessionId, agentId),
      derivedKind: 'forked-skill',
      derivedId: agentId,
      agentId,
      parentSessionId: parentSession.id,
      agentNickname: attributionName,
      description: skillName,
      toolUseId: '',
      spawnDepth: metadataValue.metadata.spawnDepth,
      inheritedCwds: parentSession.cwdSet,
      matchesRepo: true,
      projectAssociation: 'parent-inherited',
      derivedRelationship: {
        kind: 'forked-skill',
        ownerSessionId: parentSession.id,
        agentId,
        skillName,
        launchRawRefs: [launch.rawRef],
        evidenceFiles: publicEvidenceFiles(files),
      },
    },
  };
}

function validWorkflowManifest(manifest) {
  if (!isPlainObject(manifest)) return false;
  const stringFields = [
    'runId',
    'timestamp',
    'taskId',
    'script',
    'scriptPath',
    'error',
    'summary',
    'workflowName',
    'status',
    'defaultModel',
  ];
  const numberFields = ['agentCount', 'durationMs', 'startTime', 'totalTokens', 'totalToolCalls'];
  if (stringFields.some((field) => typeof manifest[field] !== 'string')) return false;
  if (numberFields.some((field) => !Number.isFinite(manifest[field]))) return false;
  if (!Array.isArray(manifest.logs) || !Array.isArray(manifest.phases) || !Array.isArray(manifest.workflowProgress)) return false;
  if (manifest.phases.some((phase) => !isPlainObject(phase) || typeof phase.title !== 'string')) return false;
  return true;
}

function validFullWorkflowProgress(entry) {
  if (!isPlainObject(entry) || typeof entry.agentId !== 'string') return false;
  const stringFields = [
    'type',
    'label',
    'phaseTitle',
    'agentId',
    'model',
    'fallbackModel',
    'state',
    'lastToolName',
    'promptPreview',
    'resultPreview',
  ];
  const numberFields = [
    'index',
    'phaseIndex',
    'startedAt',
    'queuedAt',
    'attempt',
    'lastProgressAt',
    'tokens',
    'toolCalls',
    'durationMs',
  ];
  return stringFields.every((field) => typeof entry[field] === 'string')
    && numberFields.every((field) => Number.isFinite(entry[field]))
    && Boolean(entry.agentId && entry.state && entry.resultPreview);
}

function validSparseWorkflowProgress(entry) {
  return isPlainObject(entry)
    && typeof entry.type === 'string'
    && Number.isFinite(entry.index)
    && typeof entry.title === 'string';
}

function parseWorkflowJournal(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isPlainObject(record)) return null;
    const type = exactText(record.type);
    const key = exactText(record.key);
    const agentId = exactText(record.agentId);
    if (!type || !key || !agentId) return null;
    if (Object.hasOwn(record, 'result')) {
      if (type !== 'result') return null;
      if (!isPlainObject(record.result) || !Array.isArray(record.result.types)) return null;
      if (record.result.types.some((value) => typeof value !== 'string')) return null;
      if (record.result.counts != null && !isPlainObject(record.result.counts)) return null;
      records.push({ kind: 'result', type, key, agentId, sequence: records.length });
    } else {
      if (type !== 'started') return null;
      records.push({ kind: 'started', type, key, agentId, sequence: records.length });
    }
  }
  return records;
}

function workflowRunEvidence(parentSession, runId, manifest, journalRecords, children) {
  if (!validWorkflowManifest(manifest) || manifest.runId !== runId) return null;
  if (manifest.agentCount !== children.length || !children.length) return null;
  const launches = parentWorkflowLaunches(parentSession).filter((launch) => (
    launch.taskId === manifest.taskId
    && launch.runId === manifest.runId
    && launch.workflowName === manifest.workflowName
    && launch.scriptPath === manifest.scriptPath
  ));
  if (launches.length !== 1) return null;

  const childIds = new Set(children.map((child) => child.agentId));
  const fullProgress = manifest.workflowProgress.filter((entry) => Object.hasOwn(entry || {}, 'agentId'));
  if (manifest.workflowProgress.some((entry) => (
    Object.hasOwn(entry || {}, 'agentId')
      ? !validFullWorkflowProgress(entry)
      : !validSparseWorkflowProgress(entry)
  ))) return null;
  if (fullProgress.length !== children.length) return null;
  const progressIds = fullProgress.map((entry) => entry.agentId);
  if (new Set(progressIds).size !== progressIds.length || progressIds.some((agentId) => !childIds.has(agentId))) return null;

  const byAgent = new Map();
  for (const record of journalRecords || []) {
    if (!childIds.has(record.agentId)) return null;
    const values = byAgent.get(record.agentId) || [];
    values.push(record);
    byAgent.set(record.agentId, values);
  }
  const keys = new Set();
  // Claude's observed journal key is an opaque pair key, not a second run or
  // session identity.  Ownership therefore comes from the contained run
  // directory, manifest progress, child agent identity, and the exact ordered
  // started/result pair; do not invent a key format that the source does not
  // provide.
  for (const child of children) {
    const records = byAgent.get(child.agentId) || [];
    const started = records.filter((record) => record.kind === 'started');
    const results = records.filter((record) => record.kind === 'result');
    if (records.length !== 2 || started.length !== 1 || results.length !== 1) return null;
    if (
      started[0].key !== results[0].key
      || started[0].sequence >= results[0].sequence
      || keys.has(started[0].key)
    ) return null;
    keys.add(started[0].key);
  }
  return launches[0];
}

async function directDerivedCandidates(parentCandidate, parentSession, subagentsRoot, entries, signal) {
  const candidates = [];
  const forked = [];
  for (const entry of entries) {
    throwIfAborted(signal);
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const base = path.basename(entry.name, '.jsonl');
    if (!base.startsWith('agent-') || base.length === 'agent-'.length) continue;
    const agentId = base.slice('agent-'.length);
    const filePath = await containedRealPath(
      parentCandidate.sourceRoot,
      path.join(subagentsRoot, entry.name),
    );
    if (!filePath) continue;
    const [metadataValue, skillValue, markerValue, inspected] = await Promise.all([
      readJsonObjectWithEvidence(
        parentCandidate.sourceRoot,
        path.join(subagentsRoot, `${base}.meta.json`),
      ),
      readJsonObjectWithEvidence(
        parentCandidate.sourceRoot,
        path.join(subagentsRoot, `${base}.forked-skill.json`),
      ),
      readJsonObjectWithEvidence(
        parentCandidate.sourceRoot,
        path.join(subagentsRoot, `${base}.forked-skill.marker.json`),
      ),
      inspectDerivedTranscript(parentCandidate, filePath, signal),
    ]);
    if (metadataValue.evidence.unsafe || skillValue.evidence.unsafe || markerValue.evidence.unsafe) continue;
    const hasForkEvidence = skillValue.evidence.exists || markerValue.evidence.exists;
    if (hasForkEvidence) {
      forked.push({ inspected, agentId, metadataValue, skillValue, markerValue });
      continue;
    }
    const candidate = normalSubagentCandidate(
      parentSession,
      inspected,
      agentId,
      metadataValue,
      skillValue,
      markerValue,
    );
    if (candidate) candidates.push(candidate);
  }

  const launchesBySkill = new Map();
  for (const launch of forkedSkillLaunches(parentSession)) {
    const matches = launchesBySkill.get(launch.skillName) || [];
    matches.push(launch);
    launchesBySkill.set(launch.skillName, matches);
  }
  const candidatesBySkill = new Map();
  for (const value of forked) {
    const skillName = exactText(value.skillValue.metadata.skillName);
    if (!skillName) continue;
    const matches = candidatesBySkill.get(skillName) || [];
    matches.push(value);
    candidatesBySkill.set(skillName, matches);
  }
  for (const [skillName, values] of candidatesBySkill) {
    const launches = launchesBySkill.get(skillName) || [];
    if (values.length !== 1 || launches.length !== 1) continue;
    const candidate = forkedSkillCandidate(parentSession, values[0], launches[0]);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

async function workflowDerivedCandidates(parentCandidate, parentSession, subagentsRoot, signal) {
  const workflowAgentsRoot = path.join(subagentsRoot, 'workflows');
  const safeWorkflowAgentsRoot = await containedRealPath(parentCandidate.sourceRoot, workflowAgentsRoot);
  if (!safeWorkflowAgentsRoot) return [];
  let runs;
  try {
    runs = await fsp.readdir(safeWorkflowAgentsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const candidates = [];
  for (const runEntry of runs.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(signal);
    if (!runEntry.isDirectory() || !runEntry.name || ['.', '..'].includes(runEntry.name)) continue;
    const runId = runEntry.name;
    const runRoot = await containedRealPath(
      parentCandidate.sourceRoot,
      path.join(workflowAgentsRoot, runId),
    );
    if (!runRoot) continue;
    let entries;
    try {
      entries = await fsp.readdir(runRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const manifestValue = await readJsonObjectWithEvidence(
      parentCandidate.sourceRoot,
      path.join(parentCandidate.containerPath, path.basename(parentCandidate.filePath, '.jsonl'), 'workflows', `${runId}.json`),
    );
    const journalValue = await readContainedTextWithEvidence(
      parentCandidate.sourceRoot,
      path.join(runRoot, 'journal.jsonl'),
    );
    if (!manifestValue.evidence.exists || !manifestValue.valid || manifestValue.evidence.unsafe) continue;
    if (!journalValue.evidence.exists || !journalValue.valid || journalValue.evidence.unsafe) continue;
    const journalRecords = parseWorkflowJournal(journalValue.text);
    if (!journalRecords) continue;

    const runChildren = [];
    let invalidRun = false;
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl') || entry.name === 'journal.jsonl') continue;
      const base = path.basename(entry.name, '.jsonl');
      if (!base.startsWith('agent-') || base.length === 'agent-'.length) {
        invalidRun = true;
        break;
      }
      const agentId = base.slice('agent-'.length);
      const filePath = await containedRealPath(parentCandidate.sourceRoot, path.join(runRoot, entry.name));
      if (!filePath) {
        invalidRun = true;
        break;
      }
      const [metadataValue, inspected] = await Promise.all([
        readJsonObjectWithEvidence(
          parentCandidate.sourceRoot,
          path.join(runRoot, `${base}.meta.json`),
        ),
        inspectDerivedTranscript(parentCandidate, filePath, signal),
      ]);
      if (
        !metadataValue.evidence.exists
        || !metadataValue.valid
        || metadataValue.evidence.unsafe
        || typeof metadataValue.metadata.agentType !== 'string'
        || !Number.isFinite(metadataValue.metadata.spawnDepth)
        || !derivedTranscriptMatches(inspected, parentSession, agentId, true)
      ) {
        invalidRun = true;
        break;
      }
      runChildren.push({ agentId, inspected, metadataValue });
    }
    if (invalidRun || !runChildren.length) continue;
    const launch = workflowRunEvidence(
      parentSession,
      runId,
      manifestValue.metadata,
      journalRecords,
      runChildren,
    );
    if (!launch) continue;
    for (const child of runChildren) {
      child.inspected.sourceSessionId = parentSession.sourceSessionId;
      const files = [
        { role: 'metadata', evidence: child.metadataValue.evidence },
        { role: 'workflow-manifest', evidence: manifestValue.evidence },
        { role: 'workflow-journal', evidence: journalValue.evidence },
      ];
      candidates.push({
        candidate: child.inspected,
        metadataEvidence: child.metadataValue.evidence,
        relationshipReuseEvidence: {
          kind: 'workflow-agent',
          parentEventId: launch.event.id,
          runId,
          taskId: launch.taskId,
          toolUseId: launch.toolUseId,
          files: reuseEvidenceFiles(files),
        },
        context: {
          id: analyzerWorkflowAgentSessionId(parentSession.sourceSessionId, runId, child.agentId),
          derivedKind: 'workflow-agent',
          derivedId: child.agentId,
          agentId: child.agentId,
          runId,
          parentSessionId: parentSession.id,
          agentNickname: child.metadataValue.metadata.agentType,
          description: manifestValue.metadata.workflowName,
          toolUseId: launch.toolUseId,
          spawnDepth: child.metadataValue.metadata.spawnDepth,
          inheritedCwds: parentSession.cwdSet,
          matchesRepo: true,
          projectAssociation: 'parent-inherited',
          derivedRelationship: {
            kind: 'workflow-agent',
            ownerSessionId: parentSession.id,
            parentEventId: launch.event.id,
            parentRawRefs: launch.event.rawRefs,
            agentId: child.agentId,
            runId,
            taskId: launch.taskId,
            toolUseId: launch.toolUseId,
            workflowName: launch.workflowName,
            evidenceFiles: publicEvidenceFiles(files),
          },
        },
      });
    }
  }
  return candidates;
}

async function subagentCandidates(parentCandidate, parentSession, signal) {
  const sourceFileSessionId = path.basename(parentCandidate.filePath, '.jsonl');
  const subagentsRoot = path.join(
    parentCandidate.containerPath,
    sourceFileSessionId,
    'subagents',
  );
  const safeSubagentsRoot = await containedRealPath(parentCandidate.sourceRoot, subagentsRoot);
  if (!safeSubagentsRoot) return [];
  let entries;
  try {
    entries = await fsp.readdir(safeSubagentsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
  const [direct, workflow] = await Promise.all([
    directDerivedCandidates(parentCandidate, parentSession, subagentsRoot, sortedEntries, signal),
    workflowDerivedCandidates(parentCandidate, parentSession, subagentsRoot, signal),
  ]);
  return [...direct, ...workflow];
}

function containerCwdClusters(inspected) {
  const clusters = new Map();
  for (const candidate of inspected) {
    if (!clusters.has(candidate.containerPath)) clusters.set(candidate.containerPath, new Map());
    const cluster = clusters.get(candidate.containerPath);
    for (const cwd of candidate.cwdSet) cluster.set(normalizeFsPath(cwd), cwd);
  }
  return clusters;
}

function candidateProjectAssociation(candidate, repoRoot, clusters) {
  if ([...candidate.cwdSet].some((cwd) => isPathInsideOrSame(cwd, repoRoot))) return 'embedded-cwd';
  if (candidate.cwdSet.size) return '';
  const cluster = clusters.get(candidate.containerPath);
  if (!cluster || cluster.size !== 1) return '';
  return isPathInsideOrSame([...cluster.values()][0], repoRoot) ? 'container-inferred' : '';
}

function eventKindCatalog(sessions) {
  const maps = { main: new Map(), protocol: new Map(), raw: new Map() };
  const add = (layer, value) => {
    const key = String(value || '').trim();
    if (!key) return;
    maps[layer].set(key, (maps[layer].get(key) || 0) + 1);
  };
  for (const session of sessions) {
    for (const event of session.logicalEvents) {
      if (event.layer === 'protocol') add('protocol', event.subtype || event.kind);
      else add('main', event.kind);
    }
    for (const raw of session.rawEvents) add('raw', raw.payloadType || raw.recordType);
  }
  const items = (map) => [...map.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, label: value, count }));
  return {
    main: items(maps.main),
    protocol: items(maps.protocol),
    raw: items(maps.raw),
  };
}

const CLAUDE_COMMITTED_PROJECTION_FIELDS = Object.freeze([
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
]);

function cloneClaudeProjectionValue(value) {
  return value === null || typeof value !== 'object' ? value : structuredClone(value);
}

function compactClaudeRelationshipSession(session) {
  return {
    id: session.id,
    sourceSessionId: session.sourceSessionId,
    sourceAbsFile: session.sourceAbsFile,
    parentSessionId: session.parentSessionId,
    parentSessionInferred: session.parentSessionInferred,
    projectAssociation: session.projectAssociation,
    matchesRepo: session.matchesRepo,
    cwdSet: new Set(session.cwdSet),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    transcriptUpdatedAt: session.transcriptUpdatedAt,
    forkedFromSessionId: session.forkedFromSessionId,
    forkStorageMode: session.forkStorageMode,
    forkedAt: session.forkedAt,
    forkPointUuid: session.forkPointUuid,
    forkContinuationState: session.forkContinuationState,
    forkEvidence: cloneClaudeProjectionValue(session.forkEvidence),
    inheritedContext: cloneClaudeProjectionValue(session.inheritedContext),
    _relationshipFacts: compactClaudeForkRelationshipFacts(session),
    _foreignSessionIds: new Set(session._foreignSessionIds || []),
    _rawUuidSet: new Set(session._rawUuidSet || []),
  };
}

function claudeCommittedProjection(session) {
  const projection = {};
  for (const field of CLAUDE_COMMITTED_PROJECTION_FIELDS) {
    projection[field] = cloneClaudeProjectionValue(session[field]);
  }
  projection.cwdSet = [...(session.cwdSet || [])].map(String);
  return projection;
}

function applyClaudeCommittedProjection(session, projection) {
  for (const field of CLAUDE_COMMITTED_PROJECTION_FIELDS) {
    session[field] = cloneClaudeProjectionValue(projection[field]);
  }
  session.cwdSet = new Set(projection.cwdSet || []);
  session.matchesRepo = true;
  session.transcriptUpdatedAt = session.updatedAt;
  return session;
}

function applyClaudeMaterializedForkOwnership(session, errorFactory) {
  if (session.forkStorageMode !== 'materialized') return session;
  const copiedRawRecordCount = session.forkEvidence?.copiedRawRecordCount;
  if (!Number.isSafeInteger(copiedRawRecordCount)
      || copiedRawRecordCount <= 0
      || copiedRawRecordCount > session.rawEvents.length) {
    throw errorFactory();
  }
  const copiedRawIds = new Set(
    session.rawEvents.slice(0, copiedRawRecordCount).map((raw) => raw.rawId),
  );
  const continuationEvents = [];
  for (const event of session.logicalEvents) {
    const refs = event.rawRefs || [];
    const copiedRefCount = refs.filter((ref) => copiedRawIds.has(ref.rawId)).length;
    if (copiedRefCount > 0 && copiedRefCount !== refs.length) throw errorFactory();
    if (copiedRefCount === 0) continuationEvents.push(event);
  }
  const continuationRawEvents = session.rawEvents.slice(copiedRawRecordCount);
  session.logicalEvents = continuationEvents;
  session.counts = emptyCounts();
  session.analysis = null;
  session.presentationIndexes = { codeModeDeclaredRequests: new Map() };
  session._customTitle = '';
  session._aiTitle = '';
  session._agentName = '';
  session._lastPrompt = '';
  session._subagentDescription = '';
  const continuationTimestamps = continuationRawEvents
    .map((raw) => String(raw.timestamp || ''))
    .filter(Boolean)
    .sort();
  session.startedAt = continuationTimestamps[0] || '';
  session.updatedAt = continuationTimestamps.at(-1) || '';
  for (const raw of continuationRawEvents) {
    const record = raw.parsed;
    if (!isPlainObject(record)) continue;
    if (record.type === 'custom-title' && record.customTitle) {
      session._customTitle = String(record.customTitle);
    }
    if (record.type === 'ai-title' && record.aiTitle) session._aiTitle = String(record.aiTitle);
    if (record.type === 'agent-name' && record.agentName) session._agentName = String(record.agentName);
    if (record.type === 'last-prompt' && record.lastPrompt) {
      session._lastPrompt = String(record.lastPrompt);
    }
  }
  const finalized = finalizeSession(session);
  finalized.analysis.tokenStats = responseUsage(continuationRawEvents);
  return finalized;
}

function projectClaudeCarriedSession(session, summary) {
  const projected = {
    id: String(session.id || ''),
    sourceKind: CLAUDE_SOURCE_KIND,
    sourceSessionId: String(session.sourceSessionId || ''),
    sourceDerivedId: String(session.sourceDerivedId || ''),
    sourceClientVersion: String(session.sourceClientVersion || ''),
    projectAssociation: String(session.projectAssociation || ''),
    title: String(session.title || ''),
    sourceFile: String(session.sourceFile || ''),
    agentNickname: String(session.agentNickname || ''),
    primarySessionMetaKind: String(session.primarySessionMetaKind || ''),
    derivedRunId: String(session.derivedRunId || ''),
    startedAt: String(session.startedAt || ''),
    updatedAt: String(session.updatedAt || ''),
    bytes: Number(session.bytes || 0),
    lineCount: Number(session.lineCount || 0),
    cwdSet: [...(session.cwdSet || [])].map(String),
    counts: { ...emptyCounts(), ...(session.counts || {}) },
    rawEventCount: session.rawEvents.length,
    logicalEventCount: session.logicalEvents.length,
    parentSessionId: String(session.parentSessionId || ''),
    forkedFromSessionId: String(session.forkedFromSessionId || ''),
    forkStorageMode: String(session.forkStorageMode || ''),
    forkedAt: String(session.forkedAt || ''),
    forkPointUuid: String(session.forkPointUuid || ''),
    forkContinuationState: String(session.forkContinuationState || ''),
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    parentSessionInferred: Boolean(session.parentSessionInferred),
    forkEvidence: cloneClaudeProjectionValue(session.forkEvidence),
    inheritedContext: cloneClaudeProjectionValue(session.inheritedContext),
    summary: structuredClone(summary),
  };
  for (const field of ['derivedRelationship', 'subagentToolUseId', 'spawnDepth']) {
    if (Object.hasOwn(session, field)) projected[field] = cloneClaudeProjectionValue(session[field]);
  }
  return projected;
}

function createClaudeCatalogAccumulator() {
  const counts = { main: new Map(), protocol: new Map(), raw: new Map() };
  return {
    addSession(session) {
      const catalog = eventKindCatalog([session]);
      for (const layer of ['main', 'protocol', 'raw']) {
        for (const item of catalog[layer]) {
          counts[layer].set(item.value, (counts[layer].get(item.value) || 0) + item.count);
        }
      }
    },
    finish() {
      const items = (values) => [...values.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([value, count]) => ({ value, label: value, count }));
      return {
        main: items(counts.main),
        protocol: items(counts.protocol),
        raw: items(counts.raw),
      };
    },
  };
}

function hashClaudeMaterializationValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('base64url');
}

function claudeTranscriptDependency(role, candidate) {
  return {
    role,
    pathIdentity: candidate.relFile,
    existence: 'present',
    kind: 'file',
    policy: 'accepted_prefix',
    acceptedBytes: candidate.bytes,
    lineCount: candidate.lineCount,
    digest: candidate.transcriptFingerprint,
    directoryEntries: [],
    evidence: { fileIdentity: structuredClone(candidate.sourceIdentity) },
  };
}

async function captureClaudeReuseTreeSnapshot(sourceRoot, containers, signal, knownCandidates = []) {
  const roots = [...new Set(containers.map((container) => path.resolve(container.path)))];
  const knownFiles = new Map(knownCandidates.map((candidate) => [
    normalizeFsPath(candidate.relFile),
    candidate,
  ]));
  const snapshot = [];
  const visit = async (directory) => {
    throwIfAborted(signal);
    const safeDirectory = await containedRealPath(sourceRoot, directory);
    if (!safeDirectory) return;
    const stat = await fsp.stat(safeDirectory);
    if (!stat.isDirectory()) return;
    const entries = (await fsp.readdir(safeDirectory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    snapshot.push({
      pathIdentity: relativeSourceFile(sourceRoot, safeDirectory) || '.',
      kind: 'directory',
      fileIdentity: sourceFileIdentity(stat),
      entries: entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      })),
    });
    if (snapshot.length > 65_536) throw sourceSnapshotChangedError();
    for (const entry of entries) {
      const target = path.join(safeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const pathIdentity = relativeSourceFile(sourceRoot, target);
      const known = knownFiles.get(normalizeFsPath(pathIdentity));
      if (known) {
        snapshot.push({
          pathIdentity,
          kind: 'file',
          fileIdentity: structuredClone(known.sourceIdentity),
          bytes: known.bytes,
          digest: known.transcriptFingerprint,
        });
        if (snapshot.length > 65_536) throw sourceSnapshotChangedError();
        continue;
      }
      const before = await fsp.stat(target);
      const value = await readClaudeDependencyPrefix(target, before.size, signal);
      const after = await fsp.stat(target);
      if (value.bytesRead !== before.size
          || after.size !== before.size
          || !sameSourceIdentity(sourceFileIdentity(before), sourceFileIdentity(after))) {
        throw sourceSnapshotChangedError();
      }
      snapshot.push({
        pathIdentity,
        kind: 'file',
        fileIdentity: sourceFileIdentity(before),
        bytes: before.size,
        digest: value.digest,
      });
      if (snapshot.length > 65_536) throw sourceSnapshotChangedError();
    }
  };
  for (const root of roots.sort((left, right) => left.localeCompare(right))) await visit(root);
  return snapshot;
}

async function canReuseStrictClaudeIndex(previousIndex, currentEvidence, signal) {
  throwIfAborted(signal);
  const previousEvidence = claudeStrictReuseEvidenceByIndex.get(previousIndex);
  if (!previousEvidence || !isDeepStrictEqual(previousEvidence, currentEvidence)) return false;
  return previousIndex.materializationDependencies instanceof Map;
}

function claudeAcceptedSourceSnapshot(candidate) {
  return {
    acceptedBytes: candidate.bytes,
    digest: candidate.transcriptFingerprint,
    fileIdentity: structuredClone(candidate.sourceIdentity),
  };
}

function requireExactClaudeKeys(value, keys, owner) {
  const actual = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${owner} must contain exactly ${expected.join(', ')}`);
  }
}

function isCanonicalClaudeDependencyPath(sourceRoot, value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const resolved = path.resolve(sourceRoot, value);
  if (!isPathInsideOrSame(resolved, sourceRoot)) return false;
  return (relativeSourceFile(sourceRoot, resolved) || '.') === value;
}

async function createClaudeMaterializationState(evidence) {
  const entries = [claudeTranscriptDependency('session_transcript', evidence.candidate)];
  const dependencySet = {
    schemaVersion: CLAUDE_MATERIALIZATION_SCHEMA_VERSION,
    id: '',
    sourceKind: CLAUDE_SOURCE_KIND,
    entries,
  };
  dependencySet.id = `claude-dependency:${hashClaudeMaterializationValue(entries)}`;
  const payload = {
    sourceFile: evidence.candidate.relFile,
    description: String(evidence.context.description || ''),
    projection: claudeCommittedProjection(evidence.stub),
  };
  const sourceSnapshotId = `claude-snapshot:${hashClaudeMaterializationValue({
    dependencySet,
    payload,
  })}`;
  return {
    dependencySet,
    descriptor: {
      schemaVersion: CLAUDE_MATERIALIZATION_SCHEMA_VERSION,
      dependencySetId: dependencySet.id,
      sourceSnapshotId,
      payload,
    },
  };
}

function claudeParseContextFromIndexed(indexedSession, descriptor, repoRoot, signal) {
  return {
    id: indexedSession.id,
    derivedKind: indexedSession.primarySessionMetaKind,
    derivedId: indexedSession.sourceDerivedId,
    agentId: indexedSession.sourceDerivedId,
    runId: indexedSession.derivedRunId,
    parentSessionId: indexedSession.parentSessionId,
    agentNickname: indexedSession.agentNickname,
    description: descriptor.payload.description,
    toolUseId: indexedSession.subagentToolUseId || '',
    spawnDepth: Object.hasOwn(indexedSession, 'spawnDepth') ? indexedSession.spawnDepth : null,
    inheritedCwds: indexedSession.cwdSet,
    matchesRepo: true,
    projectAssociation: indexedSession.projectAssociation,
    derivedRelationship: indexedSession.derivedRelationship || null,
    repoRoot,
    signal,
  };
}

async function buildClaudeSourceBackedIndex({
  repoRoot,
  claudeHome,
  onProgress,
  onTransientMemorySample,
  signal,
  previousIndex = null,
}) {
  const resolvedRepo = resolveFsPath(repoRoot);
  const resolvedClaude = path.resolve(claudeHome);
  const started = Date.now();
  throwIfAborted(signal);
  emitProgress(onProgress, {
    phase: 'scanning',
    repoRoot: resolvedRepo,
    filesTotal: 0,
    filesScanned: 0,
    candidateFileCount: 0,
    skippedFileCount: 0,
    unknownFileCount: 0,
    indexedFileCount: 0,
    indexedBytes: 0,
    elapsedMs: 0,
  });

  const discovery = await discoverMainCandidates(resolvedClaude);
  const inspected = [];
  for (const candidate of discovery.candidates) {
    throwIfAborted(signal);
    inspected.push(await inspectClaudeSessionFile(candidate, { signal }));
    emitProgress(onProgress, {
      phase: 'selecting',
      repoRoot: resolvedRepo,
      filesTotal: discovery.candidates.length,
      filesScanned: inspected.length,
      candidateFileCount: 0,
      skippedFileCount: 0,
      unknownFileCount: 0,
      indexedFileCount: 0,
      indexedBytes: 0,
      elapsedMs: Date.now() - started,
    });
  }

  const currentStrictReuseEvidence = {
    sourceRoot: discovery.sourceRoot,
    repoRoot: resolvedRepo,
    candidates: inspected
      .map(candidateReuseEvidence)
      .sort((left, right) => left.relFile.localeCompare(right.relFile)),
    tree: await captureClaudeReuseTreeSnapshot(
      discovery.sourceRoot,
      discovery.containers,
      signal,
      inspected,
    ),
  };
  if (previousIndex?.sourceKind === CLAUDE_SOURCE_KIND
      && normalizeFsPath(previousIndex.repoRoot || '') === normalizeFsPath(resolvedRepo)
      && path.resolve(previousIndex.claudeHome || previousIndex.sourceHome || '') === resolvedClaude
      && await canReuseStrictClaudeIndex(previousIndex, currentStrictReuseEvidence, signal)) {
    const reusedIndex = {
      ...previousIndex,
      generatedAt: new Date().toISOString(),
      totals: {
        ...previousIndex.totals,
        reusedFileCount: previousIndex.sessions.length,
      },
    };
    claudeStrictReuseEvidenceByIndex.set(reusedIndex, currentStrictReuseEvidence);
    emitProgress(onProgress, {
      phase: 'complete',
      repoRoot: resolvedRepo,
      filesTotal: discovery.candidates.length,
      filesScanned: discovery.candidates.length,
      ...reusedIndex.totals,
      elapsedMs: Date.now() - started,
    });
    return reusedIndex;
  }

  const identityResolution = resolvePrimaryIdentityCandidates(inspected);
  const identityCandidates = identityResolution.accepted;
  const clusters = containerCwdClusters(identityCandidates);
  const candidates = identityCandidates
    .map((candidate) => ({
      ...candidate,
      projectAssociation: candidateProjectAssociation(candidate, resolvedRepo, clusters),
    }))
    .filter((candidate) => candidate.projectAssociation || candidate.cwdSet.size === 0)
    .map((candidate) => ({
      ...candidate,
      projectAssociation: candidate.projectAssociation || POINTER_PROVISIONAL_ASSOCIATION,
    }));
  const selectedCandidates = candidates.filter((candidate) => (
    candidate.projectAssociation !== POINTER_PROVISIONAL_ASSOCIATION
  ));
  const skippedFileCount = identityCandidates.filter((candidate) => (
    candidate.cwdSet.size && !candidateProjectAssociation(candidate, resolvedRepo, clusters)
  )).length;
  const relationshipEvidence = [];
  const evidenceByStub = new WeakMap();
  let indexedFileCount = 0;
  let indexedBytes = 0;
  emitProgress(onProgress, {
    phase: 'parsing',
    repoRoot: resolvedRepo,
    filesTotal: discovery.candidates.length,
    filesScanned: discovery.candidates.length,
    candidateFileCount: selectedCandidates.length,
    skippedFileCount,
    unknownFileCount: inspected.length - selectedCandidates.length - skippedFileCount,
    indexedFileCount,
    reusedFileCount: 0,
    indexedBytes,
    candidateBytes: selectedCandidates.reduce((sum, item) => sum + item.bytes, 0),
    sessionCount: 0,
    eventCount: 0,
    rawEventCount: 0,
    elapsedMs: Date.now() - started,
  });

  const addEvidence = (candidate, context, session, relationshipReuseEvidence = null) => {
    const stub = compactClaudeRelationshipSession(session);
    const evidence = { candidate, context, relationshipReuseEvidence, stub };
    relationshipEvidence.push(evidence);
    evidenceByStub.set(stub, evidence);
  };

  for (const candidate of candidates) {
    throwIfAborted(signal);
    const isPointerProvisional = candidate.projectAssociation === POINTER_PROVISIONAL_ASSOCIATION;
    const mainContext = {
      repoRoot: resolvedRepo,
      signal,
      matchesRepo: !isPointerProvisional,
      projectAssociation: candidate.projectAssociation,
      acceptedSourceSnapshot: claudeAcceptedSourceSnapshot(candidate),
    };
    let mainSession = await parseClaudeSession(candidate, mainContext);
    const derivedCandidates = isPointerProvisional
      ? []
      : await subagentCandidates(candidate, mainSession, signal);
    if (typeof onTransientMemorySample === 'function') {
      onTransientMemorySample({ phase: 'pre_raw_compaction' });
    }
    addEvidence(candidate, mainContext, mainSession);
    mainSession = null;
    if (!isPointerProvisional) {
      indexedFileCount += 1;
      indexedBytes += candidate.bytes;
    }
    for (const derived of derivedCandidates) {
      throwIfAborted(signal);
      const derivedContext = {
        ...derived.context,
        repoRoot: resolvedRepo,
        signal,
        acceptedSourceSnapshot: claudeAcceptedSourceSnapshot(derived.candidate),
      };
      let derivedSession = await parseClaudeSession(derived.candidate, derivedContext);
      if (typeof onTransientMemorySample === 'function') {
        onTransientMemorySample({ phase: 'pre_raw_compaction' });
      }
      addEvidence(
        derived.candidate,
        derivedContext,
        derivedSession,
        derived.relationshipReuseEvidence,
      );
      derivedSession = null;
      indexedFileCount += 1;
      indexedBytes += derived.candidate.bytes;
    }
  }

  const analyzerIdentityResolution = resolveClaudeAnalyzerIdentities(
    relationshipEvidence.map((evidence) => evidence.stub),
  );
  inferClaudeForkRelationships(analyzerIdentityResolution.accepted);
  const retainedEvidence = analyzerIdentityResolution.accepted
    .filter((session) => session.matchesRepo)
    .map((session) => evidenceByStub.get(session));
  const queryStoreBuilder = createProjectQueryStoreBuilder({
    presentationForEvent: claudeSearch.projectQueryPresentation,
  });
  const catalogAccumulator = createClaudeCatalogAccumulator();
  const indexedSessions = [];
  const materializationDependencies = new Map();
  let logicalEventCount = 0;
  let rawEventCount = 0;
  indexedFileCount = 0;
  indexedBytes = 0;

  for (const evidence of retainedEvidence) {
    throwIfAborted(signal);
    const context = {
      ...evidence.context,
      repoRoot: resolvedRepo,
      signal,
      acceptedSourceSnapshot: claudeAcceptedSourceSnapshot(evidence.candidate),
    };
    let session = await parseClaudeSession(evidence.candidate, context);
    if (typeof onTransientMemorySample === 'function') {
      onTransientMemorySample({ phase: 'pre_raw_compaction' });
    }
    applyClaudeCommittedProjection(session, claudeCommittedProjection(evidence.stub));
    applyClaudeMaterializedForkOwnership(session, sourceSnapshotChangedError);
    const queryProjectionDigest = queryStoreBuilder.addSession(session);
    catalogAccumulator.addSession(session);
    const summary = claudeSearch.projectSessionMetadata(session).summary;
    const materializationState = await createClaudeMaterializationState(evidence);
    const existingDependencySet = materializationDependencies.get(
      materializationState.dependencySet.id,
    );
    const dependencySet = existingDependencySet || materializationState.dependencySet;
    materializationDependencies.set(dependencySet.id, dependencySet);
    const indexedSession = {
      ...projectClaudeCarriedSession(session, summary),
      materializationDescriptor: {
        ...materializationState.descriptor,
        dependencySetId: dependencySet.id,
      },
      queryShardId: session.id,
      queryProjectionDigest,
    };
    indexedSessions.push(indexedSession);
    logicalEventCount += indexedSession.logicalEventCount;
    rawEventCount += indexedSession.rawEventCount;
    indexedFileCount += 1;
    indexedBytes += indexedSession.bytes;
    session = null;
    if (typeof onTransientMemorySample === 'function') {
      onTransientMemorySample({ phase: 'post_finalize' });
    }
  }

  indexedSessions.sort((left, right) => (
    String(right.updatedAt || right.startedAt).localeCompare(String(left.updatedAt || left.startedAt))
    || left.id.localeCompare(right.id)
  ));
  const sessionsById = new Map(indexedSessions.map((session) => [session.id, session]));
  const projectQueryStore = queryStoreBuilder.finish();
  const eventKinds = catalogAccumulator.finish();
  const legacyRawOwners = {
    schemaVersion: 1,
    sourceKind: CLAUDE_SOURCE_KIND,
    entryCount: 0,
    accountedBytes: 2,
    payload: {},
  };
  const candidateFileCount = indexedSessions.filter((session) => !session.parentSessionId).length;
  const candidateBytes = indexedSessions
    .filter((session) => !session.parentSessionId)
    .reduce((sum, session) => sum + session.bytes, 0);
  const unknownFileCount = inspected.length - candidateFileCount - skippedFileCount;
  let reusedFileCount = 0;
  let committedSessions = indexedSessions;
  let committedSessionsById = sessionsById;
  let committedQueryStore = projectQueryStore;
  let committedDependencies = materializationDependencies;
  let committedLegacyOwners = legacyRawOwners;
  let committedEventKinds = eventKinds;
  if (previousIndex?.sourceKind === CLAUDE_SOURCE_KIND
      && normalizeFsPath(previousIndex.repoRoot || '') === normalizeFsPath(resolvedRepo)
      && path.resolve(previousIndex.claudeHome || previousIndex.sourceHome || '') === resolvedClaude
      && isDeepStrictEqual(previousIndex.sessions, indexedSessions)
      && isDeepStrictEqual(previousIndex.materializationDependencies, materializationDependencies)
      && isDeepStrictEqual(previousIndex.projectQueryStore, projectQueryStore)
      && isDeepStrictEqual(previousIndex.legacyRawOwners, legacyRawOwners)
      && isDeepStrictEqual(previousIndex.eventKinds, eventKinds)) {
    reusedFileCount = indexedSessions.length;
    committedSessions = previousIndex.sessions;
    committedSessionsById = previousIndex.sessionsById;
    committedQueryStore = previousIndex.projectQueryStore;
    committedDependencies = previousIndex.materializationDependencies;
    committedLegacyOwners = previousIndex.legacyRawOwners;
    committedEventKinds = previousIndex.eventKinds;
  }
  emitProgress(onProgress, {
    phase: 'complete',
    repoRoot: resolvedRepo,
    filesTotal: discovery.candidates.length,
    filesScanned: discovery.candidates.length,
    candidateFileCount,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount,
    reusedFileCount,
    indexedBytes,
    candidateBytes,
    sessionCount: indexedSessions.length,
    eventCount: logicalEventCount,
    rawEventCount,
    elapsedMs: Date.now() - started,
  });
  const result = {
    sourceKind: CLAUDE_SOURCE_KIND,
    sourceHome: resolvedClaude,
    sourceRoot: discovery.sourceRoot,
    claudeHome: resolvedClaude,
    projectsRoot: discovery.projectsRoot,
    repoRoot: resolvedRepo,
    generatedAt: new Date().toISOString(),
    sessions: committedSessions,
    sessionsById: committedSessionsById,
    projectQueryStore: committedQueryStore,
    materializationDependencies: committedDependencies,
    legacyRawOwners: committedLegacyOwners,
    eventKinds: committedEventKinds,
    codeModeRequests: [],
    totals: {
      fileCount: discovery.candidates.length,
      candidateFileCount,
      indexedFileCount,
      reusedFileCount,
      skippedFileCount,
      unknownFileCount,
      sessionCount: indexedSessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      indexedBytes,
      candidateBytes,
    },
  };
  claudeStrictReuseEvidenceByIndex.set(result, currentStrictReuseEvidence);
  return result;
}

async function buildClaudeIndex({ repoRoot, claudeHome, onProgress, signal, previousIndex = null }) {
  const resolvedRepo = resolveFsPath(repoRoot);
  const resolvedClaude = path.resolve(claudeHome);
  const started = Date.now();
  throwIfAborted(signal);
  emitProgress(onProgress, {
    phase: 'scanning',
    repoRoot: resolvedRepo,
    filesTotal: 0,
    filesScanned: 0,
    candidateFileCount: 0,
    skippedFileCount: 0,
    unknownFileCount: 0,
    indexedFileCount: 0,
    indexedBytes: 0,
    elapsedMs: 0,
  });

  const discovery = await discoverMainCandidates(resolvedClaude);
  const inspected = [];
  for (const candidate of discovery.candidates) {
    throwIfAborted(signal);
    inspected.push(await inspectClaudeSessionFile(candidate, { signal }));
    emitProgress(onProgress, {
      phase: 'selecting',
      repoRoot: resolvedRepo,
      filesTotal: discovery.candidates.length,
      filesScanned: inspected.length,
      candidateFileCount: 0,
      skippedFileCount: 0,
      unknownFileCount: 0,
      indexedFileCount: 0,
      indexedBytes: 0,
      elapsedMs: Date.now() - started,
    });
  }

  const identityResolution = resolvePrimaryIdentityCandidates(inspected);
  const identityCandidates = identityResolution.accepted;
  const clusters = containerCwdClusters(identityCandidates);
  const candidates = identityCandidates
    .map((candidate) => ({
      ...candidate,
      projectAssociation: candidateProjectAssociation(candidate, resolvedRepo, clusters),
    }))
    .filter((candidate) => candidate.projectAssociation || candidate.cwdSet.size === 0)
    .map((candidate) => ({
      ...candidate,
      projectAssociation: candidate.projectAssociation || POINTER_PROVISIONAL_ASSOCIATION,
    }));
  const selectedCandidates = candidates.filter((candidate) => (
    candidate.projectAssociation !== POINTER_PROVISIONAL_ASSOCIATION
  ));
  const selectedCandidateBytes = selectedCandidates.reduce((sum, item) => sum + item.bytes, 0);
  const currentRelationshipEvidence = relationshipReuseEvidence(candidates);
  const skippedFileCount = identityCandidates.filter((candidate) => (
    candidate.cwdSet.size && !candidateProjectAssociation(candidate, resolvedRepo, clusters)
  )).length;
  let unknownFileCount = inspected.length - selectedCandidates.length - skippedFileCount;
  const sessions = [];
  let indexedFileCount = 0;
  let indexedBytes = 0;
  let reusedFileCount = 0;
  const canReusePrevious = previousIndex
    && Array.isArray(previousIndex.sessions)
    && normalizeFsPath(previousIndex.repoRoot || '') === normalizeFsPath(resolvedRepo)
    && path.resolve(previousIndex.claudeHome || previousIndex.sourceHome || '') === resolvedClaude;
  const previousMainBySource = new Map();
  const previousDerivedBySource = new Map();
  if (canReusePrevious) {
    for (const session of previousIndex.sessions) {
      const evidence = claudeReuseEvidenceBySession.get(session);
      if (!evidence) continue;
      const key = `${session.sourceFile}\u0000${session.id}`;
      if (session.parentSessionId) previousDerivedBySource.set(key, session);
      else previousMainBySource.set(key, session);
    }
  }

  emitProgress(onProgress, {
    phase: 'parsing',
    repoRoot: resolvedRepo,
    filesTotal: discovery.candidates.length,
    filesScanned: discovery.candidates.length,
    candidateFileCount: selectedCandidates.length,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount,
    reusedFileCount,
    indexedBytes,
    candidateBytes: selectedCandidateBytes,
    sessionCount: 0,
    eventCount: 0,
    rawEventCount: 0,
    elapsedMs: Date.now() - started,
  });

  for (const candidate of candidates) {
    throwIfAborted(signal);
    const isPointerProvisional = candidate.projectAssociation === POINTER_PROVISIONAL_ASSOCIATION;
    const mainContext = {
      repoRoot: resolvedRepo,
      signal,
      matchesRepo: !isPointerProvisional,
      projectAssociation: candidate.projectAssociation,
    };
    const mainKey = `${candidate.relFile}\u0000${analyzerSessionId(candidate.sourceSessionId)}`;
    const previousMain = previousMainBySource.get(mainKey);
    // A top-level transcript can affect pointer and materialized fork inference
    // for any other top-level transcript.  Reuse it only when the whole current
    // relationship input set is unchanged; this is intentionally conservative.
    const tentativeMainReusable = Boolean(previousMain)
      && sameReuseEvidence(
        claudeReuseEvidenceBySession.get(previousMain)?.source,
        candidateReuseEvidence(candidate),
      )
      && sameReuseEvidence(
        claudeReuseEvidenceBySession.get(previousMain)?.relationships,
        currentRelationshipEvidence,
      )
      && await candidateStatStillMatches(candidate);
    let mainSession = tentativeMainReusable
      ? cloneReusedClaudeSession(previousMain, candidate, mainContext)
      : await parseClaudeSession(candidate, mainContext);
    let derivedCandidates = isPointerProvisional
      ? []
      : await subagentCandidates(candidate, mainSession, signal);
    const currentMainEvidence = mainReuseEvidence(
      candidate,
      derivedCandidates,
      currentRelationshipEvidence,
    );
    const mainReusable = tentativeMainReusable
      && sameReuseEvidence(
        comparableMainReuseEvidence(claudeReuseEvidenceBySession.get(previousMain)),
        currentMainEvidence,
      );
    if (!mainReusable && tentativeMainReusable) {
      mainSession = await parseClaudeSession(candidate, mainContext);
      derivedCandidates = await subagentCandidates(candidate, mainSession, signal);
    }
    if (mainReusable) reusedFileCount += 1;
    claudeReuseEvidenceBySession.set(mainSession, {
      ...mainReuseEvidence(candidate, derivedCandidates, currentRelationshipEvidence),
      foreignSessionIds: stableSetValues(mainSession._foreignSessionIds),
      rawUuidSet: stableSetValues(mainSession._rawUuidSet),
    });
    sessions.push(mainSession);
    if (!isPointerProvisional) {
      indexedFileCount += 1;
      indexedBytes += mainSession.bytes;
    }

    for (const derived of derivedCandidates) {
      const derivedContext = {
        ...derived.context,
        repoRoot: resolvedRepo,
        signal,
      };
      const derivedKey = `${derived.candidate.relFile}\u0000${derived.context.id}`;
      const previousDerived = previousDerivedBySource.get(derivedKey);
      const currentDerivedEvidence = derivedReuseEvidence(derived);
      const derivedReusable = mainReusable
        && Boolean(previousDerived)
        && sameReuseEvidence(
          claudeReuseEvidenceBySession.get(previousDerived)?.derived,
          currentDerivedEvidence,
        )
        && await candidateStatStillMatches(derived.candidate);
      const subagent = derivedReusable
        ? cloneReusedClaudeSession(previousDerived, derived.candidate, derivedContext)
        : await parseClaudeSession(derived.candidate, derivedContext);
      if (derivedReusable) reusedFileCount += 1;
      claudeReuseEvidenceBySession.set(subagent, {
        derived: currentDerivedEvidence,
        foreignSessionIds: stableSetValues(subagent._foreignSessionIds),
        rawUuidSet: stableSetValues(subagent._rawUuidSet),
      });
      sessions.push(subagent);
      indexedFileCount += 1;
      indexedBytes += subagent.bytes;
    }
    emitProgress(onProgress, {
      phase: 'parsing',
      repoRoot: resolvedRepo,
      filesTotal: discovery.candidates.length,
      filesScanned: discovery.candidates.length,
      candidateFileCount: selectedCandidates.length,
      skippedFileCount,
      unknownFileCount,
      indexedFileCount,
      reusedFileCount,
      indexedBytes,
      candidateBytes: selectedCandidateBytes,
      sessionCount: sessions.filter((session) => session.matchesRepo).length,
      eventCount: sessions.filter((session) => session.matchesRepo)
        .reduce((sum, item) => sum + item.logicalEvents.length, 0),
      rawEventCount: sessions.filter((session) => session.matchesRepo)
        .reduce((sum, item) => sum + item.rawEvents.length, 0),
      elapsedMs: Date.now() - started,
    });
  }

  const analyzerIdentityResolution = resolveClaudeAnalyzerIdentities(sessions);
  const resolvedSessions = analyzerIdentityResolution.accepted;
  inferClaudeForkRelationships(resolvedSessions);
  const retainedSessions = resolvedSessions.filter((session) => session.matchesRepo);
  retainedSessions.sort((left, right) => (
    String(right.updatedAt || right.startedAt).localeCompare(String(left.updatedAt || left.startedAt))
    || left.id.localeCompare(right.id)
  ));
  const sessionsById = new Map();
  for (const session of retainedSessions) {
    if (sessionsById.has(session.id)) {
      throw new Error(`Duplicate Analyzer Session Identity after Claude identity resolution: ${session.id}`);
    }
    sessionsById.set(session.id, session);
  }
  const primarySessions = retainedSessions.filter((session) => !session.parentSessionId);
  const candidateFileCount = primarySessions.length;
  const logicalEventCount = retainedSessions.reduce((sum, session) => sum + session.logicalEvents.length, 0);
  const rawEventCount = retainedSessions.reduce((sum, session) => sum + session.rawEvents.length, 0);
  const candidateBytes = primarySessions.reduce((sum, session) => sum + session.bytes, 0);
  indexedFileCount = retainedSessions.length;
  indexedBytes = retainedSessions.reduce((sum, session) => sum + session.bytes, 0);
  unknownFileCount = inspected.length - candidateFileCount - skippedFileCount;
  emitProgress(onProgress, {
    phase: 'complete',
    repoRoot: resolvedRepo,
    filesTotal: discovery.candidates.length,
    filesScanned: discovery.candidates.length,
    candidateFileCount,
    skippedFileCount,
    unknownFileCount,
    indexedFileCount,
    reusedFileCount,
    indexedBytes,
    candidateBytes,
    sessionCount: retainedSessions.length,
    eventCount: logicalEventCount,
    rawEventCount,
    elapsedMs: Date.now() - started,
  });

  return {
    sourceKind: CLAUDE_SOURCE_KIND,
    sourceHome: resolvedClaude,
    sourceRoot: discovery.sourceRoot,
    claudeHome: resolvedClaude,
    projectsRoot: discovery.projectsRoot,
    repoRoot: resolvedRepo,
    generatedAt: new Date().toISOString(),
    sessions: retainedSessions,
    sessionsById,
    eventKinds: eventKindCatalog(retainedSessions),
    codeModeRequests: [],
    totals: {
      fileCount: discovery.candidates.length,
      candidateFileCount,
      indexedFileCount,
      reusedFileCount,
      skippedFileCount,
      unknownFileCount,
      sessionCount: retainedSessions.length,
      eventCount: logicalEventCount,
      rawEventCount,
      indexedBytes,
      candidateBytes,
    },
  };
}

async function readClaudeDependencyPrefix(target, acceptedBytes, signal) {
  const hash = crypto.createHash('sha256');
  let bytesRead = 0;
  if (acceptedBytes === 0) return { bytesRead: 0, digest: hash.digest('hex') };
  const stream = fs.createReadStream(target, { start: 0, end: acceptedBytes - 1 });
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      bytesRead += chunk.length;
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }
  return { bytesRead, digest: hash.digest('hex') };
}

async function verifyClaudeMaterializationDependency(sourceRoot, entry, signal) {
  throwIfAborted(signal);
  if (entry.existence === 'absent' && entry.policy === 'copied_value') return;
  const lexicalTarget = path.resolve(sourceRoot, entry.pathIdentity);
  if (!isPathInsideOrSame(lexicalTarget, sourceRoot)) throw indexedSourceStaleError();
  let realTarget;
  try {
    realTarget = await containedRealPath(sourceRoot, lexicalTarget);
  } catch {
    throw indexedSourceStaleError();
  }
  if (!realTarget) throw indexedSourceStaleError();
  let stat;
  try {
    stat = await fsp.stat(realTarget);
  } catch {
    throw indexedSourceStaleError();
  }
  if (!sameSourceIdentity(sourceFileIdentity(stat), entry.evidence?.fileIdentity)) {
    throw indexedSourceStaleError();
  }
  if (entry.kind === 'directory') {
    if (!stat.isDirectory() || entry.policy !== 'directory_snapshot') {
      throw indexedSourceStaleError();
    }
    let names;
    try {
      names = new Set((await fsp.readdir(realTarget, { withFileTypes: true })).map((value) => value.name));
    } catch {
      throw indexedSourceStaleError();
    }
    if (entry.directoryEntries.some((name) => !names.has(name))) throw indexedSourceStaleError();
    return;
  }
  if (!stat.isFile() || stat.size < entry.acceptedBytes) throw indexedSourceStaleError();
  if (entry.policy === 'exact' && stat.size !== entry.acceptedBytes) throw indexedSourceStaleError();
  const value = await readClaudeDependencyPrefix(realTarget, entry.acceptedBytes, signal);
  if (value.bytesRead !== entry.acceptedBytes || value.digest !== entry.digest) {
    throw indexedSourceStaleError();
  }
}

async function materializeClaudeSession({ materializationContext, indexedSession, dependencySet, signal }) {
  throwIfAborted(signal);
  const index = materializationContext;
  const descriptor = indexedSession.materializationDescriptor;
  await observeMaterializationPhase('adapter_source_verification_read', async () => {
    for (const entry of dependencySet.entries) {
      await verifyClaudeMaterializationDependency(index.sourceRoot, entry, signal);
    }
  });
  const sourceEntry = dependencySet.entries[0];
  const sourceFile = descriptor.payload.sourceFile;
  const target = path.resolve(index.sourceRoot, sourceFile);
  if (!isPathInsideOrSame(target, index.sourceRoot)) throw indexedSourceStaleError();
  const realTarget = await observeMaterializationPhase(
    'adapter_source_path_resolution',
    () => containedRealPath(index.sourceRoot, target),
  );
  if (!realTarget) throw indexedSourceStaleError();
  const candidate = {
    filePath: realTarget,
    containerKey: '',
    containerPath: path.dirname(realTarget),
    sourceRoot: index.sourceRoot,
    relFile: sourceFile,
    bytes: sourceEntry.acceptedBytes,
    sourceIdentity: structuredClone(sourceEntry.evidence.fileIdentity),
    sourceUpdatedAt: indexedSession.updatedAt,
    lineCount: sourceEntry.lineCount,
    cwdSet: new Set(indexedSession.cwdSet),
    sourceSessionId: indexedSession.sourceSessionId,
    sourceIdentityConflict: false,
    transcriptFingerprint: sourceEntry.digest,
    sourceClientVersion: indexedSession.sourceClientVersion,
    uuids: new Set(),
    agentIds: new Set(),
    foreignSessionIds: new Set(),
    startedAt: indexedSession.startedAt,
    updatedAt: indexedSession.updatedAt,
  };
  const context = {
    ...claudeParseContextFromIndexed(indexedSession, descriptor, index.repoRoot, signal),
    materialization: true,
    acceptedSourceSnapshot: {
      acceptedBytes: sourceEntry.acceptedBytes,
      digest: sourceEntry.digest,
      fileIdentity: structuredClone(sourceEntry.evidence.fileIdentity),
    },
  };
  const session = await parseClaudeSession(candidate, context);
  return observeMaterializationPhase('adapter_source_finalization', () => {
    applyClaudeCommittedProjection(session, descriptor.payload.projection);
    applyClaudeMaterializedForkOwnership(session, indexedSourceStaleError);
    const summary = claudeSearch.projectSessionMetadata(session).summary;
    const carried = projectClaudeCarriedSession(session, summary);
    if (Object.keys(carried).some((field) => !isDeepStrictEqual(carried[field], indexedSession[field]))) {
      throw indexedSourceStaleError();
    }
    return {
      ...carried,
      materializationSnapshotId: descriptor.sourceSnapshotId,
      rawEvents: session.rawEvents,
      logicalEvents: session.logicalEvents,
      analysis: session.analysis,
      presentationIndexes: session.presentationIndexes,
    };
  });
}

function validateClaudeMaterializationDescriptor({
  materializationContext,
  indexedSession,
  descriptor,
  dependencySet,
}) {
  const index = materializationContext;
  requireExactClaudeKeys(
    descriptor.payload,
    ['sourceFile', 'description', 'projection'],
    'Claude materialization payload',
  );
  if (typeof descriptor.payload.sourceFile !== 'string'
      || !descriptor.payload.sourceFile
      || !isCanonicalClaudeDependencyPath(index.sourceRoot, descriptor.payload.sourceFile)
      || descriptor.payload.sourceFile !== indexedSession.sourceFile
      || typeof descriptor.payload.description !== 'string') {
    throw new Error('Claude materialization source payload is invalid');
  }
  requireExactClaudeKeys(
    descriptor.payload.projection,
    [...CLAUDE_COMMITTED_PROJECTION_FIELDS, 'cwdSet'],
    'Claude materialization projection',
  );
  if (!isDeepStrictEqual(descriptor.payload.projection, claudeCommittedProjection(indexedSession))) {
    throw new Error('Claude materialization relationship projection is invalid');
  }
  if (!Array.isArray(dependencySet.entries) || dependencySet.entries.length !== 1) {
    throw new Error('Claude materialization requires exactly the selected transcript dependency');
  }
  const sourceEntry = dependencySet.entries[0];
  if (sourceEntry.role !== 'session_transcript'
      || sourceEntry.pathIdentity !== indexedSession.sourceFile
      || sourceEntry.existence !== 'present'
      || sourceEntry.kind !== 'file'
      || sourceEntry.policy !== 'accepted_prefix'
      || sourceEntry.acceptedBytes !== indexedSession.bytes
      || sourceEntry.lineCount !== indexedSession.lineCount
      || !/^[a-f0-9]{64}$/u.test(sourceEntry.digest)
      || sourceEntry.directoryEntries.length !== 0
      || !isCanonicalClaudeDependencyPath(index.sourceRoot, sourceEntry.pathIdentity)) {
    throw new Error('Claude transcript dependency is invalid');
  }
  requireExactClaudeKeys(sourceEntry.evidence, ['fileIdentity'], 'Claude dependency evidence');
  requireExactClaudeKeys(sourceEntry.evidence.fileIdentity, ['device', 'inode'], 'Claude file identity');
  if (typeof sourceEntry.evidence.fileIdentity.device !== 'string'
      || typeof sourceEntry.evidence.fileIdentity.inode !== 'string') {
    throw new Error('Claude dependency identity is invalid');
  }
  const expectedDependencySetId = `claude-dependency:${hashClaudeMaterializationValue(
    dependencySet.entries,
  )}`;
  if (dependencySet.id !== expectedDependencySetId
      || descriptor.dependencySetId !== expectedDependencySetId) {
    throw new Error('Claude dependency identity is invalid');
  }
  const expectedSnapshotId = `claude-snapshot:${hashClaudeMaterializationValue({
    dependencySet,
    payload: descriptor.payload,
  })}`;
  if (descriptor.sourceSnapshotId !== expectedSnapshotId) {
    throw new Error('Claude materialization snapshot identity is invalid');
  }
}

function validateClaudeLegacyRawOwnerIndex({ legacyRawOwners }) {
  validateCanonicalLegacyRawOwnerIndex(legacyRawOwners, CLAUDE_SOURCE_KIND);
  if (legacyRawOwners.entryCount !== 0
      || legacyRawOwners.accountedBytes !== 2
      || !isDeepStrictEqual(legacyRawOwners.payload, {})) {
    throw new Error('Claude legacy Raw owner index must be empty');
  }
}

function validateClaudeMaterializedPrivateState() {
  // Claude materialization currently declares no adapter-private fields.
}

const materializedPrivateFields = Object.freeze([]);

async function readLine(target, lineNumber) {
  const stream = fs.createReadStream(target, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let current = 0;
  try {
    for await (const line of lines) {
      current += 1;
      if (current !== lineNumber) continue;
      let parsed = null;
      let parseError = '';
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'Invalid JSON';
        // Preserve the exact source text even if a concurrently written line is incomplete.
      }
      return { line, parsed, parseError };
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return null;
}

async function readClaudeRawRecord(index, session, raw) {
  if (!session || !raw || raw.sessionId !== session.id) return null;
  const sourceRoot = path.resolve(index.sourceRoot || session.sourceRoot || index.projectsRoot || index.claudeHome);
  const target = path.resolve(sourceRoot, session.sourceFile);
  const rootApi = fsPathApi(sourceRoot);
  const targetApi = fsPathApi(target);
  const rootAnchor = rootApi.parse(sourceRoot).root.toLowerCase();
  const targetAnchor = targetApi.parse(target).root.toLowerCase();
  // A realpath may use a different drive spelling for the same Windows
  // directory (as happens with some temporary-directory mappings).  Keep the
  // lexical guard when both paths share an anchor, then always enforce the
  // canonical physical containment check below.
  if (rootAnchor === targetAnchor && !isPathInsideOrSame(target, sourceRoot)) return null;
  let realRoot;
  let realTarget;
  try {
    [realRoot, realTarget] = await Promise.all([fsp.realpath(sourceRoot), fsp.realpath(target)]);
  } catch {
    return null;
  }
  if (!isPathInsideOrSame(realTarget, realRoot)) return null;
  const value = await readLine(realTarget, raw.sourceLocator?.line || raw.line);
  if (!value) return null;
  const reconstructed = makeClaudeRawEvent(
    value.parsed,
    raw.sourceLocator?.line || raw.line,
    session.sourceFile,
    session.id,
    session.sourceSessionId,
    { parseError: value.parseError, rawText: value.line },
  );
  reconstructed.turnId = raw.turnId;
  if (!isDeepStrictEqual(reconstructed, raw)) throw indexedSourceStaleError();
  return {
    rawId: raw.rawId,
    sourceKind: CLAUDE_SOURCE_KIND,
    file: raw.source?.file || session.sourceFile,
    line: raw.sourceLocator?.line || raw.line,
    sourceLocator: raw.sourceLocator,
    raw: value.line,
    parsed: value.parsed,
  };
}

module.exports = {
  CLAUDE_SOURCE_KIND,
  __testOnlyCompactClaudeRelationshipSession: compactClaudeRelationshipSession,
  analyzerForkedSkillSessionId,
  analyzerSessionId,
  analyzerSubagentSessionId,
  analyzerWorkflowAgentSessionId,
  buildClaudeIndex,
  buildClaudeSourceBackedIndex,
  claudeLayout,
  discoverClaudeConfiguredProjects,
  discoverClaudeProjects,
  discoverMainCandidates,
  inspectClaudeSessionFile,
  materializeClaudeSession,
  materializedPrivateFields,
  query: claudeSearch,
  readClaudeRawRecord,
  resolveClaudeAnalyzerIdentities,
  validateClaudeLegacyRawOwnerIndex,
  validateClaudeMaterializationDescriptor,
  validateClaudeMaterializedPrivateState,
};
