'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const codex = require('../src/codex');
const {
  ATTRIBUTION_REASON,
  TOKEN_ACCOUNTING_SOURCE,
  TURN_OWNERSHIP_EVIDENCE,
  buildCacheDiscontinuityLinks,
  buildRawTurnOwnershipIndex,
  createCodexCacheObservationSeed,
  extractCodexTokenAccounting,
  finalizeCodexCacheObservation,
  turnOwnershipForEvent,
} = require('../src/codex-cache-observation');
const {
  COMPARISON_STATE,
} = require('../src/cache-observation');
const {
  createEmptyMaterializedPresentationIndexes,
} = require('../src/canonical-contract');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
  estimateMaterializedSessionBytes,
} = require('../src/materialized-session-owner');
const {
  PROJECT_QUERY_STORE_SCHEMA_VERSION,
  buildProjectQueryStore,
  projectQueryProjectionDigest,
} = require('../src/project-query-store');
const { runWithMaterializationObserver } = require('../src/materialization-observer');
const {
  materializeSessionForIndex,
} = require('../src/source-adapters');

function raw(rawId, fields = {}) {
  return {
    rawId,
    recordType: fields.recordType || 'event_msg',
    payloadType: fields.payloadType || '',
    canonicalType: fields.canonicalType || fields.payloadType || '',
    turnId: fields.turnId || '',
    role: fields.role || '',
    messageText: fields.messageText || '',
    ...fields,
  };
}

function logicalEvent(id, rawId, fields = {}) {
  return {
    id,
    sourceKind: 'codex',
    schemaVersion: 1,
    timestamp: fields.timestamp || '2026-09-02T00:00:00.000Z',
    turnId: fields.turnId || '',
    kind: fields.kind || 'assistant_message',
    subtype: fields.subtype || fields.kind || 'assistant_message',
    layer: fields.layer || 'main',
    rawRefs: fields.rawRefs || [{ rawId }],
    ...fields,
  };
}

function tokenEvent(rawId, position, fields = {}) {
  return logicalEvent(`protocol-${rawId}`, rawId, {
    timestamp: new Date(Date.parse('2026-09-02T00:00:00.000Z') + position * 60_000).toISOString(),
    kind: 'protocol',
    subtype: 'token_count',
    layer: 'protocol',
    ...fields,
  });
}

function tokenSeed(rawId, candidate, fields = {}) {
  return {
    rawId,
    model: fields.model || '',
    accountingSource: fields.accountingSource || TOKEN_ACCOUNTING_SOURCE.LAST_TOKEN_USAGE,
    candidate,
  };
}

function modelSeed(rawId, model) {
  return {
    rawId,
    model,
    accountingSource: null,
    candidate: null,
  };
}

function directSession(rawEvents, logicalEvents, fields = {}) {
  return {
    id: 'direct-cache-session',
    sourceKind: 'codex',
    rawEvents,
    logicalEvents,
    forkStorageMode: '',
    presentationIndexes: createEmptyMaterializedPresentationIndexes(),
    ...fields,
  };
}

function validHigh() {
  return { inputTokens: 16_384, cachedInputTokens: 16_384 };
}

function validDrop() {
  return { inputTokens: 12_288, cachedInputTokens: 8_192 };
}

function cacheProjection(session) {
  const tokenEvents = session.logicalEvents
    .filter((event) => event.layer === 'protocol' && event.subtype === 'token_count')
    .map((event) => ({ id: event.id, cacheObservation: event.cacheObservation || null }));
  const links = session.presentationIndexes.cacheDiscontinuityLinks;
  return {
    tokenEvents,
    forward: [...links.protocolEventIdsByMainEventId],
    reverse: [...links.mainEventIdByProtocolEventId],
  };
}

function semanticEventWithoutCache(event) {
  const clone = structuredClone(event);
  delete clone.cacheObservation;
  return clone;
}

test('Codex token extraction freezes exact candidate precedence and cumulative exclusion', () => {
  const allLevels = extractCodexTokenAccounting({
    input_tokens: 1,
    cached_input_tokens: 1,
    info: {
      input_tokens: 2,
      cached_input_tokens: 2,
      last_token_usage: {
        input_tokens: 3,
        cached_input_tokens: 0,
        output_tokens: 4,
        total_tokens: 7,
      },
    },
  });
  assert.deepEqual(allLevels, {
    accountingSource: TOKEN_ACCOUNTING_SOURCE.LAST_TOKEN_USAGE,
    candidate: {
      inputTokens: 3,
      cachedInputTokens: 0,
      outputTokens: 4,
      totalTokens: 7,
    },
  });
  assert.deepEqual(extractCodexTokenAccounting({
    info: { input_tokens: 20, cached_input_tokens: 10 },
  }), {
    accountingSource: TOKEN_ACCOUNTING_SOURCE.INFO,
    candidate: { inputTokens: 20, cachedInputTokens: 10 },
  });
  assert.deepEqual(extractCodexTokenAccounting({
    input_tokens: 30,
    cached_input_tokens: 15,
  }), {
    accountingSource: TOKEN_ACCOUNTING_SOURCE.PAYLOAD,
    candidate: { inputTokens: 30, cachedInputTokens: 15 },
  });
  assert.deepEqual(extractCodexTokenAccounting({
    info: {
      total_token_usage: { input_tokens: 99_999, cached_input_tokens: 99_999 },
    },
  }), {
    accountingSource: TOKEN_ACCOUNTING_SOURCE.MISSING,
    candidate: null,
  });
});

test('present incomplete last_token_usage fails closed without falling through', () => {
  assert.deepEqual(extractCodexTokenAccounting({
    info: {
      input_tokens: 40_000,
      cached_input_tokens: 40_000,
      last_token_usage: { input_tokens: 1_000 },
      total_token_usage: { input_tokens: 50_000, cached_input_tokens: 50_000 },
    },
  }), {
    accountingSource: TOKEN_ACCOUNTING_SOURCE.LAST_TOKEN_USAGE,
    candidate: { inputTokens: 1_000 },
  });
});

test('seed creation retains only bounded normalized candidate/model facts', () => {
  const tokenRaw = raw('raw-token', { payloadType: 'token_count' });
  assert.deepEqual(createCodexCacheObservationSeed(tokenRaw, {
    model: '  gpt-test  ',
    info: { last_token_usage: {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: Infinity,
      total_tokens: -1,
    } },
  }), {
    rawId: 'raw-token',
    model: 'gpt-test',
    accountingSource: TOKEN_ACCOUNTING_SOURCE.LAST_TOKEN_USAGE,
    candidate: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: null,
      totalTokens: null,
    },
  });
  assert.deepEqual(createCodexCacheObservationSeed(
    raw('raw-context', { recordType: 'turn_context' }),
    { model: 'gpt-context' },
  ), modelSeed('raw-context', 'gpt-context'));
  assert.equal(createCodexCacheObservationSeed(
    raw('raw-ordinary', { recordType: 'response_item', payloadType: 'message' }),
    { model: 'must-not-be-retained' },
  ), null);
});

test('invalid accounting is a comparison barrier while malformed optionals remain valid', () => {
  const raws = [
    raw('token-a', { payloadType: 'token_count' }),
    raw('token-invalid', { payloadType: 'token_count' }),
    raw('token-c', { payloadType: 'token_count' }),
    raw('token-d', { payloadType: 'token_count' }),
  ];
  const events = raws.map((entry, index) => tokenEvent(entry.rawId, index));
  const session = directSession(raws, events);
  const summary = finalizeCodexCacheObservation(session, [
    tokenSeed('token-a', validHigh()),
    tokenSeed('token-invalid', { inputTokens: 12_288 }),
    tokenSeed('token-c', {
      ...validHigh(),
      outputTokens: null,
      totalTokens: null,
    }),
    tokenSeed('token-d', validDrop()),
  ]);
  assert.equal(events[0].cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.equal(Object.hasOwn(events[1], 'cacheObservation'), false);
  assert.equal(events[2].cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.equal(events[3].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  assert.equal(events[2].cacheObservation.outputTokens, null);
  assert.equal(summary.invalidBarrierCount, 1);
});

test('quiet cache finalization skips ownership/link reconstruction after producing facts', () => {
  const raws = [
    raw('start', { payloadType: 'turn_started', turnId: 'quiet-turn' }),
    raw('main', { payloadType: 'message', turnId: 'quiet-turn' }),
    raw('token-a', { payloadType: 'token_count' }),
    raw('token-b', { payloadType: 'token_count' }),
  ];
  const events = [
    logicalEvent('main-event', 'main', { turnId: 'quiet-turn' }),
    tokenEvent('token-a', 1),
    tokenEvent('token-b', 2),
  ];
  const observed = [];
  const session = directSession(raws, events);
  const summary = runWithMaterializationObserver(
    (event) => observed.push(event),
    () => finalizeCodexCacheObservation(session, [
      tokenSeed('token-a', validHigh()),
      tokenSeed('token-b', validHigh()),
    ]),
  );
  assert.equal(summary.observationCount, 2);
  assert.equal(summary.discontinuityCount, 0);
  assert.equal(events[1].cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.equal(events[2].cacheObservation.comparison.state, COMPARISON_STATE.COMPARABLE);
  assert.equal(
    observed.some((event) => event.phase === 'codex_cache_owner_reduction'),
    false,
  );
  assert.equal(session.presentationIndexes.cacheDiscontinuityLinks
    .protocolEventIdsByMainEventId.size, 0);
  assert.equal(session.presentationIndexes.cacheDiscontinuityLinks
    .mainEventIdByProtocolEventId.size, 0);
});

test('excluded valid comparisons still become the next predecessor', async (t) => {
  await t.test('timestamp', () => {
    const raws = ['a', 'b', 'c'].map((id) => raw(id, { payloadType: 'token_count' }));
    const events = [
      tokenEvent('a', 0),
      tokenEvent('b', 0),
      tokenEvent('c', 1),
    ];
    finalizeCodexCacheObservation(directSession(raws, events), [
      tokenSeed('a', validHigh()),
      tokenSeed('b', { inputTokens: 8_192, cachedInputTokens: 8_192 }),
      tokenSeed('c', { inputTokens: 6_144, cachedInputTokens: 0 }),
    ]);
    assert.equal(events[1].cacheObservation.comparison.state, COMPARISON_STATE.UNKNOWN_OR_NON_MONOTONIC_TIMESTAMP);
    assert.equal(events[2].cacheObservation.comparison.previousEventId, events[1].id);
    assert.equal(events[2].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  });

  await t.test('model and compaction', () => {
    const raws = [
      raw('model-a', { recordType: 'turn_context' }),
      raw('a', { payloadType: 'token_count' }),
      raw('model-b', { recordType: 'turn_context' }),
      raw('b', { payloadType: 'token_count' }),
      raw('compact', { payloadType: 'context_compacted' }),
      raw('c', { payloadType: 'token_count' }),
      raw('d', { payloadType: 'token_count' }),
    ];
    const events = [tokenEvent('a', 0), tokenEvent('b', 1), tokenEvent('c', 2), tokenEvent('d', 3)];
    finalizeCodexCacheObservation(directSession(raws, events), [
      modelSeed('model-a', 'model-a'),
      tokenSeed('a', validHigh()),
      modelSeed('model-b', 'model-b'),
      tokenSeed('b', validHigh()),
      tokenSeed('c', validHigh()),
      tokenSeed('d', validDrop()),
    ]);
    assert.equal(events[1].cacheObservation.comparison.state, COMPARISON_STATE.MODEL_CHANGE);
    assert.equal(events[2].cacheObservation.comparison.state, COMPARISON_STATE.COMPACTION_BOUNDARY);
    assert.equal(events[3].cacheObservation.comparison.previousEventId, events[2].id);
    assert.equal(events[3].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  });
});

test('model evidence is raw-ordered, token-local wins for itself, and unknown does not block', () => {
  const raws = [
    raw('a', { payloadType: 'token_count' }),
    raw('session-model', { recordType: 'event_msg', payloadType: 'session_configured' }),
    raw('b', { payloadType: 'token_count' }),
    raw('late-model', { recordType: 'turn_context' }),
  ];
  const events = [tokenEvent('a', 0), tokenEvent('b', 1)];
  finalizeCodexCacheObservation(directSession(raws, events), [
    tokenSeed('a', validHigh()),
    modelSeed('session-model', 'model-a'),
    tokenSeed('b', validDrop(), { model: 'model-a' }),
    modelSeed('late-model', 'must-not-backfill'),
  ]);
  assert.equal(events[1].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);

  const changedRaws = [
    raw('model-first', { recordType: 'session_meta' }),
    raw('first', { payloadType: 'token_count' }),
    raw('second', { payloadType: 'token_count' }),
  ];
  const changedEvents = [tokenEvent('first', 0), tokenEvent('second', 1)];
  finalizeCodexCacheObservation(directSession(changedRaws, changedEvents), [
    modelSeed('model-first', 'model-a'),
    tokenSeed('first', validHigh()),
    tokenSeed('second', validDrop(), { model: 'model-b' }),
  ]);
  assert.equal(changedEvents[1].cacheObservation.comparison.state, COMPARISON_STATE.MODEL_CHANGE);
});

test('raw-order ownership covers explicit, implicit mirrors, trailing, context, compaction, and rollback', () => {
  const raws = [
    raw('implicit-response', { recordType: 'response_item', payloadType: 'message', role: 'user', messageText: 'same user action' }),
    raw('implicit-event', { payloadType: 'user_message', messageText: 'same user action' }),
    raw('legacy-context', { recordType: 'turn_context', turnId: 'legacy-turn' }),
    raw('legacy-token', { payloadType: 'token_count' }),
    raw('complete', { payloadType: 'turn_complete', canonicalType: 'task_complete', turnId: 'legacy-turn' }),
    raw('trailing-token', { payloadType: 'token_count' }),
    raw('compact', { payloadType: 'context_compacted' }),
    raw('abort-trailing', { payloadType: 'token_count' }),
    raw('next-user', { payloadType: 'user_message', messageText: 'next action' }),
    raw('next-token', { payloadType: 'token_count' }),
    raw('rollback', { payloadType: 'thread_rolled_back' }),
    raw('ambiguous-turn-id', { payloadType: 'token_count', turnId: 'must-not-clear-rollback' }),
    raw('restart', { payloadType: 'task_started', canonicalType: 'task_started', turnId: 'restart-turn' }),
    raw('restart-token', { payloadType: 'token_count' }),
  ];
  const ownership = buildRawTurnOwnershipIndex(raws);
  const legacy = ownership.byRawId.get('legacy-token');
  assert.equal(legacy.turnOwnerKey, 'explicit:legacy-turn');
  assert.equal(legacy.evidenceTier, TURN_OWNERSHIP_EVIDENCE.LEGACY_TURN_CONTEXT);
  assert.equal(ownership.byRawId.get('trailing-token').isTrailing, true);
  assert.equal(ownership.byRawId.get('abort-trailing').turnOwnerKey, 'explicit:legacy-turn');
  assert.equal(ownership.byRawId.get('next-token').evidenceTier, TURN_OWNERSHIP_EVIDENCE.IMPLICIT_USER_TURN);
  assert.equal(ownership.byRawId.get('ambiguous-turn-id').turnOwnerKey, '');
  assert.equal(ownership.byRawId.get('ambiguous-turn-id').conflictReason, ATTRIBUTION_REASON.ROLLBACK_BOUNDARY);
  assert.equal(ownership.byRawId.get('restart-token').turnOwnerKey, 'explicit:restart-turn');
  assert.equal(ownership.byRawId.get('restart-token').evidenceTier, TURN_OWNERSHIP_EVIDENCE.EXPLICIT_LIFECYCLE);
});

test('task_started and turn_aborted aliases preserve explicit trailing ownership', () => {
  for (const startType of ['task_started', 'turn_started']) {
    const raws = [
      raw(`${startType}-start`, { payloadType: startType, canonicalType: 'task_started', turnId: `turn-${startType}` }),
      raw(`${startType}-token`, { payloadType: 'token_count' }),
      raw(`${startType}-abort`, { payloadType: 'turn_aborted' }),
      raw(`${startType}-trailing`, { payloadType: 'token_count' }),
    ];
    const ownership = buildRawTurnOwnershipIndex(raws);
    assert.equal(ownership.byRawId.get(`${startType}-token`).evidenceTier, TURN_OWNERSHIP_EVIDENCE.EXPLICIT_LIFECYCLE);
    assert.equal(ownership.byRawId.get(`${startType}-trailing`).isTrailing, true);
  }
});

test('canonical Raw turn IDs are lower-tier evidence and timestamps never invent owners', () => {
  const ownership = buildRawTurnOwnershipIndex([
    raw('timed-unknown', {
      recordType: 'response_item',
      payloadType: 'message',
      role: 'assistant',
      timestamp: '2026-09-02T00:00:00.000Z',
    }),
    raw('raw-turn-token', {
      payloadType: 'token_count',
      turnId: 'raw-only-turn',
      timestamp: '2026-09-02T00:00:00.001Z',
    }),
  ]);
  assert.equal(ownership.byRawId.get('timed-unknown').turnOwnerKey, '');
  assert.equal(
    ownership.byRawId.get('raw-turn-token').evidenceTier,
    TURN_OWNERSHIP_EVIDENCE.CANONICAL_RAW_TURN_ID,
  );
  assert.equal(
    ownership.byRawId.get('raw-turn-token').turnOwnerKey,
    'explicit:raw-only-turn',
  );
});

test('turn context and completion contradictions fail closed', () => {
  const context = buildRawTurnOwnershipIndex([
    raw('start', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'turn-a' }),
    raw('context', { recordType: 'turn_context', turnId: 'turn-b' }),
    raw('token', { payloadType: 'token_count' }),
  ]);
  assert.equal(context.byRawId.get('token').conflictReason, ATTRIBUTION_REASON.CONFLICTING_TURN_CONTEXT);

  const completion = buildRawTurnOwnershipIndex([
    raw('start', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'turn-a' }),
    raw('complete', { payloadType: 'turn_complete', canonicalType: 'task_complete', turnId: 'turn-b' }),
    raw('token', { payloadType: 'token_count' }),
  ]);
  assert.equal(completion.byRawId.get('token').conflictReason, ATTRIBUTION_REASON.CONFLICTING_TURN_COMPLETION);
});

test('event ownership accepts one known owner plus unknown and rejects genuine conflicts', () => {
  const ownership = buildRawTurnOwnershipIndex([
    raw('unknown', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
    raw('start-a', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'turn-a' }),
    raw('known-a', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
    raw('start-b', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'turn-b' }),
    raw('known-b', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
  ]);
  assert.equal(turnOwnershipForEvent({
    rawRefs: [{ rawId: 'unknown' }, { rawId: 'known-a' }],
  }, ownership).turnOwnerKey, 'explicit:turn-a');
  assert.equal(turnOwnershipForEvent({
    rawRefs: [{ rawId: 'known-a' }, { rawId: 'known-b' }],
  }, ownership).conflictReason, ATTRIBUTION_REASON.CONFLICTING_RAW_REF_OWNERS);
  assert.equal(turnOwnershipForEvent({ rawRefs: [{ rawId: 'unknown' }] }, ownership).turnOwnerKey, '');

  const explicit = turnOwnershipForEvent({
    turnId: 'turn-a',
    rawRefs: [{ rawId: 'known-a' }, { rawId: 'known-b' }],
  }, ownership);
  assert.equal(explicit.turnOwnerKey, 'explicit:turn-a');
  assert.equal(explicit.associationSource, 'canonical_turn_id');
});

test('Main anchoring chooses nearest preceding owner, uses Logical tie-break, and aggregates', () => {
  const raws = [
    raw('start', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'turn-a' }),
    raw('main-early', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
    raw('main-tie', { recordType: 'response_item', payloadType: 'function_call', role: 'assistant' }),
    raw('protocol-1', { payloadType: 'token_count' }),
    raw('protocol-2', { payloadType: 'token_count' }),
    raw('main-after', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
  ];
  const ownership = buildRawTurnOwnershipIndex(raws);
  const mainEarly = logicalEvent('main-early-event', 'main-early');
  const mainTieFirst = logicalEvent('main-tie-first', 'main-tie');
  const mainTieLast = logicalEvent('main-tie-last', 'main-tie');
  const mainAfter = logicalEvent('main-after-event', 'main-after');
  const first = tokenEvent('protocol-1', 1);
  const second = tokenEvent('protocol-2', 2);
  const projection = buildCacheDiscontinuityLinks({
    logicalEvents: [mainEarly, mainTieFirst, mainTieLast, first, second, mainAfter],
    rawEvents: raws,
    ownershipIndex: ownership,
    discontinuities: [first, second].map((event, logicalOrder) => ({
      event,
      logicalOrder: logicalOrder + 3,
      association: turnOwnershipForEvent(event, ownership, { preferExplicitTurnId: false }),
    })),
  });
  assert.deepEqual(
    projection.links.protocolEventIdsByMainEventId.get(mainTieLast.id),
    [first.id, second.id],
  );
  assert.equal(projection.links.mainEventIdByProtocolEventId.get(first.id), mainTieLast.id);
  assert.equal(projection.links.protocolEventIdsByMainEventId.has(mainAfter.id), false);
});

test('Main link fails closed without a preceding anchor or reliable owner', () => {
  const raws = [
    raw('protocol', { payloadType: 'token_count' }),
    raw('start', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'turn-a' }),
    raw('main-after', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
  ];
  const ownership = buildRawTurnOwnershipIndex(raws);
  const protocol = tokenEvent('protocol', 0);
  const projection = buildCacheDiscontinuityLinks({
    logicalEvents: [protocol, logicalEvent('main-after', 'main-after')],
    rawEvents: raws,
    ownershipIndex: ownership,
    discontinuities: [{
      event: protocol,
      logicalOrder: 0,
      association: turnOwnershipForEvent(protocol, ownership, { preferExplicitTurnId: false }),
    }],
  });
  assert.equal(projection.links.mainEventIdByProtocolEventId.size, 0);
  assert.ok(
    (projection.linkReasonCounts.get(ATTRIBUTION_REASON.UNKNOWN_OWNER) || 0) > 0,
  );
});

test('materialized fork reducer input excludes inherited cache/model/compaction/lifecycle evidence', () => {
  const raws = [
    raw('fork-meta', { recordType: 'session_meta' }),
    raw('inherited-start', { payloadType: 'turn_started', canonicalType: 'task_started', turnId: 'parent-turn' }),
    raw('inherited-model', { recordType: 'turn_context', turnId: 'parent-turn' }),
    raw('inherited-token-a', { payloadType: 'token_count' }),
    raw('inherited-compact', { payloadType: 'context_compacted' }),
    raw('inherited-token-b', { payloadType: 'token_count' }),
    raw('continuation-user', { payloadType: 'user_message', messageText: 'child turn' }),
    raw('continuation-main', { recordType: 'response_item', payloadType: 'message', role: 'assistant' }),
    raw('continuation-token-a', { payloadType: 'token_count' }),
    raw('continuation-token-b', { payloadType: 'token_count' }),
  ];
  const main = logicalEvent('continuation-main-event', 'continuation-main');
  const first = tokenEvent('continuation-token-a', 8);
  const second = tokenEvent('continuation-token-b', 9);
  const segments = new Map(raws.map((entry, index) => [
    entry.rawId,
    index === 0 ? 'fork_metadata' : index <= 5 ? 'inherited_context' : 'continuation',
  ]));
  const session = directSession(raws, [main, first, second], {
    forkStorageMode: 'materialized',
    _forkSegmentsByRawId: segments,
  });
  const summary = finalizeCodexCacheObservation(session, [
    modelSeed('fork-meta', 'child-model'),
    modelSeed('inherited-model', 'parent-model'),
    tokenSeed('inherited-token-a', validHigh()),
    tokenSeed('inherited-token-b', validDrop()),
    tokenSeed('continuation-token-a', validHigh()),
    tokenSeed('continuation-token-b', validDrop(), { model: 'child-model' }),
  ]);
  assert.equal(first.cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.equal(second.cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  assert.equal(summary.ownedRawCount, 5);
  assert.equal(summary.discontinuityOwnershipEvidenceCounts.explicit_lifecycle, 0);
  assert.equal(summary.discontinuityOwnershipEvidenceCounts.implicit_user_turn, 1);
  assert.deepEqual(
    session.presentationIndexes.cacheDiscontinuityLinks
      .protocolEventIdsByMainEventId.get(main.id),
    [second.id],
  );
  assert.equal(
    [...session.presentationIndexes.cacheDiscontinuityLinks.mainEventIdByProtocolEventId.keys()]
      .some((id) => id.includes('inherited')),
    false,
  );
});

async function makeSourceFixture(t, label) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), `session-analyzer-cache-${label}-`));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionRoot = path.join(codexHome, 'sessions', '2026', '09', '02');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  return { codexHome, repoRoot, sessionRoot };
}

async function writeRollout(sessionRoot, name, records) {
  const file = path.join(sessionRoot, `${name}.jsonl`);
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  return file;
}

function sourceRecords(id, repoRoot, fields = {}) {
  const turnId = fields.turnId || `turn-${id.slice(0, 4)}`;
  const base = Date.parse(fields.startedAt || '2026-09-02T10:00:00.000Z');
  const at = (offset) => new Date(base + offset).toISOString();
  return [
    {
      timestamp: at(0),
      type: 'session_meta',
      payload: { id, cwd: repoRoot, model: fields.model || 'model-a', ...(fields.meta || {}) },
    },
    {
      timestamp: at(1_000),
      type: 'event_msg',
      payload: { type: 'turn_started', turn_id: turnId },
    },
    {
      timestamp: at(2_000),
      type: 'event_msg',
      payload: { type: 'user_message', message: 'synthetic cache observation turn' },
    },
    {
      timestamp: at(3_000),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'synthetic Main context' }],
      },
    },
    {
      timestamp: at(4_000),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 16_384,
            cached_input_tokens: 16_384,
            output_tokens: 1_024,
            total_tokens: 17_408,
          },
          total_token_usage: {
            input_tokens: 99_999,
            cached_input_tokens: 99_999,
          },
        },
      },
    },
    {
      timestamp: at(64_000),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: {
          input_tokens: 12_288,
          cached_input_tokens: 8_192,
          output_tokens: 512,
          total_tokens: 12_800,
        } },
      },
    },
    {
      timestamp: at(65_000),
      type: 'event_msg',
      payload: { type: 'turn_complete', turn_id: turnId },
    },
  ];
}

const SOURCE_ID = '12121212-1212-4212-8212-121212121212';

test('source records materialize through cache facts, links, canonical validation, and resident parity', async (t) => {
  const fixture = await makeSourceFixture(t, 'source-parity');
  await writeRollout(
    fixture.sessionRoot,
    `rollout-${SOURCE_ID}`,
    sourceRecords(SOURCE_ID, fixture.repoRoot),
  );
  const options = { repoRoot: fixture.repoRoot, codexHome: fixture.codexHome };
  const baseResident = await codex.buildIndex(options);
  const resident = await codex.__testOnly.buildCacheObservationResidentOracleForTests(options);
  const indexEvents = [];
  const index = await runWithMaterializationObserver(
    (event) => indexEvents.push(event),
    () => codex.buildSourceBackedIndex(options),
  );
  const indexed = index.sessionsById.get(SOURCE_ID);
  assert.ok(indexed);
  assert.equal(Object.hasOwn(indexed, 'rawEvents'), false);
  assert.equal(Object.hasOwn(indexed, 'logicalEvents'), false);
  assert.equal(Object.hasOwn(indexed, 'presentationIndexes'), false);
  assert.equal(indexEvents.some((event) => event.phase.startsWith('codex_cache_')), false);

  const materializationEvents = [];
  const materialized = await materializeSessionForIndex(index, indexed, {
    onMaterializationPhase: (event) => materializationEvents.push(event),
  });
  const residentSession = resident.sessionsById.get(SOURCE_ID);
  const baseSession = baseResident.sessionsById.get(SOURCE_ID);
  assert.deepEqual(cacheProjection(materialized), cacheProjection(residentSession));
  assert.deepEqual(
    materialized.logicalEvents.map(semanticEventWithoutCache),
    baseSession.logicalEvents.map(semanticEventWithoutCache),
  );
  assert.deepEqual(
    materialized.rawEvents.map((event) => event.rawId),
    baseSession.rawEvents.map((event) => event.rawId),
  );
  const tokens = materialized.logicalEvents.filter((event) => event.subtype === 'token_count');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.equal(tokens[1].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  assert.equal(tokens[0].cacheObservation.inputTokens, 16_384);
  assert.equal(tokens[1].cacheObservation.cachedInputTokens, 8_192);
  assert.equal(Object.hasOwn(materialized, '_cacheObservationSeeds'), false);
  assert.equal(projectQueryProjectionDigest(materialized), indexed.queryProjectionDigest);
  const baseProjectQueryStore = buildProjectQueryStore([baseSession]);
  const enrichedProjectQueryStore = buildProjectQueryStore([materialized]);
  assert.equal(PROJECT_QUERY_STORE_SCHEMA_VERSION, 2);
  assert.equal(enrichedProjectQueryStore.accountedBytes, baseProjectQueryStore.accountedBytes);
  assert.deepEqual(enrichedProjectQueryStore, baseProjectQueryStore);
  assert.equal(
    materializationEvents.filter((event) => event.phase === 'codex_cache_seed_capture' && event.state === 'event').length,
    1,
  );
  assert.equal(
    materializationEvents.filter((event) => event.phase === 'codex_cache_finalization' && event.state === 'start').length,
    1,
  );
  assert.equal(
    materializationEvents.filter((event) => event.phase === 'codex_cache_owner_reduction' && event.state === 'start').length,
    1,
  );
  const summaryEvents = materializationEvents.filter((event) => (
    event.phase === 'codex_cache_finalization_summary' && event.state === 'event'
  ));
  assert.equal(summaryEvents.length, 1);
  const { phase: summaryPhase, state: summaryState, ...summary } = summaryEvents[0];
  assert.equal(summaryPhase, 'codex_cache_finalization_summary');
  assert.equal(summaryState, 'event');
  assert.deepEqual(Object.keys(summary).sort(), [
    'discontinuityCount',
    'discontinuityOwnershipEvidenceCounts',
    'invalidBarrierCount',
    'linkReasonCounts',
    'linkedDiscontinuityCount',
    'mainAssociationReasonCounts',
    'observationCount',
    'ownedRawCount',
    'producerReasonCounts',
    'seedCount',
    'tokenCount',
  ]);
  assert.equal(summary.discontinuityOwnershipEvidenceCounts.explicit_lifecycle, 1);
  assert.equal(summary.linkReasonCounts.mapped, 1);
  const encodedSummary = JSON.stringify(summaryEvents[0]);
  for (const forbidden of [SOURCE_ID, fixture.repoRoot, 'model-a', 'synthetic Main context']) {
    assert.equal(encodedSummary.includes(forbidden), false);
  }
  assert.equal(
    materializationEvents.filter((event) => event.phase === 'adapter_source_stream' && event.state === 'start').length,
    1,
  );
  assert.equal(
    materializationEvents.filter((event) => event.phase === 'adapter_source_verification_read' && event.state === 'start').length,
    1,
  );

  const beforeTokens = baseSession.logicalEvents.filter((event) => event.subtype === 'token_count');
  for (let indexValue = 0; indexValue < tokens.length; indexValue += 1) {
    for (const field of ['id', 'kind', 'subtype', 'layer', 'label', 'preview', 'searchText']) {
      assert.deepEqual(tokens[indexValue][field], beforeTokens[indexValue][field], field);
    }
    assert.deepEqual(tokens[indexValue].rawRefs, beforeTokens[indexValue].rawRefs);
  }
});

test('source-backed owner coalesces enriched materialization and warm hits rerun nothing', async (t) => {
  const fixture = await makeSourceFixture(t, 'owner-reuse');
  await writeRollout(
    fixture.sessionRoot,
    `rollout-${SOURCE_ID}`,
    sourceRecords(SOURCE_ID, fixture.repoRoot),
  );
  const index = await codex.buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  const indexed = index.sessionsById.get(SOURCE_ID);
  const retirementController = new AbortController();
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision: 1,
    retirementController,
    scheduler: createMaterializationScheduler({ warn() {} }),
  });
  const events = [];
  let calls = 0;
  const materialize = ({ signal }) => {
    calls += 1;
    return materializeSessionForIndex(index, indexed, {
      signal,
      onMaterializationPhase: (event) => events.push(event),
    });
  };
  const [first, second] = await Promise.all([
    owner.get(indexed, null, materialize),
    owner.get(indexed, null, materialize),
  ]);
  assert.equal(first, second);
  assert.equal(calls, 1);
  const phaseCount = events.length;
  assert.equal(await owner.get(indexed, null, materialize), first);
  assert.equal(calls, 1);
  assert.equal(events.length, phaseCount);
  const stats = owner.stats();
  assert.equal(stats.coalesced, 1);
  assert.equal(stats.hits, 1);
  assert.equal(stats.cacheSessionCount, 1);
  assert.equal(stats.peakEstimatedMaterializedBytes, estimateMaterializedSessionBytes(indexed));
  assert.equal(
    events.filter((event) => event.phase === 'codex_cache_finalization' && event.state === 'start').length,
    1,
  );
  const retirement = new Error('test retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
});

test('weighted eviction rematerializes an enriched Session through the same owner path', async (t) => {
  const fixture = await makeSourceFixture(t, 'owner-eviction');
  const secondId = '23232323-2323-4232-8232-232323232323';
  await writeRollout(
    fixture.sessionRoot,
    `00-rollout-${SOURCE_ID}`,
    sourceRecords(SOURCE_ID, fixture.repoRoot),
  );
  await writeRollout(
    fixture.sessionRoot,
    `01-rollout-${secondId}`,
    sourceRecords(secondId, fixture.repoRoot, {
      startedAt: '2026-09-02T11:00:00.000Z',
      turnId: 'second-turn',
    }),
  );
  const index = await codex.buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  const firstIndexed = index.sessionsById.get(SOURCE_ID);
  const secondIndexed = index.sessionsById.get(secondId);
  const retirementController = new AbortController();
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision: 1,
    retirementController,
    scheduler: createMaterializationScheduler({ warn() {} }),
    maxCachedSessions: 1,
  });
  const events = [];
  let calls = 0;
  const open = (indexed) => owner.get(indexed, null, ({ signal }) => {
    calls += 1;
    return materializeSessionForIndex(index, indexed, {
      signal,
      onMaterializationPhase: (event) => events.push(event),
    });
  });

  const first = await open(firstIndexed);
  await open(secondIndexed);
  const rematerializedFirst = await open(firstIndexed);
  assert.notEqual(rematerializedFirst, first);
  assert.equal(calls, 3);
  assert.equal(owner.stats().cacheSessionCount, 1);
  assert.equal(owner.stats().evictions, 2);
  assert.equal(
    events.filter((event) => event.phase === 'codex_cache_seed_capture' && event.state === 'event').length,
    3,
  );
  assert.equal(
    events.filter((event) => event.phase === 'codex_cache_finalization' && event.state === 'start').length,
    3,
  );
  const retirement = new Error('test retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
});

test('cancelled enrichment is not admitted and a later request materializes cleanly', async (t) => {
  const fixture = await makeSourceFixture(t, 'owner-cancellation');
  await writeRollout(
    fixture.sessionRoot,
    `rollout-${SOURCE_ID}`,
    sourceRecords(SOURCE_ID, fixture.repoRoot),
  );
  const index = await codex.buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  const indexed = index.sessionsById.get(SOURCE_ID);
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision: 1,
    retirementController,
    scheduler,
  });
  const cancelledEvents = [];
  const waiterController = new AbortController();
  await assert.rejects(
    owner.get(indexed, waiterController.signal, ({ signal }) => (
      materializeSessionForIndex(index, indexed, {
        signal,
        onMaterializationPhase(event) {
          cancelledEvents.push(event);
          if (event.phase === 'adapter_source_stream' && event.state === 'start') {
            waiterController.abort();
          }
        },
      })
    )),
    { name: 'AbortError' },
  );
  await scheduler.whenIdle();
  assert.equal(owner.stats().cacheSessionCount, 0);
  assert.equal(
    cancelledEvents.filter((event) => event.phase === 'codex_cache_finalization' && event.state === 'start').length,
    0,
  );

  const retryEvents = [];
  const materialized = await owner.get(indexed, null, ({ signal }) => (
    materializeSessionForIndex(index, indexed, {
      signal,
      onMaterializationPhase: (event) => retryEvents.push(event),
    })
  ));
  assert.ok(materialized.logicalEvents.some((event) => event.cacheObservation));
  assert.equal(owner.stats().cacheSessionCount, 1);
  assert.equal(
    retryEvents.filter((event) => event.phase === 'codex_cache_finalization' && event.state === 'start').length,
    1,
  );
  const retirement = new Error('test retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
});

test('revision retirement cannot reuse an enriched Session in a replacement owner', async (t) => {
  const fixture = await makeSourceFixture(t, 'owner-revision');
  const firstRecords = sourceRecords(SOURCE_ID, fixture.repoRoot);
  await writeRollout(fixture.sessionRoot, `rollout-${SOURCE_ID}`, firstRecords);
  const options = { repoRoot: fixture.repoRoot, codexHome: fixture.codexHome };
  const firstIndex = await codex.buildSourceBackedIndex(options);
  const firstIndexed = firstIndex.sessionsById.get(SOURCE_ID);
  const firstRetirementController = new AbortController();
  const firstOwner = createMaterializedSessionOwner({
    index: firstIndex,
    indexRevision: 1,
    retirementController: firstRetirementController,
    scheduler: createMaterializationScheduler({ warn() {} }),
  });
  const firstMaterialized = await firstOwner.get(firstIndexed, null, ({ signal }) => (
    materializeSessionForIndex(firstIndex, firstIndexed, { signal })
  ));

  const replacementRecords = structuredClone(firstRecords);
  replacementRecords.splice(-1, 0, {
    timestamp: '2026-09-02T10:01:04.500Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'synthetic replacement revision' },
  });
  await writeRollout(fixture.sessionRoot, `rollout-${SOURCE_ID}`, replacementRecords);
  const replacementIndex = await codex.buildSourceBackedIndex(options);
  const replacementIndexed = replacementIndex.sessionsById.get(SOURCE_ID);
  const retirement = new Error('INDEX_REVISION_RETIRED');
  retirement.code = 'INDEX_REVISION_RETIRED';
  firstOwner.retire(retirement);
  firstRetirementController.abort(retirement);
  await assert.rejects(
    firstOwner.get(firstIndexed, null, async () => firstMaterialized),
    { code: 'INDEX_REVISION_RETIRED' },
  );

  const replacementRetirementController = new AbortController();
  const replacementOwner = createMaterializedSessionOwner({
    index: replacementIndex,
    indexRevision: 2,
    retirementController: replacementRetirementController,
    scheduler: createMaterializationScheduler({ warn() {} }),
  });
  await assert.rejects(
    replacementOwner.get(firstIndexed, null, async () => firstMaterialized),
    /exact Indexed Session/,
  );
  const replacementMaterialized = await replacementOwner.get(
    replacementIndexed,
    null,
    ({ signal }) => materializeSessionForIndex(replacementIndex, replacementIndexed, { signal }),
  );
  assert.notEqual(replacementMaterialized, firstMaterialized);
  assert.equal(
    replacementMaterialized.rawEvents.length,
    firstMaterialized.rawEvents.length + 1,
  );
  assert.ok(replacementMaterialized.logicalEvents.some((event) => event.cacheObservation));
  const replacementRetirement = new Error('test retirement');
  replacementOwner.retire(replacementRetirement);
  replacementRetirementController.abort(replacementRetirement);
});

test('source-backed materialized fork excludes inherited cache seeds before reduction', async (t) => {
  const fixture = await makeSourceFixture(t, 'fork-exclusion');
  const parentId = '34343434-3434-4434-8434-343434343434';
  const childId = '56565656-5656-4656-8656-565656565656';
  const parentRecords = sourceRecords(parentId, fixture.repoRoot, {
    turnId: 'parent-turn',
    model: 'parent-model',
  });
  await writeRollout(fixture.sessionRoot, `00-parent-${parentId}`, parentRecords);
  const childContinuation = sourceRecords(childId, fixture.repoRoot, {
    turnId: 'child-turn',
    model: 'child-model',
    startedAt: '2026-09-02T11:00:00.000Z',
  }).slice(1);
  const childRecords = [
    {
      timestamp: '2026-09-02T11:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: childId,
        cwd: fixture.repoRoot,
        model: 'child-model',
        forked_from_id: parentId,
      },
    },
    ...structuredClone(parentRecords),
    ...childContinuation,
  ];
  await writeRollout(fixture.sessionRoot, `01-child-${childId}`, childRecords);
  const options = { repoRoot: fixture.repoRoot, codexHome: fixture.codexHome };
  const index = await codex.buildSourceBackedIndex(options);
  const indexedChild = index.sessionsById.get(childId);
  assert.equal(indexedChild.forkStorageMode, 'materialized');
  const materialized = await materializeSessionForIndex(index, indexedChild);
  const resident = await codex.__testOnly.buildCacheObservationResidentOracleForTests(options);
  assert.deepEqual(cacheProjection(materialized), cacheProjection(resident.sessionsById.get(childId)));
  const tokens = materialized.logicalEvents.filter((event) => event.subtype === 'token_count');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.equal(tokens[1].cacheObservation.comparison.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  const inheritedRawIds = new Set(materialized.rawEvents
    .filter((event) => materialized._forkSegmentsByRawId.get(event.rawId) === 'inherited_context')
    .map((event) => event.rawId));
  assert.equal(tokens.some((event) => event.rawRefs.some((ref) => inheritedRawIds.has(ref.rawId))), false);
  assert.equal(
    [...materialized.presentationIndexes.cacheDiscontinuityLinks.mainEventIdByProtocolEventId]
      .some(([protocolId, mainId]) => protocolId.includes(parentId) || mainId.includes(parentId)),
    false,
  );
});
