'use strict';

const path = require('node:path');

// Pinned authority: rust-v0.162.1 rollout/src/recorder.rs, ordinal.rs,
// and protocol/src/protocol.rs HistoryPosition. RolloutId is physical identity;
// session_meta.id is logical thread identity. This planner reads no transcripts.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');
const NAME_RE = new RegExp(`^rollout-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2})-(${UUID})(?:_(${UUID}))?\\.jsonl(?:\\.zst)?$`, 'i');
const MAX_ARTIFACTS_PER_HISTORY = 4096;

function parseRolloutArtifactIdentity(file) {
  if (typeof file !== 'string') return null;
  const basename = file.split(/[\\/]/u).at(-1);
  const match = basename.match(NAME_RE);
  if (!match) return null;
  const timestamp = match[1].replace(/t/iu, 'T').replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z';
  if (!Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString().slice(0, 19) + 'Z' !== timestamp) return null;
  return { threadId: match[2].toLowerCase(), rolloutId: (match[3] || match[2]).toLowerCase(), timestamp };
}

function parseHistoryBase(value) {
  if (value == null) return { base: null, error: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.thread_id !== 'string' || !UUID_RE.test(value.thread_id)
      || !Number.isSafeInteger(value.end_ordinal_exclusive) || value.end_ordinal_exclusive < 0
      || !Number.isSafeInteger(value.end_byte_offset) || value.end_byte_offset < 0) {
    return { base: null, error: 'CODEX_HISTORY_BASE_INVALID' };
  }
  return { base: { rolloutId: value.thread_id.toLowerCase(), endOrdinalExclusive: value.end_ordinal_exclusive,
    endByteOffset: value.end_byte_offset }, error: null };
}

function safeSourceFile(file) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || /^[A-Za-z]:/u.test(file)) return false;
  const parts = file.split(/[\\/]/u);
  if (parts[0] === '..' && parts[1] === 'archived_sessions')
    return parts.slice(2).length > 0 && parts.slice(2).every((part) => part && part !== '.' && part !== '..');
  return !parts.includes('..');
}

function validateHistorySegmentBoundary(segment, physicalRecordCount, consumedBytes) {
  if (!Number.isSafeInteger(physicalRecordCount) || physicalRecordCount < 0
      || !Number.isSafeInteger(consumedBytes) || consumedBytes < 0
      || !Number.isSafeInteger(segment.startOrdinal) || segment.startOrdinal < 0
      || !Number.isSafeInteger(segment.startOrdinal + physicalRecordCount)
      || (segment.acceptedBytes != null && segment.acceptedBytes !== consumedBytes)
      || (segment.endOrdinalExclusive != null
        && segment.endOrdinalExclusive !== segment.startOrdinal + physicalRecordCount)) {
    const error = new Error('Codex history segment byte/ordinal boundary does not match recorded rows');
    error.code = 'CODEX_HISTORY_BOUNDARY_INVALID';
    throw error;
  }
  return segment.startOrdinal + physicalRecordCount;
}

// Inputs are bounded discovery facts, not canonical Session DTOs. Output plans
// still require byte-boundary/row-count validation by the actual stream reader.
// Head selection admits only a unique same-logical-thread graph leaf. Cross-
// thread base edges preserve physical dependencies but do not supersede parents.
function resolveRolloutHistoryPlans(artifacts, options = {}) {
  const byRolloutId = new Map();
  const bySessionId = new Map();
  const diagnostics = [];
  const invalidSessions = new Set();
  const diagnose = (code, sessionId, sourceFile) => {
    invalidSessions.add(sessionId);
    diagnostics.push({ code, sessionId, sourceFile });
  };
  for (const artifact of artifacts) {
    const identity = parseRolloutArtifactIdentity(artifact.sourceFile);
    const sessionId = artifact.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || !safeSourceFile(artifact.sourceFile)) {
      diagnose('CODEX_HISTORY_ARTIFACT_INVALID', sessionId || '', artifact.sourceFile || '');
      continue;
    }
    const { base, error } = parseHistoryBase(artifact.historyBase);
    const node = { ...artifact, identity, base, error };
    if (!bySessionId.has(sessionId)) bySessionId.set(sessionId, []);
    bySessionId.get(sessionId).push(node);
    if (error) diagnose(error, sessionId, artifact.sourceFile);
    // Legacy ad hoc filenames stay eligible for ordinary single-file parsing.
    // They cannot supply authoritative physical IDs for history-base resolution.
    if (!identity) {
      if (base) diagnose('CODEX_HISTORY_ARTIFACT_IDENTITY_UNKNOWN', sessionId, artifact.sourceFile);
      continue;
    }
    if (identity.threadId !== sessionId.toLowerCase()) {
      node.error = 'CODEX_HISTORY_OWNER_CONFLICT';
      diagnose(node.error, sessionId, artifact.sourceFile);
    }
    const peers = byRolloutId.get(identity.rolloutId) || [];
    peers.push(node);
    byRolloutId.set(identity.rolloutId, peers);
  }
  const plans = [];
  for (const peers of byRolloutId.values()) if (peers.length > 1) {
    for (const node of peers) {
      node.error = 'CODEX_HISTORY_ARTIFACT_ID_AMBIGUOUS';
      diagnose(node.error, node.sessionId, node.sourceFile);
    }
  }
  for (const [sessionId, nodes] of bySessionId) {
    if (nodes.length > MAX_ARTIFACTS_PER_HISTORY) {
      diagnose('CODEX_HISTORY_CHAIN_CAPACITY_EXCEEDED', sessionId, nodes[0].sourceFile);
      continue;
    }
    const referenced = new Set(nodes.filter((node) => node.base).map((node) => node.base.rolloutId));
    const currentPath = options.currentPaths?.get(sessionId);
    const relativeHint = currentPath && path.isAbsolute(currentPath) && options.sessionsRoot
      ? path.relative(options.sessionsRoot, currentPath) : currentPath;
    const comparable = (value) => String(value || '').replace(/\\/gu, '/').toLowerCase().replace(/\.jsonl\.zst$/u, '.jsonl');
    const heads = currentPath
      ? nodes.filter((node) => comparable(node.sourceFile) === comparable(relativeHint))
      : nodes.filter((node) => !node.identity || !referenced.has(node.identity.rolloutId));
    if (heads.length !== 1) {
      diagnose(currentPath ? 'CODEX_HISTORY_CURRENT_PATH_UNRESOLVED' : heads.length ? 'CODEX_HISTORY_HEAD_AMBIGUOUS' : 'CODEX_HISTORY_CYCLE', sessionId, nodes[0].sourceFile);
      continue;
    }
    const head = heads[0];
    // A committed pointer can choose a valid artifact while a failed/pre-CAS
    // replacement remains on disk. Selected-chain errors are checked below.
    if (currentPath) invalidSessions.delete(sessionId);
    const chain = [];
    const seen = new Set();
    let current = head;
    let limit = null;
    while (current) {
      if (current.error) {
        diagnose(current.error, sessionId, current.sourceFile);
        break;
      }
      if (chain.length >= MAX_ARTIFACTS_PER_HISTORY || seen.has(current)) {
        diagnose(seen.has(current) ? 'CODEX_HISTORY_CYCLE' : 'CODEX_HISTORY_CHAIN_CAPACITY_EXCEEDED', sessionId, current.sourceFile);
        break;
      }
      seen.add(current);
      const startOrdinal = current.base?.endOrdinalExclusive || 0;
      if (limit && (limit.endOrdinalExclusive < startOrdinal
          || (Number.isSafeInteger(current.bytes) && limit.endByteOffset > current.bytes))) {
        diagnose('CODEX_HISTORY_BOUNDARY_INVALID', sessionId, current.sourceFile);
        break;
      }
      chain.push({ sourceFile: current.sourceFile, sessionId: current.sessionId,
        rolloutId: current.identity?.rolloutId || '', startOrdinal,
        contentStartOrdinal: startOrdinal + 1,
        endOrdinalExclusive: limit?.endOrdinalExclusive ?? null,
        acceptedBytes: limit?.endByteOffset ?? current.bytes ?? null });
      if (!current.base) break;
      const peers = byRolloutId.get(current.base.rolloutId) || [];
      if (peers.length !== 1) {
        diagnose(peers.length ? 'CODEX_HISTORY_BASE_AMBIGUOUS' : 'CODEX_HISTORY_BASE_MISSING', sessionId, current.sourceFile);
        break;
      }
      limit = current.base;
      current = peers[0];
    }
    // A disconnected artifact cannot be silently called superseded history.
    if (!currentPath && nodes.some((node) => !seen.has(node))) diagnose('CODEX_HISTORY_DISCONNECTED', sessionId, head.sourceFile);
    if (!invalidSessions.has(sessionId)) plans.push({ sessionId, headSourceFile: head.sourceFile,
      headRolloutId: head.identity?.rolloutId || '', headSelection: currentPath ? 'state-pointer' : 'filesystem-inferred',
      unselectedSourceFiles: nodes.filter((node) => !seen.has(node)).map((node) => node.sourceFile), segments: chain.reverse() });
  }
  return { plans, diagnostics };
}

module.exports = { MAX_ARTIFACTS_PER_HISTORY, parseRolloutArtifactIdentity, parseHistoryBase, resolveRolloutHistoryPlans, validateHistorySegmentBoundary };
