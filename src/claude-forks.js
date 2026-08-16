'use strict';

const path = require('node:path');
const { normalizeFsPath } = require('./shared/fs-path');

const INHERITED_PREVIEW_LIMIT = 12;
const INHERITED_PREVIEW_TEXT_LIMIT = 240;
const POINTER_FORK_COMMAND = '/fork';
const POINTER_FORK_WAITING_STATE = 'waiting_for_prompt';

function sourceContainerPath(session) {
  return normalizeFsPath(path.dirname(String(session?.sourceAbsFile || '')));
}

function relationshipRawFacts(session) {
  return session?._relationshipRawFacts || session?.rawEvents || [];
}

function relationshipLogicalFacts(session) {
  return session?._relationshipLogicalFacts || session?.logicalEvents || [];
}

function rawSourceSessionReference(raw) {
  return String(raw?.sourceSessionReference || raw?.parsed?.session_id || '');
}

function localCommandContent(raw) {
  if (raw?.recordType !== 'system' || raw?.payloadType !== 'local_command') return '';
  return String(raw.parsed?.content || '');
}

function isPointerForkCommand(raw) {
  const content = localCommandContent(raw);
  if (!content) return false;
  const match = content.match(/^\s*<command-name>\s*(\/[^<\s]+)\s*<\/command-name>(?:\s|$)/u);
  return match?.[1] === POINTER_FORK_COMMAND;
}

function pointerForkOutput(raw) {
  const content = localCommandContent(raw);
  if (!content) return null;
  const match = content.match(
    /^\s*<local-command-stdout>\s*session waiting for a prompt\s*·\s*(.*?)\s*·\s*([0-9a-f]{8,32})\s*<\/local-command-stdout>\s*$/isu,
  );
  if (!match) return null;
  return {
    title: String(match[1] || '').trim(),
    sourceSessionIdPrefix: String(match[2] || '').toLowerCase(),
  };
}

function rawAncestryAt(parent, forkPointUuid) {
  if (!forkPointUuid) return [];
  const byUuid = new Map();
  const ambiguousUuids = new Set();
  for (const raw of relationshipRawFacts(parent)) {
    if (!raw.uuid) continue;
    if (byUuid.has(raw.uuid)) ambiguousUuids.add(raw.uuid);
    else byUuid.set(raw.uuid, raw);
  }
  const reverse = [];
  const visited = new Set();
  let currentUuid = String(forkPointUuid);
  while (currentUuid) {
    if (visited.has(currentUuid) || ambiguousUuids.has(currentUuid)) return [];
    visited.add(currentUuid);
    const raw = byUuid.get(currentUuid);
    if (!raw) return [];
    reverse.push(raw);
    currentUuid = String(raw.parentUuid || '');
  }
  return reverse.reverse();
}

function inheritedLogicalEvents(parent, rawIds) {
  return relationshipLogicalFacts(parent).filter((event) => {
    const refs = event.rawRefs || [];
    return refs.length > 0 && refs.every((ref) => rawIds.has(ref.rawId));
  });
}

function inheritedEventPreview(event) {
  const sourcePreview = String(event.preview || '');
  return {
    parentEventId: String(event.id || ''),
    layer: event.layer === 'protocol' ? 'protocol' : 'main',
    kind: String(event.kind || ''),
    subtype: String(event.subtype || ''),
    status: String(event.status || ''),
    timestamp: String(event.timestamp || ''),
    preview: sourcePreview.length <= INHERITED_PREVIEW_TEXT_LIMIT
      ? sourcePreview
      : `${sourcePreview.slice(0, INHERITED_PREVIEW_TEXT_LIMIT - 1).trimEnd()}…`,
  };
}

function pointerForkPointTarget(parent, inheritedRawEvents, mainEvents) {
  const mainTimeline = relationshipLogicalFacts(parent).filter((event) => event.layer !== 'protocol');
  const readableEvent = [...(mainEvents || [])].reverse().find((event) => (
    String(event.preview || event.searchText || '').trim()
    && (event.rawRefs || []).length > 0
  ));
  if (readableEvent) {
    const timelineIndex = mainTimeline.findIndex((event) => event.id === readableEvent.id);
    if (timelineIndex >= 0) {
      return {
        layer: 'main',
        eventId: String(readableEvent.id || ''),
        timelineIndex,
      };
    }
  }

  const raw = (inheritedRawEvents || []).at(-1);
  if (!raw) return null;
  const timelineIndex = relationshipRawFacts(parent).findIndex((candidate) => candidate.rawId === raw.rawId);
  if (timelineIndex < 0) return null;
  return {
    layer: 'raw',
    eventId: String(raw.rawId || ''),
    timelineIndex,
  };
}

function compactPointerForkFacts(session) {
  const raws = relationshipRawFacts(session);
  const rawUuidCounts = new Map();
  for (const raw of raws) {
    if (!raw.uuid) continue;
    rawUuidCounts.set(raw.uuid, (rawUuidCounts.get(raw.uuid) || 0) + 1);
  }
  const outputsByParentUuid = new Map();
  for (const raw of raws) {
    if (!raw.parentUuid) continue;
    const output = pointerForkOutput(raw);
    if (!output) continue;
    const matches = outputsByParentUuid.get(raw.parentUuid) || [];
    matches.push({ raw, output });
    outputsByParentUuid.set(raw.parentUuid, matches);
  }
  const facts = [];
  for (const command of raws) {
    if (!command.uuid || !command.parentUuid || !isPointerForkCommand(command)) continue;
    if (rawUuidCounts.get(command.uuid) !== 1) continue;
    const inheritedRawEvents = rawAncestryAt(session, command.parentUuid);
    if (!inheritedRawEvents.length) continue;
    const inheritedRawIds = new Set(inheritedRawEvents.map((raw) => raw.rawId));
    const inheritedEvents = inheritedLogicalEvents(session, inheritedRawIds);
    const mainEvents = inheritedEvents.filter((event) => event.layer !== 'protocol');
    const protocolEvents = inheritedEvents.filter((event) => event.layer === 'protocol');
    const previewEvents = mainEvents.slice(-INHERITED_PREVIEW_LIMIT).map(inheritedEventPreview);
    const forkPointRaw = inheritedRawEvents.at(-1) || null;
    for (const { raw: output, output: parsedOutput } of outputsByParentUuid.get(command.uuid) || []) {
      facts.push({
        sourceSessionIdPrefix: parsedOutput.sourceSessionIdPrefix,
        commandRawId: String(command.rawId || ''),
        outputRawId: String(output.rawId || ''),
        forkPointUuid: String(command.parentUuid || ''),
        forkedAt: String(command.timestamp || output.timestamp || ''),
        inheritedContext: {
          forkPointUuid: String(command.parentUuid || ''),
          forkPointRawId: String(forkPointRaw?.rawId || ''),
          rawRecordCount: inheritedRawEvents.length,
          mainEventCount: mainEvents.length,
          protocolEventCount: protocolEvents.length,
          previewEventCount: previewEvents.length,
          omittedPreviewEventCount: Math.max(0, mainEvents.length - previewEvents.length),
          startedAt: String(inheritedRawEvents[0]?.timestamp || ''),
          updatedAt: String(inheritedRawEvents.at(-1)?.timestamp || ''),
          forkPointTarget: pointerForkPointTarget(session, inheritedRawEvents, mainEvents),
          previewEvents,
        },
      });
    }
  }
  return facts;
}

function compactMaterializedForkFact(session) {
  const rawFacts = relationshipRawFacts(session);
  const sourceSessionId = rawSourceSessionReference(rawFacts[0]);
  if (!sourceSessionId) return null;
  let copiedRawRecordCount = 0;
  while (copiedRawRecordCount < rawFacts.length
      && rawSourceSessionReference(rawFacts[copiedRawRecordCount]) === sourceSessionId) {
    copiedRawRecordCount += 1;
  }
  const copiedIds = new Set(rawFacts
    .slice(0, copiedRawRecordCount)
    .map((raw) => raw.rawId));
  const logicalBoundaryValid = relationshipLogicalFacts(session).every((event) => {
    const refs = event.rawRefs || [];
    if (!refs.length) return true;
    const copiedRefCount = refs.filter((ref) => copiedIds.has(ref.rawId)).length;
    return copiedRefCount === 0 || copiedRefCount === refs.length;
  });
  const continuationTimestamps = rawFacts
    .slice(copiedRawRecordCount)
    .map((raw) => String(raw.timestamp || ''))
    .filter(Boolean)
    .sort();
  return {
    sourceSessionId,
    copiedRawRecordCount,
    logicalBoundaryValid,
    continuationStartedAt: continuationTimestamps[0] || '',
    continuationUpdatedAt: continuationTimestamps.at(-1) || '',
  };
}

function compactClaudeForkRelationshipFacts(session) {
  const timestamps = relationshipRawFacts(session)
    .map((raw) => String(raw.timestamp || ''))
    .filter(Boolean)
    .sort();
  return {
    pointerForks: compactPointerForkFacts(session),
    materializedFork: compactMaterializedForkFact(session),
    hasActivity: relationshipRawFacts(session).some((raw) => (
      raw.recordType === 'user'
      || raw.recordType === 'assistant'
      || raw.recordType === 'last-prompt'
    )),
    firstTimestamp: timestamps[0] || '',
    lastTimestamp: timestamps.at(-1) || '',
  };
}

function attachPointerFork(child, parent, evidence) {
  const fact = evidence.fact;
  if (!parent.matchesRepo || !fact?.forkPointUuid || !fact.inheritedContext?.rawRecordCount) return false;

  child.forkedFromSessionId = parent.id;
  child.forkStorageMode = 'pointer';
  child.forkedAt = fact.forkedAt;
  child.forkPointUuid = fact.forkPointUuid;
  const childRelationshipFacts = child._relationshipFacts || compactClaudeForkRelationshipFacts(child);
  child.forkContinuationState = childRelationshipFacts.hasActivity === false
    ? POINTER_FORK_WAITING_STATE
    : '';
  child.forkEvidence = {
    ownerSessionId: parent.id,
    command: POINTER_FORK_COMMAND,
    commandRawId: fact.commandRawId,
    outputRawId: fact.outputRawId,
  };
  child.inheritedContext = {
    ...structuredClone(fact.inheritedContext),
    ownerSessionId: parent.id,
  };
  if (child.projectAssociation !== 'embedded-cwd') {
    child.projectAssociation = 'parent-inherited';
    child.matchesRepo = parent.matchesRepo;
    child.cwdSet = new Set(parent.cwdSet || []);
  }

  if (fact.forkedAt) {
    const ownTimestamps = [
      childRelationshipFacts.firstTimestamp,
      childRelationshipFacts.lastTimestamp,
    ].filter(Boolean);
    child.startedAt = [fact.forkedAt, ...ownTimestamps].sort()[0];
    child.updatedAt = [fact.forkedAt, ...ownTimestamps].sort().at(-1);
    child.transcriptUpdatedAt = child.updatedAt;
  }
  return true;
}

function materializedForkBoundary(session, parent) {
  if (session._relationshipFacts) {
    const fact = session._relationshipFacts.materializedFork;
    if (!fact
        || fact.sourceSessionId !== parent.sourceSessionId
        || !fact.logicalBoundaryValid) return null;
    return {
      copiedRawRecordCount: fact.copiedRawRecordCount,
      continuationStartedAt: fact.continuationStartedAt,
      continuationUpdatedAt: fact.continuationUpdatedAt,
    };
  }
  const rawFacts = relationshipRawFacts(session);
  let copiedRawRecordCount = 0;
  while (copiedRawRecordCount < rawFacts.length
      && String(
        rawFacts[copiedRawRecordCount].sourceSessionReference
        || rawFacts[copiedRawRecordCount].parsed?.session_id
        || '',
      ) === parent.sourceSessionId) {
    copiedRawRecordCount += 1;
  }
  if (copiedRawRecordCount === 0) return null;
  const copiedIds = new Set(rawFacts
    .slice(0, copiedRawRecordCount)
    .map((raw) => raw.rawId));
  for (const event of relationshipLogicalFacts(session)) {
    const refs = event.rawRefs || [];
    if (!refs.length) continue;
    const copiedRefCount = refs.filter((ref) => copiedIds.has(ref.rawId)).length;
    if (copiedRefCount > 0 && copiedRefCount !== refs.length) return null;
  }
  const continuationTimestamps = rawFacts
    .slice(copiedRawRecordCount)
    .map((raw) => String(raw.timestamp || ''))
    .filter(Boolean)
    .sort();
  return {
    copiedRawRecordCount,
    continuationStartedAt: continuationTimestamps[0] || '',
    continuationUpdatedAt: continuationTimestamps.at(-1) || '',
  };
}

function inferMaterializedForks(mainSessions, bySourceId) {
  for (const session of mainSessions) {
    const candidates = new Map();
    for (const foreignId of session._foreignSessionIds || []) {
      const matches = bySourceId.get(foreignId) || [];
      if (matches.length !== 1) continue;
      const [candidate] = matches;
      if (candidate.id === session.id) continue;
      const sharesLineage = [...(session._rawUuidSet || [])].some((uuid) => candidate._rawUuidSet?.has(uuid));
      if (sharesLineage) candidates.set(candidate.id, candidate);
    }
    if (candidates.size !== 1) continue;
    const [parent] = candidates.values();
    const boundary = materializedForkBoundary(session, parent);
    if (!boundary) continue;
    session.forkedFromSessionId = parent.id;
    session.forkStorageMode = 'materialized';
    session.forkEvidence = {
      ownerSessionId: parent.id,
      copiedRawRecordCount: boundary.copiedRawRecordCount,
    };
    session.startedAt = boundary.continuationStartedAt;
    session.updatedAt = boundary.continuationUpdatedAt;
    session.transcriptUpdatedAt = session.updatedAt;
  }
}

function removeMaterializedForkCycles(mainSessions) {
  const byId = new Map(mainSessions.map((session) => [session.id, session]));
  const cycleMembers = new Set();
  for (const origin of mainSessions) {
    const order = [];
    const positions = new Map();
    let current = origin;
    while (current?.forkStorageMode === 'materialized' && current.forkedFromSessionId) {
      if (positions.has(current.id)) {
        for (const member of order.slice(positions.get(current.id))) cycleMembers.add(member);
        break;
      }
      positions.set(current.id, order.length);
      order.push(current);
      current = byId.get(current.forkedFromSessionId);
    }
  }
  for (const session of cycleMembers) {
    session.forkedFromSessionId = '';
    session.forkStorageMode = '';
    session.forkEvidence = null;
  }
}

function pointerForkEvidence(mainSessions) {
  const sessionsByContainer = new Map();
  for (const session of mainSessions) {
    const container = sourceContainerPath(session);
    if (!sessionsByContainer.has(container)) sessionsByContainer.set(container, []);
    sessionsByContainer.get(container).push(session);
  }

  const evidenceByChild = new Map();
  for (const parent of mainSessions) {
    const sameContainer = sessionsByContainer.get(sourceContainerPath(parent)) || [];
    const facts = parent._relationshipFacts?.pointerForks || compactPointerForkFacts(parent);
    for (const fact of facts) {
      const matchingChildren = sameContainer.filter((candidate) => (
        candidate.id !== parent.id
        && String(candidate.sourceSessionId || '').toLowerCase().startsWith(fact.sourceSessionIdPrefix)
      ));
      if (matchingChildren.length !== 1) continue;
      const [child] = matchingChildren;
      const candidates = evidenceByChild.get(child.id) || [];
      candidates.push({ child, parent, fact });
      evidenceByChild.set(child.id, candidates);
    }
  }
  return evidenceByChild;
}

function inferPointerForks(mainSessions) {
  for (const evidence of pointerForkEvidence(mainSessions).values()) {
    if (evidence.length !== 1) continue;
    const [candidate] = evidence;
    const { child, parent } = candidate;
    if (child.forkStorageMode === 'materialized') continue;
    if (child.forkedFromSessionId && child.forkedFromSessionId !== parent.id) continue;
    attachPointerFork(child, parent, candidate);
  }
}

function inferClaudeForkRelationships(sessions) {
  const mainSessions = sessions.filter((session) => !session.parentSessionId);
  const bySourceId = new Map();
  for (const session of mainSessions) {
    const matches = bySourceId.get(session.sourceSessionId) || [];
    matches.push(session);
    bySourceId.set(session.sourceSessionId, matches);
  }

  inferMaterializedForks(mainSessions, bySourceId);
  removeMaterializedForkCycles(mainSessions);
  inferPointerForks(mainSessions);

  for (const session of sessions) {
    delete session._foreignSessionIds;
    delete session._rawUuidSet;
    delete session._relationshipRawFacts;
    delete session._relationshipLogicalFacts;
    delete session._relationshipFacts;
  }
}

module.exports = {
  INHERITED_PREVIEW_LIMIT,
  POINTER_FORK_COMMAND,
  POINTER_FORK_WAITING_STATE,
  compactClaudeForkRelationshipFacts,
  inferClaudeForkRelationships,
  isPointerForkCommand,
  pointerForkOutput,
  rawAncestryAt,
};
