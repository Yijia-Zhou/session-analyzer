'use strict';

const {
  COMPARISON_STATE,
  createCacheObservation,
  createEmptyCacheDiscontinuityLinks,
} = require('./cache-observation');
const {
  notifyMaterializationObserver,
  observeMaterializationPhase,
} = require('./materialization-observer');

const CODEX_SOURCE_KIND = 'codex';

const TOKEN_ACCOUNTING_SOURCE = Object.freeze({
  LAST_TOKEN_USAGE: 'info.last_token_usage',
  INFO: 'info',
  PAYLOAD: 'payload',
  MISSING: 'missing',
});

const TURN_OWNERSHIP_EVIDENCE = Object.freeze({
  EXPLICIT_LIFECYCLE: 'explicit_lifecycle',
  LEGACY_TURN_CONTEXT: 'legacy_turn_context',
  CANONICAL_RAW_TURN_ID: 'canonical_raw_turn_id',
  IMPLICIT_USER_TURN: 'implicit_user_turn',
});

const ATTRIBUTION_REASON = Object.freeze({
  MAPPED: 'mapped',
  UNKNOWN_OWNER: 'unknown_owner',
  CONFLICTING_RAW_REF_OWNERS: 'conflicting_raw_ref_owners',
  ROLLBACK_BOUNDARY: 'rollback_boundary',
  CONFLICTING_TURN_CONTEXT: 'conflicting_turn_context',
  CONFLICTING_TURN_COMPLETION: 'conflicting_turn_completion',
  COMPLETION_WITHOUT_ACTIVE_TURN: 'completion_without_active_turn',
  AMBIGUOUS_TOKEN_EVENT: 'ambiguous_token_event',
  MISSING_TOKEN_SEED: 'missing_token_seed',
  INVALID_TOKEN_ACCOUNTING: 'invalid_token_accounting',
  UNKNOWN_PROTOCOL_RAW_ORDER: 'unknown_protocol_raw_order',
  DUPLICATE_PROTOCOL_RAW_ORDER: 'duplicate_protocol_raw_order',
  NO_MAIN_EVENT_FOR_OWNER: 'no_main_event_for_owner',
  NO_MAIN_ANCHOR_BEFORE_DISCONTINUITY: 'no_main_anchor_before_discontinuity',
});

const SEED_FIELDS = Object.freeze([
  'rawId',
  'model',
  'accountingSource',
  'candidate',
]);
const CANDIDATE_FIELDS = Object.freeze([
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'totalTokens',
]);
const SOURCE_TOKEN_FIELDS = Object.freeze([
  ['input_tokens', 'inputTokens'],
  ['cached_input_tokens', 'cachedInputTokens'],
  ['output_tokens', 'outputTokens'],
  ['total_tokens', 'totalTokens'],
]);
const accountingSources = new Set(Object.values(TOKEN_ACCOUNTING_SOURCE));

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactOwnKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function normalizedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedTokenSeedValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function ownsAnyTokenField(value) {
  return isRecord(value) && SOURCE_TOKEN_FIELDS.some(([field]) => Object.hasOwn(value, field));
}

function tokenUsageCandidate(payload) {
  if (!isRecord(payload)) {
    return { node: null, accountingSource: TOKEN_ACCOUNTING_SOURCE.MISSING };
  }
  const info = isRecord(payload.info) ? payload.info : null;
  const candidates = [
    {
      node: isRecord(info?.last_token_usage) ? info.last_token_usage : null,
      accountingSource: TOKEN_ACCOUNTING_SOURCE.LAST_TOKEN_USAGE,
    },
    { node: info, accountingSource: TOKEN_ACCOUNTING_SOURCE.INFO },
    { node: payload, accountingSource: TOKEN_ACCOUNTING_SOURCE.PAYLOAD },
  ];
  for (const candidate of candidates) {
    if (ownsAnyTokenField(candidate.node)) return candidate;
  }
  return { node: null, accountingSource: TOKEN_ACCOUNTING_SOURCE.MISSING };
}

function sourceNormalizedCandidate(node) {
  if (!isRecord(node)) return null;
  const candidate = {};
  for (const [sourceField, targetField] of SOURCE_TOKEN_FIELDS) {
    if (!Object.hasOwn(node, sourceField)) continue;
    candidate[targetField] = normalizedTokenSeedValue(node[sourceField]);
  }
  return candidate;
}

function extractCodexTokenAccounting(payload) {
  const selected = tokenUsageCandidate(payload);
  return {
    accountingSource: selected.accountingSource,
    candidate: sourceNormalizedCandidate(selected.node),
  };
}

function isTokenCountRaw(raw) {
  return raw?.recordType === 'event_msg' && raw?.payloadType === 'token_count';
}

function isModelEvidenceRaw(raw) {
  return raw?.recordType === 'turn_context'
    || raw?.recordType === 'session_meta'
    || (raw?.recordType === 'event_msg' && raw?.payloadType === 'session_configured')
    || isTokenCountRaw(raw);
}

function createCodexCacheObservationSeed(raw, payload) {
  const rawId = normalizedString(raw?.rawId);
  if (!rawId || !isModelEvidenceRaw(raw)) return null;
  const model = normalizedString(payload?.model);
  if (!isTokenCountRaw(raw)) {
    return model ? {
      rawId,
      model,
      accountingSource: null,
      candidate: null,
    } : null;
  }
  const accounting = extractCodexTokenAccounting(payload);
  return {
    rawId,
    model,
    accountingSource: accounting.accountingSource,
    candidate: accounting.candidate,
  };
}

function validateCodexCacheObservationSeed(seed) {
  if (!exactOwnKeys(seed, SEED_FIELDS)
      || !normalizedString(seed.rawId)
      || seed.rawId !== seed.rawId.trim()
      || typeof seed.model !== 'string'
      || seed.model !== seed.model.trim()
      || (seed.accountingSource !== null && !accountingSources.has(seed.accountingSource))) {
    throw new TypeError('Codex cache observation seed has an invalid exact shape');
  }
  if (seed.candidate === null) {
    if (seed.accountingSource !== null
        && seed.accountingSource !== TOKEN_ACCOUNTING_SOURCE.MISSING) {
      throw new TypeError('Codex cache observation seed missing candidate has an invalid source');
    }
    return seed;
  }
  if (!isRecord(seed.candidate)
      || Object.getPrototypeOf(seed.candidate) !== Object.prototype
      || Object.keys(seed.candidate).some((field) => !CANDIDATE_FIELDS.includes(field))) {
    throw new TypeError('Codex cache observation seed candidate has an invalid shape');
  }
  for (const value of Object.values(seed.candidate)) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError('Codex cache observation seed candidate must use safe integers or null');
    }
  }
  if (!accountingSources.has(seed.accountingSource)) {
    throw new TypeError('Codex token seed requires an accounting source');
  }
  return seed;
}

function normalizedTurnId(value) {
  return normalizedString(value);
}

function isUserTurnBoundaryRaw(raw) {
  return raw?.payloadType === 'user_message'
    || (raw?.recordType === 'response_item'
      && raw?.payloadType === 'message'
      && raw?.role === 'user');
}

function explicitTurnOwnerKey(turnId) {
  const normalized = normalizedTurnId(turnId);
  return normalized ? `explicit:${normalized}` : '';
}

function implicitTurnOwnerKey(raw, position) {
  const rawId = normalizedString(raw?.rawId);
  return `implicit:${rawId || position}`;
}

function turnOwnershipEvidencePriority(value) {
  switch (value) {
    case TURN_OWNERSHIP_EVIDENCE.EXPLICIT_LIFECYCLE:
      return 4;
    case TURN_OWNERSHIP_EVIDENCE.LEGACY_TURN_CONTEXT:
      return 3;
    case TURN_OWNERSHIP_EVIDENCE.CANONICAL_RAW_TURN_ID:
      return 2;
    case TURN_OWNERSHIP_EVIDENCE.IMPLICIT_USER_TURN:
      return 1;
    default:
      return 0;
  }
}

function isTurnStartedRaw(raw) {
  return raw?.recordType === 'event_msg'
    && (raw?.canonicalType === 'task_started'
      || raw?.payloadType === 'task_started'
      || raw?.payloadType === 'turn_started');
}

function isTurnCompletedRaw(raw) {
  return raw?.recordType === 'event_msg'
    && (raw?.canonicalType === 'task_complete'
      || raw?.payloadType === 'task_complete'
      || raw?.payloadType === 'turn_complete');
}

function isTurnAbortedRaw(raw) {
  return raw?.recordType === 'event_msg' && raw?.payloadType === 'turn_aborted';
}

function isRollbackRaw(raw) {
  return raw?.recordType === 'event_msg' && raw?.payloadType === 'thread_rolled_back';
}

function isMirroredUserBoundary(previous, current) {
  if (!isUserTurnBoundaryRaw(previous) || !isUserTurnBoundaryRaw(current)) return false;
  const responseThenEvent = previous.recordType === 'response_item'
    && current.recordType === 'event_msg'
    && current.payloadType === 'user_message';
  const eventThenResponse = previous.recordType === 'event_msg'
    && previous.payloadType === 'user_message'
    && current.recordType === 'response_item';
  if (!responseThenEvent && !eventThenResponse) return false;
  return String(previous.messageText || '').trim() === String(current.messageText || '').trim();
}

function buildRawTurnOwnershipIndex(rawEvents = []) {
  const aliases = new Map();
  const ownerInfoByKey = new Map();
  const provisionalByRawId = new Map();
  let activeOwnerKey = '';
  let lastCompletedOwnerKey = '';
  let ambiguityReason = '';
  let previousRaw = null;

  const resolveOwnerKey = (value) => {
    let key = typeof value === 'string' ? value : '';
    const visited = new Set();
    while (key && aliases.has(key) && !visited.has(key)) {
      visited.add(key);
      key = aliases.get(key);
    }
    return key;
  };

  const ensureOwnerInfo = (keyValue, candidate = {}) => {
    const key = resolveOwnerKey(keyValue);
    if (!key) return null;
    const existing = ownerInfoByKey.get(key) || {
      turnOwnerKey: key,
      explicitTurnId: null,
      evidenceTier: null,
      openedExplicitly: false,
      acceptsUserMessage: false,
    };
    const nextTier = typeof candidate.evidenceTier === 'string'
      ? candidate.evidenceTier
      : null;
    if (turnOwnershipEvidencePriority(nextTier)
        > turnOwnershipEvidencePriority(existing.evidenceTier)) {
      existing.evidenceTier = nextTier;
    }
    const explicitTurnId = normalizedTurnId(candidate.explicitTurnId);
    if (explicitTurnId) existing.explicitTurnId = explicitTurnId;
    if (candidate.openedExplicitly === true) existing.openedExplicitly = true;
    if (candidate.acceptsUserMessage === true) existing.acceptsUserMessage = true;
    existing.turnOwnerKey = key;
    ownerInfoByKey.set(key, existing);
    return existing;
  };

  const aliasOwner = (fromValue, toValue, candidate = {}) => {
    const from = resolveOwnerKey(fromValue);
    const to = resolveOwnerKey(toValue);
    if (!from || !to) return '';
    if (from !== to) {
      const fromInfo = ownerInfoByKey.get(from);
      aliases.set(from, to);
      if (fromInfo) ensureOwnerInfo(to, fromInfo);
    }
    ensureOwnerInfo(to, candidate);
    return to;
  };

  const openImplicitTurn = (raw, position) => {
    const key = implicitTurnOwnerKey(raw, position);
    activeOwnerKey = key;
    lastCompletedOwnerKey = '';
    ambiguityReason = '';
    ensureOwnerInfo(key, {
      evidenceTier: TURN_OWNERSHIP_EVIDENCE.IMPLICIT_USER_TURN,
    });
    return key;
  };

  for (let position = 0; position < rawEvents.length; position += 1) {
    const raw = rawEvents[position];
    if (!isRecord(raw)) continue;
    const rawId = normalizedString(raw.rawId);
    const rawTurnId = normalizedTurnId(raw.turnId);
    let assignedOwnerKey = '';
    let isTrailing = false;
    let conflictReason = '';

    if (isRollbackRaw(raw)) {
      activeOwnerKey = '';
      lastCompletedOwnerKey = '';
      ambiguityReason = ATTRIBUTION_REASON.ROLLBACK_BOUNDARY;
      conflictReason = ambiguityReason;
    } else if (isTurnStartedRaw(raw) && rawTurnId) {
      assignedOwnerKey = explicitTurnOwnerKey(rawTurnId);
      activeOwnerKey = assignedOwnerKey;
      lastCompletedOwnerKey = '';
      ambiguityReason = '';
      ensureOwnerInfo(assignedOwnerKey, {
        explicitTurnId: rawTurnId,
        evidenceTier: TURN_OWNERSHIP_EVIDENCE.EXPLICIT_LIFECYCLE,
        openedExplicitly: true,
        acceptsUserMessage: true,
      });
    } else if (isUserTurnBoundaryRaw(raw)) {
      const active = resolveOwnerKey(activeOwnerKey);
      const mirrored = isMirroredUserBoundary(previousRaw, raw);
      const activeInfo = ensureOwnerInfo(active);
      if (!active
          || ambiguityReason
          || (!mirrored && !activeInfo?.acceptsUserMessage)) {
        assignedOwnerKey = openImplicitTurn(raw, position);
      } else {
        assignedOwnerKey = active;
      }
    } else if (raw.recordType === 'turn_context' && rawTurnId) {
      const contextOwnerKey = explicitTurnOwnerKey(rawTurnId);
      const active = resolveOwnerKey(activeOwnerKey);
      const lastCompleted = resolveOwnerKey(lastCompletedOwnerKey);
      if (active) {
        const activeInfo = ensureOwnerInfo(active);
        if (!activeInfo?.explicitTurnId) {
          assignedOwnerKey = aliasOwner(active, contextOwnerKey, {
            explicitTurnId: rawTurnId,
            evidenceTier: TURN_OWNERSHIP_EVIDENCE.LEGACY_TURN_CONTEXT,
            acceptsUserMessage: true,
          });
          activeOwnerKey = assignedOwnerKey;
        } else if (activeInfo.explicitTurnId === rawTurnId) {
          assignedOwnerKey = active;
          ensureOwnerInfo(active, {
            explicitTurnId: rawTurnId,
            evidenceTier: TURN_OWNERSHIP_EVIDENCE.LEGACY_TURN_CONTEXT,
            acceptsUserMessage: true,
          });
        } else {
          activeOwnerKey = '';
          lastCompletedOwnerKey = '';
          ambiguityReason = ATTRIBUTION_REASON.CONFLICTING_TURN_CONTEXT;
          conflictReason = ambiguityReason;
        }
      } else if (lastCompleted
          && ensureOwnerInfo(lastCompleted)?.explicitTurnId === rawTurnId) {
        assignedOwnerKey = lastCompleted;
        isTrailing = true;
      } else {
        assignedOwnerKey = contextOwnerKey;
        activeOwnerKey = contextOwnerKey;
        lastCompletedOwnerKey = '';
        ambiguityReason = '';
        ensureOwnerInfo(contextOwnerKey, {
          explicitTurnId: rawTurnId,
          evidenceTier: TURN_OWNERSHIP_EVIDENCE.LEGACY_TURN_CONTEXT,
          acceptsUserMessage: true,
        });
      }
    } else if (isTurnCompletedRaw(raw) || isTurnAbortedRaw(raw)) {
      const active = resolveOwnerKey(activeOwnerKey);
      const lastCompleted = resolveOwnerKey(lastCompletedOwnerKey);
      const completionOwnerKey = explicitTurnOwnerKey(rawTurnId);
      if (active) {
        const activeInfo = ensureOwnerInfo(active);
        if (rawTurnId && activeInfo?.explicitTurnId && activeInfo.explicitTurnId !== rawTurnId) {
          activeOwnerKey = '';
          lastCompletedOwnerKey = '';
          ambiguityReason = ATTRIBUTION_REASON.CONFLICTING_TURN_COMPLETION;
          conflictReason = ambiguityReason;
        } else {
          assignedOwnerKey = active;
          if (rawTurnId && !activeInfo?.explicitTurnId) {
            assignedOwnerKey = aliasOwner(active, completionOwnerKey, {
              explicitTurnId: rawTurnId,
              evidenceTier: activeInfo?.evidenceTier,
            });
          }
          activeOwnerKey = '';
          lastCompletedOwnerKey = resolveOwnerKey(assignedOwnerKey);
          ambiguityReason = '';
        }
      } else if (lastCompleted
          && (!rawTurnId || ensureOwnerInfo(lastCompleted)?.explicitTurnId === rawTurnId)) {
        assignedOwnerKey = lastCompleted;
        isTrailing = true;
      } else {
        activeOwnerKey = '';
        lastCompletedOwnerKey = '';
        ambiguityReason = ATTRIBUTION_REASON.COMPLETION_WITHOUT_ACTIVE_TURN;
        conflictReason = ambiguityReason;
      }
    } else if (rawTurnId) {
      if (ambiguityReason) {
        conflictReason = ambiguityReason;
      } else {
        assignedOwnerKey = explicitTurnOwnerKey(rawTurnId);
        ensureOwnerInfo(assignedOwnerKey, {
          explicitTurnId: rawTurnId,
          evidenceTier: TURN_OWNERSHIP_EVIDENCE.CANONICAL_RAW_TURN_ID,
        });
      }
    } else {
      const active = resolveOwnerKey(activeOwnerKey);
      const lastCompleted = resolveOwnerKey(lastCompletedOwnerKey);
      if (active) assignedOwnerKey = active;
      else if (lastCompleted) {
        assignedOwnerKey = lastCompleted;
        isTrailing = true;
      } else if (ambiguityReason) {
        conflictReason = ambiguityReason;
      }
    }

    if (rawId) {
      provisionalByRawId.set(rawId, {
        turnOwnerKey: assignedOwnerKey,
        isTrailing,
        conflictReason,
      });
    }
    previousRaw = raw;
  }

  const byRawId = new Map();
  for (const [rawId, provisional] of provisionalByRawId) {
    const turnOwnerKey = resolveOwnerKey(provisional.turnOwnerKey);
    const ownerInfo = turnOwnerKey ? ensureOwnerInfo(turnOwnerKey) : null;
    byRawId.set(rawId, {
      turnOwnerKey: turnOwnerKey || '',
      explicitTurnId: ownerInfo?.explicitTurnId || null,
      evidenceTier: ownerInfo?.evidenceTier || null,
      isTrailing: provisional.isTrailing === true,
      conflictReason: provisional.conflictReason || null,
    });
  }

  const owners = new Map();
  for (const key of ownerInfoByKey.keys()) {
    const resolved = resolveOwnerKey(key);
    if (resolved !== key) continue;
    const info = ensureOwnerInfo(resolved);
    owners.set(resolved, { ...info });
  }
  return { byRawId, owners };
}

function turnOwnershipForEvent(event, ownershipIndex, { preferExplicitTurnId = true } = {}) {
  const explicitTurnId = preferExplicitTurnId ? normalizedTurnId(event?.turnId) : '';
  if (explicitTurnId) {
    const turnOwnerKey = explicitTurnOwnerKey(explicitTurnId);
    const ownerInfo = ownershipIndex?.owners?.get(turnOwnerKey);
    return {
      turnOwnerKey,
      explicitTurnId,
      evidenceTier: ownerInfo?.evidenceTier || TURN_OWNERSHIP_EVIDENCE.CANONICAL_RAW_TURN_ID,
      isTrailing: false,
      conflictReason: null,
      associationSource: 'canonical_turn_id',
    };
  }

  const owners = new Set();
  let isTrailing = false;
  let explicitConflictReason = '';
  for (const ref of Array.isArray(event?.rawRefs) ? event.rawRefs : []) {
    const rawOwner = ownershipIndex?.byRawId?.get(ref?.rawId);
    if (rawOwner?.turnOwnerKey) owners.add(rawOwner.turnOwnerKey);
    if (rawOwner?.isTrailing) isTrailing = true;
    if (rawOwner?.conflictReason) explicitConflictReason ||= rawOwner.conflictReason;
  }
  if (owners.size > 1) {
    return {
      turnOwnerKey: '',
      explicitTurnId: null,
      evidenceTier: null,
      isTrailing,
      conflictReason: ATTRIBUTION_REASON.CONFLICTING_RAW_REF_OWNERS,
      associationSource: 'raw_order',
    };
  }
  if (explicitConflictReason) {
    return {
      turnOwnerKey: '',
      explicitTurnId: null,
      evidenceTier: null,
      isTrailing,
      conflictReason: explicitConflictReason,
      associationSource: 'raw_order',
    };
  }
  const [turnOwnerKey = ''] = owners;
  const ownerInfo = ownershipIndex?.owners?.get(turnOwnerKey);
  return {
    turnOwnerKey,
    explicitTurnId: ownerInfo?.explicitTurnId || null,
    evidenceTier: ownerInfo?.evidenceTier || null,
    isTrailing,
    conflictReason: null,
    associationSource: 'raw_order',
  };
}

function eventRawOrder(event, rawOrder) {
  let latest = -1;
  for (const ref of Array.isArray(event?.rawRefs) ? event.rawRefs : []) {
    const order = rawOrder.get(ref?.rawId);
    if (Number.isSafeInteger(order) && order > latest) latest = order;
  }
  return latest;
}

function ownedRawEventsForSession(session) {
  const rawEvents = Array.isArray(session?.rawEvents) ? session.rawEvents : [];
  if (session?.forkStorageMode !== 'materialized') return rawEvents;
  const segments = session._forkSegmentsByRawId;
  if (!(segments instanceof Map) || segments.size !== rawEvents.length) {
    throw new Error('Materialized Codex fork cache input requires exact Raw segment ownership');
  }
  return rawEvents.filter((raw) => {
    const segment = segments.get(raw.rawId);
    if (!['fork_metadata', 'inherited_context', 'continuation'].includes(segment)) {
      throw new Error('Materialized Codex fork cache input has an unknown Raw segment');
    }
    return segment !== 'inherited_context';
  });
}

function indexCacheRelevantLogicalEvents(logicalEvents) {
  const tokenEventsByRawId = new Map();
  const mainEvents = [];
  logicalEvents.forEach((event, logicalOrder) => {
    if (Object.hasOwn(event, 'cacheObservation')) delete event.cacheObservation;
    if (event?.layer === 'main' && normalizedString(event.id)) {
      mainEvents.push({ event, logicalOrder });
    }
    if (event?.layer !== 'protocol' || event?.subtype !== 'token_count') return;
    const rawId = normalizedString(event.rawRefs?.[0]?.rawId);
    if (!rawId) return;
    const entries = tokenEventsByRawId.get(rawId) || [];
    entries.push({ event, logicalOrder });
    tokenEventsByRawId.set(rawId, entries);
  });
  return { tokenEventsByRawId, mainEvents };
}

function incrementCount(counts, key) {
  if (!key) return;
  counts.set(key, (counts.get(key) || 0) + 1);
}

function closedCounts(vocabulary, counts) {
  return Object.fromEntries(Object.values(vocabulary).map((value) => [value, counts.get(value) || 0]));
}

function buildCacheDiscontinuityLinks({
  logicalEvents,
  rawEvents,
  ownershipIndex,
  discontinuities,
  indexedMainEvents = null,
  indexedRawOrder = null,
}) {
  const links = createEmptyCacheDiscontinuityLinks();
  if (discontinuities.length === 0) {
    return {
      links,
      mainAssociationReasonCounts: new Map(),
      linkReasonCounts: new Map(),
    };
  }
  const rawOrder = indexedRawOrder
    || new Map(rawEvents.map((raw, index) => [raw?.rawId, index]));
  const candidatesByOwner = new Map();
  const mainAssociationReasonCounts = new Map();
  const linkReasonCounts = new Map();

  const mainEvents = indexedMainEvents || logicalEvents
    .map((event, logicalOrder) => ({ event, logicalOrder }))
    .filter(({ event }) => event?.layer === 'main' && normalizedString(event.id));
  mainEvents.forEach(({ event, logicalOrder }) => {
    const association = turnOwnershipForEvent(event, ownershipIndex);
    if (!association.turnOwnerKey) {
      incrementCount(
        mainAssociationReasonCounts,
        association.conflictReason || ATTRIBUTION_REASON.UNKNOWN_OWNER,
      );
      return;
    }
    const candidates = candidatesByOwner.get(association.turnOwnerKey) || [];
    candidates.push({
      event,
      logicalOrder,
      rawOrder: eventRawOrder(event, rawOrder),
    });
    candidatesByOwner.set(association.turnOwnerKey, candidates);
  });

  const groupsByOwner = new Map();
  for (const discontinuity of discontinuities) {
    const { event, association } = discontinuity;
    if (!association.turnOwnerKey) {
      incrementCount(
        linkReasonCounts,
        association.conflictReason || ATTRIBUTION_REASON.UNKNOWN_OWNER,
      );
      continue;
    }
    const protocolRawOrder = eventRawOrder(event, rawOrder);
    if (protocolRawOrder < 0) {
      incrementCount(linkReasonCounts, ATTRIBUTION_REASON.UNKNOWN_PROTOCOL_RAW_ORDER);
      continue;
    }
    const group = groupsByOwner.get(association.turnOwnerKey) || [];
    if (!group.some((entry) => entry.event.id === event.id)) {
      group.push({ event, protocolRawOrder, logicalOrder: discontinuity.logicalOrder });
    }
    groupsByOwner.set(association.turnOwnerKey, group);
  }

  for (const [turnOwnerKey, group] of groupsByOwner) {
    group.sort((left, right) => (
      left.protocolRawOrder - right.protocolRawOrder
      || left.logicalOrder - right.logicalOrder
    ));
    if (group.some((entry, index) => (
      index > 0 && entry.protocolRawOrder <= group[index - 1].protocolRawOrder
    ))) {
      for (const entry of group) {
        incrementCount(linkReasonCounts, ATTRIBUTION_REASON.DUPLICATE_PROTOCOL_RAW_ORDER);
      }
      continue;
    }
    const firstProtocolRawOrder = group[0].protocolRawOrder;
    const sameOwnerCandidates = candidatesByOwner.get(turnOwnerKey) || [];
    const eligible = sameOwnerCandidates.filter((candidate) => (
      candidate.rawOrder >= 0 && candidate.rawOrder <= firstProtocolRawOrder
    ));
    const anchor = eligible.reduce((latest, candidate) => {
      if (!latest) return candidate;
      if (candidate.rawOrder !== latest.rawOrder) {
        return candidate.rawOrder > latest.rawOrder ? candidate : latest;
      }
      return candidate.logicalOrder > latest.logicalOrder ? candidate : latest;
    }, null);
    if (!anchor?.event?.id) {
      const reason = sameOwnerCandidates.length
        ? ATTRIBUTION_REASON.NO_MAIN_ANCHOR_BEFORE_DISCONTINUITY
        : ATTRIBUTION_REASON.NO_MAIN_EVENT_FOR_OWNER;
      for (const entry of group) incrementCount(linkReasonCounts, reason);
      continue;
    }
    const protocolEventIds = group.map((entry) => entry.event.id);
    links.protocolEventIdsByMainEventId.set(anchor.event.id, protocolEventIds);
    for (const protocolEventId of protocolEventIds) {
      links.mainEventIdByProtocolEventId.set(protocolEventId, anchor.event.id);
      incrementCount(linkReasonCounts, ATTRIBUTION_REASON.MAPPED);
    }
  }
  return { links, mainAssociationReasonCounts, linkReasonCounts };
}

function requirePresentationLinkSeam(session) {
  const presentationIndexes = session?.presentationIndexes;
  const links = presentationIndexes?.cacheDiscontinuityLinks;
  if (!(presentationIndexes?.codeModeDeclaredRequests instanceof Map)
      || !(links?.protocolEventIdsByMainEventId instanceof Map)
      || !(links?.mainEventIdByProtocolEventId instanceof Map)) {
    throw new TypeError('Codex cache finalization requires the canonical presentation-index seam');
  }
  return presentationIndexes;
}

function finalizeCodexCacheObservation(session, seeds = []) {
  return observeMaterializationPhase('codex_cache_finalization', () => {
    if (session?.sourceKind !== CODEX_SOURCE_KIND
        || !Array.isArray(session.rawEvents)
        || !Array.isArray(session.logicalEvents)) {
      throw new TypeError('Codex cache finalization requires a complete Codex Session');
    }
    const presentationIndexes = requirePresentationLinkSeam(session);
    const logicalEvents = session.logicalEvents;
    const rawEvents = session.rawEvents;
    const logicalIndex = indexCacheRelevantLogicalEvents(logicalEvents);

    const seedByRawId = new Map();
    for (const seed of seeds) {
      validateCodexCacheObservationSeed(seed);
      if (seedByRawId.has(seed.rawId)) {
        throw new TypeError('Codex cache observation seeds must have unique Raw IDs');
      }
      seedByRawId.set(seed.rawId, seed);
    }
    const ownedRawEvents = ownedRawEventsForSession(session);
    const discontinuityOwnershipEvidenceCounts = new Map();
    const producerReasonCounts = new Map();
    const discontinuities = [];
    let activeModel = '';
    let compactionGeneration = 0;
    let previous = null;
    let tokenCount = 0;
    let observationCount = 0;
    let invalidBarrierCount = 0;

    for (const raw of ownedRawEvents) {
      const seed = seedByRawId.get(raw.rawId) || null;
      if (seed?.model) activeModel = seed.model;
      if (raw.recordType === 'event_msg' && raw.payloadType === 'context_compacted') {
        compactionGeneration += 1;
      }
      if (!isTokenCountRaw(raw)) continue;
      tokenCount += 1;
      const matchingEntries = logicalIndex.tokenEventsByRawId.get(raw.rawId) || [];
      if (matchingEntries.length !== 1) {
        previous = null;
        invalidBarrierCount += 1;
        incrementCount(producerReasonCounts, ATTRIBUTION_REASON.AMBIGUOUS_TOKEN_EVENT);
        continue;
      }
      const { event, logicalOrder } = matchingEntries[0];
      if (!seed) {
        previous = null;
        invalidBarrierCount += 1;
        incrementCount(producerReasonCounts, ATTRIBUTION_REASON.MISSING_TOKEN_SEED);
        continue;
      }
      if (seed.candidate === null) {
        previous = null;
        invalidBarrierCount += 1;
        incrementCount(producerReasonCounts, ATTRIBUTION_REASON.INVALID_TOKEN_ACCOUNTING);
        continue;
      }
      const produced = createCacheObservation(
        seed.candidate,
        previous?.cacheObservation || null,
        previous ? {
          previousEventId: previous.event.id,
          previousTimestamp: previous.event.timestamp,
          currentTimestamp: event.timestamp,
          previousModel: previous.model,
          currentModel: activeModel,
          previousCompactionGeneration: previous.compactionGeneration,
          currentCompactionGeneration: compactionGeneration,
        } : {},
      );
      if (!produced.cacheObservation) {
        previous = null;
        invalidBarrierCount += 1;
        incrementCount(producerReasonCounts, ATTRIBUTION_REASON.INVALID_TOKEN_ACCOUNTING);
        continue;
      }
      event.cacheObservation = produced.cacheObservation;
      observationCount += 1;
      if (event.cacheObservation.comparison.state === COMPARISON_STATE.CACHE_DISCONTINUITY) {
        discontinuities.push({
          event,
          association: null,
          logicalOrder,
        });
      }
      previous = {
        event,
        cacheObservation: event.cacheObservation,
        model: activeModel,
        compactionGeneration,
      };
    }

    const ownershipIndex = discontinuities.length > 0
      ? observeMaterializationPhase(
        'codex_cache_owner_reduction',
        () => buildRawTurnOwnershipIndex(ownedRawEvents),
      )
      : null;
    for (const discontinuity of discontinuities) {
      discontinuity.association = turnOwnershipForEvent(discontinuity.event, ownershipIndex, {
        preferExplicitTurnId: false,
      });
      if (discontinuity.association.evidenceTier) {
        incrementCount(
          discontinuityOwnershipEvidenceCounts,
          discontinuity.association.evidenceTier,
        );
      }
    }
    const linkProjection = buildCacheDiscontinuityLinks({
      logicalEvents,
      rawEvents,
      ownershipIndex,
      discontinuities,
      indexedMainEvents: logicalIndex.mainEvents,
      indexedRawOrder: discontinuities.length > 0
        ? new Map(rawEvents.map((raw, index) => [raw?.rawId, index]))
        : null,
    });
    presentationIndexes.cacheDiscontinuityLinks = linkProjection.links;

    const summary = {
      seedCount: seedByRawId.size,
      ownedRawCount: ownedRawEvents.length,
      tokenCount,
      observationCount,
      invalidBarrierCount,
      discontinuityCount: discontinuities.length,
      linkedDiscontinuityCount: linkProjection.links.mainEventIdByProtocolEventId.size,
      discontinuityOwnershipEvidenceCounts: closedCounts(
        TURN_OWNERSHIP_EVIDENCE,
        discontinuityOwnershipEvidenceCounts,
      ),
      producerReasonCounts: closedCounts(ATTRIBUTION_REASON, producerReasonCounts),
      mainAssociationReasonCounts: closedCounts(
        ATTRIBUTION_REASON,
        linkProjection.mainAssociationReasonCounts,
      ),
      linkReasonCounts: closedCounts(ATTRIBUTION_REASON, linkProjection.linkReasonCounts),
    };
    notifyMaterializationObserver({
      phase: 'codex_cache_finalization_summary',
      state: 'event',
      ...summary,
    });
    return summary;
  });
}

module.exports = {
  ATTRIBUTION_REASON,
  TOKEN_ACCOUNTING_SOURCE,
  TURN_OWNERSHIP_EVIDENCE,
  buildCacheDiscontinuityLinks,
  buildRawTurnOwnershipIndex,
  createCodexCacheObservationSeed,
  extractCodexTokenAccounting,
  finalizeCodexCacheObservation,
  turnOwnershipForEvent,
  validateCodexCacheObservationSeed,
};
