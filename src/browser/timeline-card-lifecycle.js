'use strict';

const TIMELINE_CARD_LIFECYCLE_INVARIANT = 'TIMELINE_CARD_LIFECYCLE_INVARIANT';
const PRESENTATION_TOKEN_FIELDS = Object.freeze([
  'localePresentationRevision',
  'foldingPresentationRevision',
  'overridesRevision',
  'navigationRevealRevision',
  'searchTransientRevision',
  'temporaryRevealRevision',
  'detailPresentationRevision',
]);

function invariant(message) {
  const error = new Error(`Timeline card lifecycle invariant: ${message}`);
  error.code = TIMELINE_CARD_LIFECYCLE_INVARIANT;
  return error;
}

function advanceMonotonicRevision(current) {
  if (!Number.isSafeInteger(current) || current < 0) {
    throw invariant('presentation revision must be a non-negative safe integer');
  }
  if (current === Number.MAX_SAFE_INTEGER) {
    return Object.freeze({ value: current, overflowed: true });
  }
  return Object.freeze({ value: current + 1, overflowed: false });
}

function notifyObserverSafely(observer, methodName, createPayload) {
  let method;
  try {
    method = observer?.[methodName];
  } catch {
    return false;
  }
  if (typeof method !== 'function') return false;

  let result;
  try {
    result = method.call(observer, createPayload());
  } catch {
    return true;
  }
  if (!result || (typeof result !== 'object' && typeof result !== 'function')) return true;

  let then;
  try {
    then = result.then;
  } catch {
    return true;
  }
  if (typeof then !== 'function') return true;
  try {
    Promise.resolve(result).catch(() => {});
  } catch {}
  return true;
}

function capturePresentationToken(source) {
  const token = {
    valid: source?.valid !== false,
    localePresentationRevision: source?.localePresentationRevision,
    foldingPresentationRevision: source?.foldingPresentationRevision,
    overridesRevision: source?.overridesRevision,
    navigationRevealRevision: source?.navigationRevealRevision,
    searchTransientRevision: source?.searchTransientRevision,
    temporaryRevealRevision: source?.temporaryRevealRevision,
    detailPresentationRevision: source?.detailPresentationRevision,
  };
  for (const field of PRESENTATION_TOKEN_FIELDS) {
    if (!Number.isSafeInteger(token[field]) || token[field] < 0) token.valid = false;
  }
  return Object.freeze(token);
}

function presentationTokensEqual(left, right) {
  if (!left?.valid || !right?.valid) return false;
  return left.localePresentationRevision === right.localePresentationRevision
    && left.foldingPresentationRevision === right.foldingPresentationRevision
    && left.overridesRevision === right.overridesRevision
    && left.navigationRevealRevision === right.navigationRevealRevision
    && left.searchTransientRevision === right.searchTransientRevision
    && left.temporaryRevealRevision === right.temporaryRevealRevision
    && left.detailPresentationRevision === right.detailPresentationRevision;
}

function validateCanonicalContext(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invariant('mounted canonical context must be a non-empty string');
  }
  return value;
}

function validateCardDescriptor(card) {
  if (!card || typeof card !== 'object') throw invariant('card descriptor must be an object');
  const eventId = card.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    throw invariant('owner event ID must be a non-empty string');
  }
  if (!card.articleNode || typeof card.articleNode !== 'object') {
    throw invariant('owner article node must be an object');
  }
  if (card.articleNode.dataset?.eventId !== eventId) {
    throw invariant('owner event ID must match the article dataset');
  }
  if (card.contextSlotNode !== null && card.contextSlotNode !== undefined
      && typeof card.contextSlotNode !== 'object') {
    throw invariant('context slot node must be an object or null');
  }
  return {
    eventId,
    articleNode: card.articleNode,
    contextSlotNode: card.contextSlotNode || null,
  };
}

function validateCardDescriptors(cards) {
  if (!cards || typeof cards[Symbol.iterator] !== 'function') {
    throw invariant('card descriptors must be iterable');
  }
  const descriptors = [];
  const ids = new Set();
  for (const card of cards) {
    const descriptor = validateCardDescriptor(card);
    if (ids.has(descriptor.eventId)) throw invariant('owner event IDs must be unique');
    ids.add(descriptor.eventId);
    descriptors.push(descriptor);
  }
  return descriptors;
}

function createTimelineCardLifecycle() {
  let ownersById = new Map();
  let mountedCanonicalContext = null;
  let mountedPresentationToken = null;
  let mountedCanonicalContextSerial = 0;
  let nextCanonicalContextSerial = 1;
  let nextOwnerSerial = 1;

  function retireOwner(owner) {
    owner.articleNode = null;
    owner.contextSlotNode = null;
    owner.mountedCanonicalContext = null;
    owner.mountedPresentationToken = null;
  }

  function retireAll() {
    const retiredOwnerCount = ownersById.size;
    for (const owner of ownersById.values()) retireOwner(owner);
    ownersById = new Map();
    mountedCanonicalContext = null;
    mountedPresentationToken = null;
    mountedCanonicalContextSerial = 0;
    return {
      sameCanonicalContext: false,
      createdOwnerCount: 0,
      reusedOwnerCount: 0,
      retiredOwnerCount,
      ownerCount: 0,
    };
  }

  function createOwner(descriptor, canonicalContext, presentationToken) {
    return {
      eventId: descriptor.eventId,
      articleNode: descriptor.articleNode,
      contextSlotNode: descriptor.contextSlotNode,
      mountedCanonicalContext: canonicalContext,
      mountedPresentationToken: presentationToken,
      ownerSerial: nextOwnerSerial++,
    };
  }

  function registerMainOwner({ canonicalContext, presentationToken, ...card }) {
    const nextContext = validateCanonicalContext(canonicalContext);
    const nextToken = capturePresentationToken(presentationToken);
    const descriptor = validateCardDescriptor(card);
    if (mountedCanonicalContext === null) {
      mountedCanonicalContext = nextContext;
      mountedPresentationToken = nextToken;
      mountedCanonicalContextSerial = nextCanonicalContextSerial++;
    } else if (mountedCanonicalContext !== nextContext
        || !presentationTokensEqual(mountedPresentationToken, nextToken)) {
      throw invariant('new owner registration requires the mounted context and presentation token');
    }
    if (ownersById.has(descriptor.eventId)) throw invariant('duplicate owner event ID');
    const owner = createOwner(descriptor, nextContext, mountedPresentationToken);
    ownersById.set(owner.eventId, owner);
    return owner;
  }

  function validateMainOwnerRegistration({ canonicalContext, presentationToken, cards }) {
    const nextContext = validateCanonicalContext(canonicalContext);
    const nextToken = capturePresentationToken(presentationToken);
    const descriptors = validateCardDescriptors(cards);
    if (mountedCanonicalContext !== nextContext
        || !presentationTokensEqual(mountedPresentationToken, nextToken)) {
      throw invariant('new owner registration requires the mounted context and presentation token');
    }
    for (const descriptor of descriptors) {
      if (ownersById.has(descriptor.eventId)) throw invariant('duplicate owner event ID');
    }
    return { canonicalContext: nextContext, presentationToken: nextToken, cards: descriptors };
  }

  function registerMainOwners(input) {
    const prepared = validateMainOwnerRegistration(input);
    for (const descriptor of prepared.cards) {
      if (descriptor.articleNode.isConnected !== true) {
        throw invariant('new owner article must be connected before registration');
      }
      if (descriptor.contextSlotNode && descriptor.contextSlotNode.isConnected !== true) {
        throw invariant('new owner context slot must be connected before registration');
      }
    }
    const owners = prepared.cards.map((descriptor) => (
      createOwner(descriptor, prepared.canonicalContext, mountedPresentationToken)
    ));
    for (const owner of owners) ownersById.set(owner.eventId, owner);
    return {
      sameCanonicalContext: true,
      createdOwnerCount: owners.length,
      reusedOwnerCount: 0,
      retiredOwnerCount: 0,
      ownerCount: ownersById.size,
    };
  }

  function reconcileMain({ canonicalContext, presentationToken, cards }) {
    const nextContext = validateCanonicalContext(canonicalContext);
    const nextToken = capturePresentationToken(presentationToken);
    const descriptors = validateCardDescriptors(cards);
    const sameCanonicalContext = mountedCanonicalContext !== null
      && mountedCanonicalContext === nextContext;
    const previousOwners = sameCanonicalContext ? ownersById : new Map();
    let retiredOwnerCount = 0;
    if (!sameCanonicalContext) {
      retiredOwnerCount = ownersById.size;
      for (const owner of ownersById.values()) retireOwner(owner);
      mountedCanonicalContextSerial = nextCanonicalContextSerial++;
    }

    const nextOwners = new Map();
    let createdOwnerCount = 0;
    let reusedOwnerCount = 0;
    for (const descriptor of descriptors) {
      let owner = previousOwners.get(descriptor.eventId);
      if (owner) {
        reusedOwnerCount += 1;
        owner.articleNode = descriptor.articleNode;
        owner.contextSlotNode = descriptor.contextSlotNode;
        owner.mountedCanonicalContext = nextContext;
        owner.mountedPresentationToken = nextToken;
      } else {
        createdOwnerCount += 1;
        owner = createOwner(descriptor, nextContext, nextToken);
      }
      nextOwners.set(owner.eventId, owner);
    }

    if (sameCanonicalContext) {
      for (const [eventId, owner] of previousOwners) {
        if (nextOwners.has(eventId)) continue;
        retireOwner(owner);
        retiredOwnerCount += 1;
      }
    }

    ownersById = nextOwners;
    mountedCanonicalContext = nextContext;
    mountedPresentationToken = nextToken;
    return {
      sameCanonicalContext,
      createdOwnerCount,
      reusedOwnerCount,
      retiredOwnerCount,
      ownerCount: ownersById.size,
    };
  }

  function lookup(eventId) {
    return ownersById.get(eventId) || null;
  }

  function mountedContextAndTokenMatch(canonicalContext, presentationToken) {
    return mountedCanonicalContext !== null
      && mountedCanonicalContext === canonicalContext
      && presentationTokensEqual(mountedPresentationToken, capturePresentationToken(presentationToken));
  }

  function paritySnapshot({ expectedEventIds, cards }) {
    if (!expectedEventIds || typeof expectedEventIds[Symbol.iterator] !== 'function') {
      throw invariant('expected event IDs must be iterable');
    }
    const expectedIds = [...expectedEventIds];
    const descriptors = [];
    let invalidCardCount = 0;
    try {
      descriptors.push(...validateCardDescriptors(cards));
    } catch {
      invalidCardCount += 1;
      for (const card of cards || []) {
        try {
          descriptors.push(validateCardDescriptor(card));
        } catch {
          invalidCardCount += 1;
        }
      }
    }
    const expectedSet = new Set(expectedIds);
    const descriptorIds = descriptors.map((card) => card.eventId);
    const descriptorSet = new Set(descriptorIds);
    const descriptorsById = new Map(descriptors.map((card) => [card.eventId, card]));
    const ownerIds = [...ownersById.keys()];
    let missingOwnerCount = 0;
    let missingCardCount = 0;
    let disconnectedArticleCount = 0;
    let disconnectedContextSlotCount = 0;
    let referenceMismatchCount = 0;
    for (const eventId of expectedIds) {
      const owner = ownersById.get(eventId);
      const card = descriptorsById.get(eventId);
      if (!owner) missingOwnerCount += 1;
      if (!card) missingCardCount += 1;
      if (owner?.articleNode?.isConnected !== true) disconnectedArticleCount += 1;
      if (owner?.contextSlotNode && owner.contextSlotNode.isConnected !== true) {
        disconnectedContextSlotCount += 1;
      }
      if (owner && card && (owner.articleNode !== card.articleNode
          || owner.contextSlotNode !== card.contextSlotNode)) referenceMismatchCount += 1;
    }
    const extraOwnerCount = ownerIds.filter((eventId) => !expectedSet.has(eventId)).length;
    const extraCardCount = descriptorIds.filter((eventId) => !expectedSet.has(eventId)).length;
    const ownerOrderMatches = ownerIds.length === expectedIds.length
      && ownerIds.every((eventId, index) => eventId === expectedIds[index]);
    const cardOrderMatches = descriptorIds.length === expectedIds.length
      && descriptorIds.every((eventId, index) => eventId === expectedIds[index]);
    const duplicateExpectedCount = expectedIds.length - expectedSet.size;
    const duplicateCardCount = descriptorIds.length - descriptorSet.size;
    const parityPassed = ownersById.size === expectedIds.length
      && descriptors.length === expectedIds.length
      && invalidCardCount === 0
      && missingOwnerCount === 0
      && missingCardCount === 0
      && extraOwnerCount === 0
      && extraCardCount === 0
      && duplicateExpectedCount === 0
      && duplicateCardCount === 0
      && disconnectedArticleCount === 0
      && disconnectedContextSlotCount === 0
      && referenceMismatchCount === 0
      && ownerOrderMatches
      && cardOrderMatches;
    return {
      expectedCount: expectedIds.length,
      ownerCount: ownersById.size,
      cardCount: descriptors.length,
      missingOwnerCount,
      missingCardCount,
      extraOwnerCount,
      extraCardCount,
      invalidCardCount,
      duplicateExpectedCount,
      duplicateCardCount,
      disconnectedArticleCount,
      disconnectedContextSlotCount,
      referenceMismatchCount,
      ownerOrderMatches,
      cardOrderMatches,
      parityPassed,
    };
  }

  function contentFreeObservation() {
    return {
      ownerCount: ownersById.size,
      mountedCanonicalContextSerial,
      mountedPresentationToken: mountedPresentationToken
        ? { ...mountedPresentationToken }
        : null,
      ownerSerials: [...ownersById.values()].map((owner) => owner.ownerSerial),
    };
  }

  return {
    contentFreeObservation,
    lookup,
    mountedContextAndTokenMatch,
    paritySnapshot,
    reconcileMain,
    registerMainOwner,
    registerMainOwners,
    retireAll,
    validateMainOwnerRegistration,
  };
}

module.exports = {
  PRESENTATION_TOKEN_FIELDS,
  TIMELINE_CARD_LIFECYCLE_INVARIANT,
  advanceMonotonicRevision,
  capturePresentationToken,
  createTimelineCardLifecycle,
  notifyObserverSafely,
  presentationTokensEqual,
};
