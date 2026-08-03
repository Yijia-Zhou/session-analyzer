'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
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
const { inferClaudeForkRelationships } = require('./claude-forks');
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
    agentId: String(derived.context.agentId || ''),
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
    primarySessionMetaKind: context.parentSessionId ? 'subagent' : '',
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

  const stream = fs.createReadStream(candidate.filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      throwIfAborted(signal);
      transcriptFingerprint.update(line, 'utf8');
      transcriptFingerprint.update('\n');
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
    bytes: stat.size,
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
    sourceDerivedId: context.agentId || '',
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
    primarySessionMetaKind: context.parentSessionId ? 'subagent' : '',
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
  if (['command', 'patch', 'mcp_call', 'web_search', 'agent_coordination', 'other_tool_call'].includes(event.kind)) {
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
  const session = makeSession(candidate, context);
  const stream = fs.createReadStream(candidate.filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      throwIfAborted(context.signal);
      lineNumber += 1;
      if (!line.trim()) continue;
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
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  session.logicalEvents = logicalBuilder.buildLogicalEvents(session.rawEvents);
  return finalizeSession(session);
}

async function readSubagentMetadataWithEvidence(metaPath) {
  if (!metaPath) return { metadata: {}, evidence: { exists: false } };
  try {
    const [stat, text] = await Promise.all([
      fsp.stat(metaPath),
      fsp.readFile(metaPath, 'utf8'),
    ]);
    let metadata = {};
    try {
      const parsed = JSON.parse(text);
      metadata = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // Match readSubagentMetadata: malformed sidecars are deliberately treated
      // as empty metadata, but their bytes still invalidate a prior reuse.
    }
    return {
      metadata,
      evidence: {
        exists: true,
        bytes: stat.size,
        sourceUpdatedAt: safeIso(stat.mtime),
        fingerprint: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
      },
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { metadata: {}, evidence: { exists: false } };
    throw error;
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
  const candidates = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(signal);
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const filePath = await containedRealPath(
      parentCandidate.sourceRoot,
      path.join(subagentsRoot, entry.name),
    );
    if (!filePath) continue;
    const base = path.basename(entry.name, '.jsonl');
    if (!base.startsWith('agent-') || base.length === 'agent-'.length) continue;
    const agentId = base.slice('agent-'.length);
    const metaPath = await containedRealPath(
      parentCandidate.sourceRoot,
      path.join(subagentsRoot, `${base}.meta.json`),
    );
    const metadataValue = await readSubagentMetadataWithEvidence(metaPath);
    const metadata = metadataValue.metadata;
    const inspected = await inspectClaudeSessionFile({
      filePath,
      containerKey: parentCandidate.containerKey,
      containerPath: parentCandidate.containerPath,
      sourceRoot: parentCandidate.sourceRoot,
      relFile: path.relative(parentCandidate.sourceRoot, filePath).replace(/\\/g, '/'),
    }, { signal });
    if (inspected.agentIds.size !== 1 || !inspected.agentIds.has(agentId)) continue;
    const metadataToolUseId = String(metadata.toolUseId || '');
    const evidence = parentAgentEvidence(parentSession, agentId, metadataToolUseId);
    if (!evidence) continue;
    inspected.sourceSessionId = parentSession.sourceSessionId;
    candidates.push({
      candidate: inspected,
      metadataEvidence: metadataValue.evidence,
      context: {
        id: analyzerSubagentSessionId(parentSession.sourceSessionId, agentId),
        agentId,
        parentSessionId: parentSession.id,
        agentNickname: String(metadata.agentType || ''),
        description: String(metadata.description || ''),
        toolUseId: evidence.callId,
        spawnDepth: metadata.spawnDepth,
        inheritedCwds: parentSession.cwdSet,
        matchesRepo: true,
        projectAssociation: 'parent-inherited',
      },
    });
  }
  return candidates;
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
      candidateBytes: selectedCandidates.reduce((sum, item) => sum + item.bytes, 0),
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

async function readLine(target, lineNumber) {
  const stream = fs.createReadStream(target, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let current = 0;
  try {
    for await (const line of lines) {
      current += 1;
      if (current !== lineNumber) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Preserve the exact source text even if a concurrently written line is incomplete.
      }
      return { line, parsed };
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
  const target = path.resolve(session.sourceAbsFile);
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
  analyzerSessionId,
  analyzerSubagentSessionId,
  buildClaudeIndex,
  claudeLayout,
  discoverClaudeConfiguredProjects,
  discoverClaudeProjects,
  discoverMainCandidates,
  inspectClaudeSessionFile,
  readClaudeRawRecord,
  resolveClaudeAnalyzerIdentities,
};
