'use strict';

const crypto = require('node:crypto');

const INHERITED_PREVIEW_LIMIT = 12;
const MATERIALIZED_FORK_STORAGE_MODE = 'materialized';
const SUPERSEDED_REASON_INACTIVE_AFTER_FORK = 'inactive_after_fork';

function canonicalRecordValue(value, topLevel = false) {
  if (Array.isArray(value)) return value.map((item) => canonicalRecordValue(item, false));
  if (!value || typeof value !== 'object') return value;
  const normalized = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (topLevel && key === 'timestamp') continue;
    if (value[key] === null) continue;
    normalized[key] = canonicalRecordValue(value[key], false);
  }
  return normalized;
}

function canonicalRawRecord(record) {
  return JSON.stringify(canonicalRecordValue(record, true));
}

function canonicalRawRecordDigest(record) {
  return crypto.createHash('sha256').update(canonicalRawRecord(record)).digest('hex');
}

function canonicalDigestForRaw(raw) {
  if (typeof raw?._canonicalRawDigest === 'string' && raw._canonicalRawDigest) {
    return raw._canonicalRawDigest;
  }
  return '';
}

function hasCanonicalRawDigests(session) {
  const raws = session?.rawEvents || [];
  if (Array.isArray(session?._canonicalRawDigests)
      && session._canonicalRawDigests.length === raws.length
      && session._canonicalRawDigests.every((digest) => typeof digest === 'string' && digest)) {
    return true;
  }
  return raws.length > 0 && raws.every((raw) => Boolean(canonicalDigestForRaw(raw)));
}

function ensureCanonicalRawDigests(session) {
  const raws = session.rawEvents || [];
  if (hasCanonicalRawDigests(session) && Array.isArray(session._canonicalRawDigests)) {
    return session._canonicalRawDigests;
  }
  if (!hasCanonicalRawDigests(session)) return null;
  session._canonicalRawDigests = raws.map(canonicalDigestForRaw);
  return session._canonicalRawDigests;
}

function isSessionMeta(raw, sessionId = '') {
  if (raw?.recordType !== 'session_meta') return false;
  return !sessionId || raw.parsed?.payload?.id === sessionId;
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function declaredForkSourceId(session) {
  const first = session.rawEvents?.[0];
  if (!isSessionMeta(first, session.id)) return '';
  const sourceId = first.parsed?.payload?.forked_from_id;
  return typeof sourceId === 'string' ? sourceId.trim() : '';
}

function parsedForkSourceId(session) {
  const parsed = session?._parsedAncestry?.forkedFromSessionId;
  if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
  const declared = declaredForkSourceId(session);
  if (declared) return declared;
  const previous = session?._declaredForkedFromSessionId;
  return typeof previous === 'string' ? previous.trim() : '';
}

function resetForkInference(session) {
  session._logicalEvents ||= session.logicalEvents || [];
  session.logicalEvents = session._logicalEvents;
  session._declaredForkedFromSessionId = parsedForkSourceId(session);
  session.forkedFromSessionId = session._declaredForkedFromSessionId;
  session.forkStorageMode = '';
  session.forkedAt = '';
  session.forkPointUuid = '';
  session.forkContinuationState = '';
  session.forkEvidence = null;
  session.inheritedContext = null;
  session._forkSegmentsByRawId = new Map();
  session.supersededBySessionId = '';
  session.supersededAt = '';
  session.supersededReason = '';
}

function logicalEventSegment(event, rawSegments) {
  const refs = event.rawRefs || [];
  if (!refs.length) return '';
  const segments = new Set();
  for (const ref of refs) {
    const segment = rawSegments.get(ref.rawId);
    if (!segment) return '';
    segments.add(segment);
  }
  return segments.size === 1 ? [...segments][0] : '';
}

function rawRecordShape(raw) {
  const parsed = raw?.parsed;
  return [
    String(raw?.recordType || parsed?.type || ''),
    String(parsed?.payload?.type || ''),
    String(parsed?.payload?.role || ''),
  ].join('\u0000');
}

function prefixCanEndAt(parent, child, matchedParentRawCount, forkedAt) {
  const parentTail = (parent.rawEvents || []).slice(matchedParentRawCount);
  if (!isValidTimestamp(forkedAt)
      || parentTail.some((raw) => !isValidTimestamp(raw.timestamp))) return false;
  if (parentTail.every((raw) => raw.timestamp > forkedAt)) return true;

  const parentBoundary = parentTail[0];
  const childBoundary = child.rawEvents?.[matchedParentRawCount + 1];
  if (!parentBoundary || !childBoundary) return false;
  return rawRecordShape(parentBoundary) !== rawRecordShape(childBoundary);
}

function materializedForkCandidate(child, sessionsById) {
  const sourceId = declaredForkSourceId(child);
  if (!sourceId) return null;
  const matches = sessionsById.get(sourceId) || [];
  if (matches.length !== 1) return null;
  const [parent] = matches;
  if (parent === child || !isSessionMeta(parent.rawEvents?.[0], parent.id)) return null;
  if (!isSessionMeta(child.rawEvents?.[1], parent.id)) return null;

  const childDigests = ensureCanonicalRawDigests(child);
  const parentDigests = ensureCanonicalRawDigests(parent);
  if (!childDigests || !parentDigests) return null;
  let matchedParentRawCount = 0;
  const comparableCount = Math.min(parentDigests.length, Math.max(0, childDigests.length - 1));
  while (matchedParentRawCount < comparableCount
      && childDigests[matchedParentRawCount + 1] === parentDigests[matchedParentRawCount]) {
    matchedParentRawCount += 1;
  }
  if (!matchedParentRawCount) return null;

  const forkedAt = String(child.rawEvents[0]?.timestamp || '');
  if (matchedParentRawCount < parentDigests.length
      && !prefixCanEndAt(parent, child, matchedParentRawCount, forkedAt)) return null;

  const rawSegments = new Map();
  for (let index = 0; index < child.rawEvents.length; index += 1) {
    const raw = child.rawEvents[index];
    const segment = index === 0
      ? 'fork_metadata'
      : (index <= matchedParentRawCount ? 'inherited_context' : 'continuation');
    rawSegments.set(raw.rawId, segment);
  }
  const logicalSegments = new Map();
  for (const event of child._logicalEvents || child.logicalEvents || []) {
    const segment = logicalEventSegment(event, rawSegments);
    if (!segment) return null;
    logicalSegments.set(event.id, segment);
  }
  return {
    child,
    parent,
    forkedAt,
    matchedParentRawCount,
    rawSegments,
    logicalSegments,
  };
}

function logicalEventsWithinRawIds(events, rawIds) {
  return (events || []).filter((event) => {
    const refs = event.rawRefs || [];
    return refs.length > 0 && refs.every((ref) => rawIds.has(ref.rawId));
  });
}

function inheritedEventPreview(event) {
  return {
    sourceEventId: String(event.id || ''),
    layer: event.layer === 'protocol' ? 'protocol' : 'main',
    kind: String(event.kind || ''),
    subtype: String(event.subtype || ''),
    status: String(event.status || ''),
    timestamp: String(event.timestamp || ''),
    preview: String(event.preview || ''),
  };
}

function forkPointTarget(parent, parentRawEvents, inheritedRawIds) {
  const mainEvents = (parent.logicalEvents || []).filter((event) => (
    event.layer !== 'protocol'
    && String(event.preview || event.searchText || '').trim()
    && (event.rawRefs || []).length > 0
    && event.rawRefs.every((ref) => inheritedRawIds.has(ref.rawId))
  ));
  if (mainEvents.length) {
    const event = mainEvents.at(-1);
    const timelineIndex = (parent.logicalEvents || []).filter((candidate) => candidate.layer !== 'protocol').findIndex((candidate) => candidate.id === event.id);
    return { layer: 'main', eventId: String(event.id || ''), timelineIndex };
  }
  const raw = parentRawEvents.at(-1);
  return raw ? {
    layer: 'raw',
    eventId: String(raw.rawId || ''),
    timelineIndex: Math.max(0, parentRawEvents.length - 1),
  } : null;
}

function attachMaterializedFork(candidate) {
  const {
    child,
    parent,
    forkedAt,
    matchedParentRawCount,
    rawSegments,
    logicalSegments,
  } = candidate;
  child.forkedFromSessionId = parent.id;
  child.forkStorageMode = MATERIALIZED_FORK_STORAGE_MODE;
  child.forkedAt = forkedAt;
  child._forkSegmentsByRawId = rawSegments;
  child.logicalEvents = (child._logicalEvents || []).filter((event) => logicalSegments.get(event.id) !== 'inherited_context');
  child.forkEvidence = {
    sourceSessionId: parent.id,
    childMetadataRawId: String(child.rawEvents[0]?.rawId || ''),
    embeddedParentMetadataRawId: String(child.rawEvents[1]?.rawId || ''),
    parentMetadataRawId: String(parent.rawEvents[0]?.rawId || ''),
    matchedParentRawCount,
  };
}

function attachInheritedContext(candidate) {
  const { child, parent, matchedParentRawCount } = candidate;
  const inheritedParentRawEvents = (parent.rawEvents || []).slice(0, matchedParentRawCount);
  const inheritedRawIds = new Set(inheritedParentRawEvents.map((raw) => raw.rawId));
  const inheritedEvents = logicalEventsWithinRawIds(parent._logicalEvents || parent.logicalEvents, inheritedRawIds);
  const mainEvents = inheritedEvents.filter((event) => event.layer !== 'protocol');
  const protocolEvents = inheritedEvents.filter((event) => event.layer === 'protocol');
  const previewEvents = mainEvents.slice(-INHERITED_PREVIEW_LIMIT).map(inheritedEventPreview);
  const forkPointRaw = inheritedParentRawEvents.at(-1) || null;
  child.inheritedContext = {
    sourceSessionId: parent.id,
    rawRecordCount: inheritedParentRawEvents.length,
    mainEventCount: mainEvents.length,
    protocolEventCount: protocolEvents.length,
    previewEventCount: previewEvents.length,
    omittedPreviewEventCount: Math.max(0, mainEvents.length - previewEvents.length),
    startedAt: String(inheritedParentRawEvents[0]?.timestamp || ''),
    updatedAt: String(forkPointRaw?.timestamp || ''),
    forkPointRawId: String(forkPointRaw?.rawId || ''),
    forkPointTarget: forkPointTarget(parent, inheritedParentRawEvents, inheritedRawIds),
    previewEvents,
  };
}

function inferCodexMaterializedForks(sessions) {
  const sessionsById = new Map();
  for (const session of sessions || []) {
    resetForkInference(session);
    const matches = sessionsById.get(session.id) || [];
    matches.push(session);
    sessionsById.set(session.id, matches);
  }

  const candidates = [];
  for (const child of sessions || []) {
    const candidate = materializedForkCandidate(child, sessionsById);
    if (candidate) candidates.push(candidate);
  }
  for (const candidate of candidates) attachMaterializedFork(candidate);
  for (const candidate of candidates) attachInheritedContext(candidate);
  return candidates.length;
}

function isDerivedSession(session) {
  return Boolean(session.primarySessionMetaKind || session.parentSessionId);
}

function forkRelationIsCycleSafe(child, byId) {
  const visited = new Set([child.id]);
  let current = child;
  while (current?.forkedFromSessionId) {
    const parentId = current.forkedFromSessionId;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    current = byId.get(parentId);
    if (!current) break;
  }
  return true;
}

function parentInactiveAfterFork(parent, forkedAt) {
  if (!isValidTimestamp(forkedAt) || !(parent.rawEvents || []).length) return false;
  for (const raw of parent.rawEvents || []) {
    if (!isValidTimestamp(raw.timestamp)) return false;
    if (raw.timestamp > forkedAt) return false;
  }
  return true;
}

function inferEarlierBranches(sessions) {
  const byId = new Map((sessions || []).map((session) => [session.id, session]));
  const ordinaryForkChildren = new Map();
  for (const session of sessions || []) {
    session.supersededBySessionId = '';
    session.supersededAt = '';
    session.supersededReason = '';
    if (!session.forkedFromSessionId || isDerivedSession(session)) continue;
    const children = ordinaryForkChildren.get(session.forkedFromSessionId) || [];
    children.push(session);
    ordinaryForkChildren.set(session.forkedFromSessionId, children);
  }

  for (const child of sessions || []) {
    if (child.forkStorageMode !== MATERIALIZED_FORK_STORAGE_MODE || isDerivedSession(child)) continue;
    const parent = byId.get(child.forkedFromSessionId);
    if (!parent) continue;
    const siblings = ordinaryForkChildren.get(parent.id) || [];
    if (siblings.length !== 1 || siblings[0] !== child) continue;
    if (!forkRelationIsCycleSafe(child, byId)) continue;
    if (!parentInactiveAfterFork(parent, child.forkedAt)) continue;
    if (!(child.logicalEvents || []).some((event) => event.layer !== 'protocol')) continue;
    parent.supersededBySessionId = child.id;
    parent.supersededAt = child.forkedAt;
    parent.supersededReason = SUPERSEDED_REASON_INACTIVE_AFTER_FORK;
  }
}

function rawForkSegment(session, rawId) {
  return session?._forkSegmentsByRawId?.get(rawId) || '';
}

module.exports = {
  INHERITED_PREVIEW_LIMIT,
  MATERIALIZED_FORK_STORAGE_MODE,
  SUPERSEDED_REASON_INACTIVE_AFTER_FORK,
  canonicalRawRecord,
  canonicalRawRecordDigest,
  ensureCanonicalRawDigests,
  hasCanonicalRawDigests,
  inferCodexMaterializedForks,
  inferEarlierBranches,
  rawForkSegment,
};
