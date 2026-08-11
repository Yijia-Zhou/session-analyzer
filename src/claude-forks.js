'use strict';

const path = require('node:path');
const { normalizeFsPath } = require('./shared/fs-path');

const INHERITED_PREVIEW_LIMIT = 12;
const POINTER_FORK_COMMAND = '/fork';
const POINTER_FORK_WAITING_STATE = 'waiting_for_prompt';

function sourceContainerPath(session) {
  return normalizeFsPath(path.dirname(String(session?.sourceAbsFile || '')));
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
  for (const raw of parent.rawEvents || []) {
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
  return (parent.logicalEvents || []).filter((event) => {
    const refs = event.rawRefs || [];
    return refs.length > 0 && refs.every((ref) => rawIds.has(ref.rawId));
  });
}

function inheritedEventPreview(event) {
  return {
    parentEventId: String(event.id || ''),
    layer: event.layer === 'protocol' ? 'protocol' : 'main',
    kind: String(event.kind || ''),
    subtype: String(event.subtype || ''),
    status: String(event.status || ''),
    timestamp: String(event.timestamp || ''),
    preview: String(event.preview || ''),
  };
}

function pointerForkPointTarget(parent, inheritedRawEvents, mainEvents) {
  const mainTimeline = (parent.logicalEvents || []).filter((event) => event.layer !== 'protocol');
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
  const timelineIndex = (parent.rawEvents || []).findIndex((candidate) => candidate.rawId === raw.rawId);
  if (timelineIndex < 0) return null;
  return {
    layer: 'raw',
    eventId: String(raw.rawId || ''),
    timelineIndex,
  };
}

function pointerChildHasActivity(child) {
  return (child.rawEvents || []).some((raw) => (
    raw.recordType === 'user'
    || raw.recordType === 'assistant'
    || raw.recordType === 'last-prompt'
  ));
}

function attachPointerFork(child, parent, evidence) {
  const inheritedRawEvents = evidence.inheritedRawEvents || [];
  if (!parent.matchesRepo || !evidence.command.parentUuid || !inheritedRawEvents.length) return false;
  const inheritedRawIds = new Set(inheritedRawEvents.map((raw) => raw.rawId));
  const inheritedEvents = inheritedLogicalEvents(parent, inheritedRawIds);
  const mainEvents = inheritedEvents.filter((event) => event.layer !== 'protocol');
  const protocolEvents = inheritedEvents.filter((event) => event.layer === 'protocol');
  const previewEvents = mainEvents.slice(-INHERITED_PREVIEW_LIMIT).map(inheritedEventPreview);
  const forkedAt = evidence.command.timestamp || evidence.output.timestamp || '';
  const forkPointRaw = inheritedRawEvents.at(-1) || null;

  child.forkedFromSessionId = parent.id;
  child.forkStorageMode = 'pointer';
  child.forkedAt = forkedAt;
  child.forkPointUuid = String(evidence.command.parentUuid || '');
  child.forkContinuationState = pointerChildHasActivity(child) ? '' : POINTER_FORK_WAITING_STATE;
  child.forkEvidence = {
    ownerSessionId: parent.id,
    command: POINTER_FORK_COMMAND,
    commandRawId: evidence.command.rawId,
    outputRawId: evidence.output.rawId,
  };
  child.inheritedContext = {
    ownerSessionId: parent.id,
    forkPointUuid: child.forkPointUuid,
    forkPointRawId: String(forkPointRaw?.rawId || ''),
    rawRecordCount: inheritedRawEvents.length,
    mainEventCount: mainEvents.length,
    protocolEventCount: protocolEvents.length,
    previewEventCount: previewEvents.length,
    omittedPreviewEventCount: Math.max(0, mainEvents.length - previewEvents.length),
    startedAt: String(inheritedRawEvents[0]?.timestamp || ''),
    updatedAt: String(inheritedRawEvents.at(-1)?.timestamp || ''),
    forkPointTarget: pointerForkPointTarget(parent, inheritedRawEvents, mainEvents),
    previewEvents,
  };
  if (child.projectAssociation !== 'embedded-cwd') {
    child.projectAssociation = 'parent-inherited';
    child.matchesRepo = parent.matchesRepo;
    child.cwdSet = new Set(parent.cwdSet || []);
  }

  if (forkedAt) {
    const ownTimestamps = (child.rawEvents || []).map((raw) => raw.timestamp).filter(Boolean);
    child.startedAt = [forkedAt, ...ownTimestamps].sort()[0];
    child.updatedAt = [forkedAt, ...ownTimestamps].sort().at(-1);
    child.transcriptUpdatedAt = child.updatedAt;
  }
  return true;
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
    session.forkedFromSessionId = parent.id;
    session.forkStorageMode = 'materialized';
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
    const rawUuidCounts = new Map();
    for (const raw of parent.rawEvents || []) {
      if (!raw.uuid) continue;
      rawUuidCounts.set(raw.uuid, (rawUuidCounts.get(raw.uuid) || 0) + 1);
    }
    const outputsByParentUuid = new Map();
    for (const raw of parent.rawEvents || []) {
      if (!raw.parentUuid) continue;
      const output = pointerForkOutput(raw);
      if (!output) continue;
      const matches = outputsByParentUuid.get(raw.parentUuid) || [];
      matches.push({ raw, output });
      outputsByParentUuid.set(raw.parentUuid, matches);
    }
    for (const command of parent.rawEvents || []) {
      if (!command.uuid || !command.parentUuid || !isPointerForkCommand(command)) continue;
      if (rawUuidCounts.get(command.uuid) !== 1) continue;
      const inheritedRawEvents = rawAncestryAt(parent, command.parentUuid);
      if (!inheritedRawEvents.length) continue;
      const outputs = outputsByParentUuid.get(command.uuid) || [];
      for (const { raw: output, output: parsedOutput } of outputs) {
        const matchingChildren = sameContainer.filter((candidate) => (
          candidate.id !== parent.id
          && String(candidate.sourceSessionId || '').toLowerCase().startsWith(parsedOutput.sourceSessionIdPrefix)
        ));
        if (matchingChildren.length !== 1) continue;
        const [child] = matchingChildren;
        const candidates = evidenceByChild.get(child.id) || [];
        candidates.push({ child, parent, command, output, parsedOutput, inheritedRawEvents });
        evidenceByChild.set(child.id, candidates);
      }
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
  inferPointerForks(mainSessions);

  for (const session of sessions) {
    delete session._foreignSessionIds;
    delete session._rawUuidSet;
  }
}

module.exports = {
  INHERITED_PREVIEW_LIMIT,
  POINTER_FORK_COMMAND,
  POINTER_FORK_WAITING_STATE,
  inferClaudeForkRelationships,
  isPointerForkCommand,
  pointerForkOutput,
  rawAncestryAt,
};
