'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PRESENTATION_TOKEN_FIELDS,
  TIMELINE_CARD_LIFECYCLE_INVARIANT,
  advanceMonotonicRevision,
  capturePresentationToken,
  createTimelineCardLifecycle,
  notifyObserverSafely,
  presentationTokensEqual,
} = require('../src/browser/timeline-card-lifecycle');

function token(overrides = {}) {
  return {
    valid: true,
    localePresentationRevision: 0,
    foldingPresentationRevision: 0,
    overridesRevision: 0,
    navigationRevealRevision: 0,
    searchTransientRevision: 0,
    temporaryRevealRevision: 0,
    detailPresentationRevision: 0,
    ...overrides,
  };
}

function article(eventId, isConnected = true) {
  return { dataset: { eventId }, isConnected };
}

function slot(isConnected = true) {
  return { isConnected };
}

function card(eventId, options = {}) {
  return {
    eventId,
    articleNode: options.articleNode || article(eventId, options.isConnected ?? true),
    contextSlotNode: Object.hasOwn(options, 'contextSlotNode') ? options.contextSlotNode : null,
  };
}

test('register, lookup, nullable context slots, and duplicate rejection are explicit', () => {
  const lifecycle = createTimelineCardLifecycle();
  const first = lifecycle.registerMainOwner({
    canonicalContext: 'context-a',
    presentationToken: token(),
    ...card('event-a'),
  });
  const secondSlot = slot();
  const second = lifecycle.registerMainOwner({
    canonicalContext: 'context-a',
    presentationToken: token(),
    ...card('event-b', { contextSlotNode: secondSlot }),
  });

  assert.equal(lifecycle.lookup('event-a'), first);
  assert.equal(first.contextSlotNode, null);
  assert.equal(second.contextSlotNode, secondSlot);
  assert.throws(() => lifecycle.registerMainOwner({
    canonicalContext: 'context-a',
    presentationToken: token(),
    ...card('event-a'),
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
});

test('same-context full reconciliation reuses owners and replaces detached DOM references', () => {
  const lifecycle = createTimelineCardLifecycle();
  const oldArticle = article('event-a');
  const oldSlot = slot();
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [card('event-a', { articleNode: oldArticle, contextSlotNode: oldSlot })],
  });
  const owner = lifecycle.lookup('event-a');
  const nextArticle = article('event-a');
  const nextToken = token({ foldingPresentationRevision: 1 });
  const result = lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: nextToken,
    cards: [card('event-a', { articleNode: nextArticle })],
  });

  assert.equal(result.sameCanonicalContext, true);
  assert.equal(result.reusedOwnerCount, 1);
  assert.equal(lifecycle.lookup('event-a'), owner);
  assert.equal(owner.articleNode, nextArticle);
  assert.notEqual(owner.articleNode, oldArticle);
  assert.equal(owner.contextSlotNode, null);
  assert.notEqual(owner.contextSlotNode, oldSlot);
  assert.equal(owner.mountedPresentationToken.foldingPresentationRevision, 1);
});

test('different canonical contexts retire every owner even when event IDs collide', () => {
  const lifecycle = createTimelineCardLifecycle();
  const oldArticle = article('colliding-event');
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [card('colliding-event', { articleNode: oldArticle })],
  });
  const oldOwner = lifecycle.lookup('colliding-event');
  const newArticle = article('colliding-event');
  const result = lifecycle.reconcileMain({
    canonicalContext: 'context-b',
    presentationToken: token(),
    cards: [card('colliding-event', { articleNode: newArticle })],
  });
  const newOwner = lifecycle.lookup('colliding-event');

  assert.equal(result.sameCanonicalContext, false);
  assert.equal(result.retiredOwnerCount, 1);
  assert.notEqual(newOwner, oldOwner);
  assert.equal(oldOwner.articleNode, null);
  assert.equal(oldOwner.contextSlotNode, null);
  assert.equal(oldOwner.mountedCanonicalContext, null);
  assert.equal(newOwner.articleNode, newArticle);
  assert.equal(newOwner.mountedCanonicalContext, 'context-b');
});

test('non-Main retirement clears registry and releases all presentation references', () => {
  const lifecycle = createTimelineCardLifecycle();
  const articleNode = article('event-a');
  const contextSlotNode = slot();
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [card('event-a', { articleNode, contextSlotNode })],
  });
  const owner = lifecycle.lookup('event-a');
  const result = lifecycle.retireAll();

  assert.equal(result.retiredOwnerCount, 1);
  assert.equal(lifecycle.lookup('event-a'), null);
  assert.equal(owner.articleNode, null);
  assert.equal(owner.contextSlotNode, null);
  assert.equal(lifecycle.contentFreeObservation().ownerCount, 0);
});

test('suffix owner registration prevalidates conflicts and registers one connected batch', () => {
  const lifecycle = createTimelineCardLifecycle();
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [card('event-a')],
  });
  const suffixArticle = article('event-b', false);
  const suffixSlot = slot(false);
  const suffixCards = [card('event-b', {
    articleNode: suffixArticle,
    contextSlotNode: suffixSlot,
  })];
  assert.doesNotThrow(() => lifecycle.validateMainOwnerRegistration({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: suffixCards,
  }));
  assert.equal(lifecycle.lookup('event-b'), null, 'detached prevalidation must not mutate owners');
  assert.throws(() => lifecycle.validateMainOwnerRegistration({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [card('event-a')],
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
  assert.throws(() => lifecycle.registerMainOwners({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: suffixCards,
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
  assert.equal(lifecycle.lookup('event-b'), null);

  suffixArticle.isConnected = true;
  suffixSlot.isConnected = true;
  const result = lifecycle.registerMainOwners({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: suffixCards,
  });
  assert.equal(result.createdOwnerCount, 1);
  assert.equal(result.ownerCount, 2);
  assert.equal(lifecycle.lookup('event-b').articleNode, suffixArticle);
  assert.equal(lifecycle.lookup('event-b').contextSlotNode, suffixSlot);
});

test('parity snapshot detects missing, extra, disconnected, reference, and order failures', () => {
  const lifecycle = createTimelineCardLifecycle();
  const first = card('event-a');
  const second = card('event-b');
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [first, second],
  });
  assert.equal(lifecycle.paritySnapshot({
    expectedEventIds: ['event-a', 'event-b'],
    cards: [first, second],
  }).parityPassed, true);

  assert.equal(lifecycle.paritySnapshot({
    expectedEventIds: ['event-a', 'event-b', 'event-c'],
    cards: [first, second],
  }).missingOwnerCount, 1);
  assert.equal(lifecycle.paritySnapshot({
    expectedEventIds: ['event-a'],
    cards: [first, second],
  }).extraOwnerCount, 1);
  assert.equal(lifecycle.paritySnapshot({
    expectedEventIds: ['event-a', 'event-b'],
    cards: [second, first],
  }).cardOrderMatches, false);

  first.articleNode.isConnected = false;
  assert.equal(lifecycle.paritySnapshot({
    expectedEventIds: ['event-a', 'event-b'],
    cards: [first, second],
  }).disconnectedArticleCount, 1);
  first.articleNode.isConnected = true;
  assert.equal(lifecycle.paritySnapshot({
    expectedEventIds: ['event-a', 'event-b'],
    cards: [card('event-a'), second],
  }).referenceMismatchCount, 1);
});

test('presentation token capture and equality touch only a fixed set of scalar fields', () => {
  const captureAtSize = (size) => {
    const reads = [];
    const scalarSource = token();
    const hostileVariableState = {
      overrides: new Proxy(Object.create(null), { ownKeys() { throw new Error('overrides enumerated'); } }),
      searchTransientIds: new Proxy(new Array(size), { get(target, key) { if (key === Symbol.iterator) throw new Error('transients iterated'); return target[key]; } }),
      detailCache: new Proxy(Object.create(null), { ownKeys() { throw new Error('detail cache enumerated'); } }),
      owners: new Proxy(new Map(), { get() { throw new Error('owners traversed'); } }),
      dom: new Proxy({}, { get() { throw new Error('DOM inspected'); } }),
    };
    const source = new Proxy({ ...scalarSource, ...hostileVariableState }, {
      ownKeys() { throw new Error('token source enumerated'); },
      get(target, key) {
        reads.push(key);
        if (Object.hasOwn(hostileVariableState, key)) throw new Error(`variable state read: ${String(key)}`);
        return target[key];
      },
    });
    return { captured: capturePresentationToken(source), reads };
  };

  const empty = captureAtSize(0);
  const large = captureAtSize(100_000);
  for (const result of [empty, large]) {
    assert.equal(result.captured.valid, true);
    assert.deepEqual(
      new Set(result.reads),
      new Set(['valid', ...PRESENTATION_TOKEN_FIELDS]),
    );
  }
  assert.equal(large.reads.length, empty.reads.length);
  assert.equal(presentationTokensEqual(empty.captured, large.captured), true);
  assert.equal(presentationTokensEqual(
    empty.captured,
    capturePresentationToken(token({ detailPresentationRevision: 1 })),
  ), false);
});

test('mounted compatibility is fixed-cost and invalid tokens fail closed', () => {
  const lifecycle = createTimelineCardLifecycle();
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: token(),
    cards: [card('event-a')],
  });
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', token()), true);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-b', token()), false);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', token({ overridesRevision: 1 })), false);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', token({ valid: false })), false);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', token({ detailPresentationRevision: Number.MAX_SAFE_INTEGER + 1 })), false);
});

test('mounted presentation token adoption preflights every owner before one metadata-only write', () => {
  const lifecycle = createTimelineCardLifecycle();
  const firstArticle = new Proxy(article('event-a'), {
    get(target, key) {
      if (key !== 'dataset' && key !== 'isConnected') throw new Error(`DOM read during adoption: ${String(key)}`);
      return target[key];
    },
  });
  const previousToken = token();
  const nextToken = token({ detailPresentationRevision: 1 });
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: previousToken,
    cards: [card('event-a', { articleNode: firstArticle }), card('event-b')],
  });
  const firstOwner = lifecycle.lookup('event-a');
  const secondOwner = lifecycle.lookup('event-b');

  assert.deepEqual(lifecycle.adoptMountedPresentationToken({
    canonicalContext: 'context-a',
    expectedPreviousToken: previousToken,
    nextToken,
  }), { adoptedOwnerCount: 2, ownerCount: 2 });
  assert.equal(firstOwner.mountedPresentationToken, secondOwner.mountedPresentationToken);
  assert.equal(firstOwner.mountedPresentationToken.detailPresentationRevision, 1);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', nextToken), true);
});

test('mounted presentation token adoption fails closed without partial metadata writes', () => {
  const lifecycle = createTimelineCardLifecycle();
  const previousToken = token();
  const nextToken = token({ detailPresentationRevision: 1 });
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: previousToken,
    cards: [card('event-a'), card('event-b')],
  });
  const firstOwner = lifecycle.lookup('event-a');
  const secondOwner = lifecycle.lookup('event-b');
  secondOwner.mountedPresentationToken = token({ overridesRevision: 1 });

  assert.throws(() => lifecycle.adoptMountedPresentationToken({
    canonicalContext: 'context-a',
    expectedPreviousToken: previousToken,
    nextToken,
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
  assert.equal(firstOwner.mountedPresentationToken.detailPresentationRevision, 0);
  assert.equal(secondOwner.mountedPresentationToken.overridesRevision, 1);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', previousToken), true);

  assert.throws(() => lifecycle.adoptMountedPresentationToken({
    canonicalContext: 'context-b',
    expectedPreviousToken: previousToken,
    nextToken,
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
  assert.throws(() => lifecycle.adoptMountedPresentationToken({
    canonicalContext: 'context-a',
    expectedPreviousToken: token({ detailPresentationRevision: 9 }),
    nextToken,
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
  assert.throws(() => lifecycle.adoptMountedPresentationToken({
    canonicalContext: 'context-a',
    expectedPreviousToken: previousToken,
    nextToken: token({ valid: false }),
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
});

test('mounted presentation token adoption rejects inconsistent owner context before any write', () => {
  const lifecycle = createTimelineCardLifecycle();
  const previousToken = token();
  const nextToken = token({ detailPresentationRevision: 1 });
  lifecycle.reconcileMain({
    canonicalContext: 'context-a',
    presentationToken: previousToken,
    cards: [card('event-a'), card('event-b')],
  });
  const firstOwner = lifecycle.lookup('event-a');
  const secondOwner = lifecycle.lookup('event-b');
  secondOwner.mountedCanonicalContext = 'context-b';

  assert.throws(() => lifecycle.adoptMountedPresentationToken({
    canonicalContext: 'context-a',
    expectedPreviousToken: previousToken,
    nextToken,
  }), { code: TIMELINE_CARD_LIFECYCLE_INVARIANT });
  assert.equal(firstOwner.mountedPresentationToken.detailPresentationRevision, 0);
  assert.equal(secondOwner.mountedPresentationToken.detailPresentationRevision, 0);
  assert.equal(lifecycle.mountedContextAndTokenMatch('context-a', previousToken), true);
});

test('monotonic revisions never wrap and overflow fails closed', () => {
  assert.deepEqual(advanceMonotonicRevision(0), { value: 1, overflowed: false });
  assert.deepEqual(advanceMonotonicRevision(Number.MAX_SAFE_INTEGER - 1), {
    value: Number.MAX_SAFE_INTEGER,
    overflowed: false,
  });
  assert.deepEqual(advanceMonotonicRevision(Number.MAX_SAFE_INTEGER), {
    value: Number.MAX_SAFE_INTEGER,
    overflowed: true,
  });
  assert.throws(() => advanceMonotonicRevision(-1), {
    code: TIMELINE_CARD_LIFECYCLE_INVARIANT,
  });
});

test('optional observer notification isolates access, payload, throw, and rejection failures', async () => {
  let payloadCalls = 0;
  const createPayload = () => {
    payloadCalls += 1;
    return { value: 1 };
  };
  assert.equal(notifyObserverSafely(null, 'recordRevision', createPayload), false);
  assert.equal(notifyObserverSafely(new Proxy({}, {
    get() { throw new Error('malformed observer'); },
  }), 'recordRevision', createPayload), false);
  assert.equal(payloadCalls, 0, 'missing and malformed observers must not construct diagnostics');

  let semanticState = 0;
  semanticState += 1;
  assert.equal(notifyObserverSafely({
    recordRevision() { throw new Error('observer revision failure'); },
  }, 'recordRevision', createPayload), true);
  assert.equal(semanticState, 1);

  let renderCompleted = false;
  assert.equal(notifyObserverSafely({
    recordLifecycle() { throw new Error('observer lifecycle failure'); },
  }, 'recordLifecycle', createPayload), true);
  renderCompleted = true;
  assert.equal(renderCompleted, true);

  let unhandledRejection = null;
  const onUnhandledRejection = (error) => { unhandledRejection = error; };
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    assert.equal(notifyObserverSafely({
      recordRevision() { return Promise.reject(new Error('observer rejection')); },
    }, 'recordRevision', createPayload), true);
    assert.equal(notifyObserverSafely({
      recordLifecycle() {
        return Object.defineProperty({}, 'then', {
          get() { throw new Error('hostile thenable'); },
        });
      },
    }, 'recordLifecycle', createPayload), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandledRejection, null);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});
