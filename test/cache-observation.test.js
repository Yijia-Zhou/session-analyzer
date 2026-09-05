'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CACHE_DISCONTINUITY_POLICY_V1,
  COMPARISON_STATE,
  NORMALIZATION_REASON_CODE,
  POLICY_GATE_REASON_CODE,
  POLICY_GATE_REASON_CODE_ORDER,
  cacheDiscontinuityReasonCodes,
  compareAdjacentCacheObservations,
  createCacheObservation,
  createEmptyCacheDiscontinuityLinks,
  inputDeltaBasisPoints,
  inputDeltaTokens,
  isCacheDiscontinuity,
  normalizeCacheObservationCandidate,
  reuseBasisPoints,
} = require('../src/cache-observation');

function candidate(inputTokens, cachedInputTokens, fields = {}) {
  return { inputTokens, cachedInputTokens, ...fields };
}

function normalized(inputTokens, cachedInputTokens, fields = {}) {
  const result = normalizeCacheObservationCandidate(candidate(inputTokens, cachedInputTokens, fields));
  assert.deepEqual(result.reasonCodes, []);
  return result.observation;
}

function comparison(previous, current, context = {}) {
  return compareAdjacentCacheObservations(previous, current, {
    previousEventId: 'previous-event',
    previousTimestamp: '2026-08-30T00:00:00.000Z',
    currentTimestamp: '2026-08-30T00:01:00.000Z',
    previousCompactionGeneration: 0,
    currentCompactionGeneration: 0,
    ...context,
  });
}

test('normalization preserves explicit cached zero and distinguishes missing required fields', () => {
  assert.deepEqual(normalizeCacheObservationCandidate(candidate(10_000, 0)), {
    observation: {
      inputTokens: 10_000,
      cachedInputTokens: 0,
      uncachedInputTokens: 10_000,
      outputTokens: null,
      totalTokens: null,
      reuseBasisPoints: 0,
    },
    reasonCodes: [],
  });
  assert.deepEqual(normalizeCacheObservationCandidate({ inputTokens: 10_000 }), {
    observation: null,
    reasonCodes: [NORMALIZATION_REASON_CODE.MISSING_CACHED_INPUT_TOKENS],
  });
  assert.deepEqual(normalizeCacheObservationCandidate({}), {
    observation: null,
    reasonCodes: [
      NORMALIZATION_REASON_CODE.MISSING_INPUT_TOKENS,
      NORMALIZATION_REASON_CODE.MISSING_CACHED_INPUT_TOKENS,
    ],
  });
});

test('normalization rejects malformed required accounting in deterministic order', () => {
  for (const invalid of [-1, 1.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(normalizeCacheObservationCandidate(candidate(invalid, invalid)), {
      observation: null,
      reasonCodes: [
        NORMALIZATION_REASON_CODE.INVALID_INPUT_TOKENS,
        NORMALIZATION_REASON_CODE.INVALID_CACHED_INPUT_TOKENS,
      ],
    });
  }
  assert.deepEqual(normalizeCacheObservationCandidate(candidate(10, 11)), {
    observation: null,
    reasonCodes: [NORMALIZATION_REASON_CODE.CACHED_INPUT_EXCEEDS_INPUT],
  });
});

test('malformed optional display fields independently degrade to null', () => {
  for (const invalid of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(normalizeCacheObservationCandidate(candidate(100, 50, {
      outputTokens: invalid,
      totalTokens: invalid,
    })), {
      observation: {
        inputTokens: 100,
        cachedInputTokens: 50,
        uncachedInputTokens: 50,
        outputTokens: null,
        totalTokens: null,
        reuseBasisPoints: 5_000,
      },
      reasonCodes: [],
    });
  }
});

test('zero over zero is valid with an unavailable reuse ratio', () => {
  assert.deepEqual(normalized(0, 0), {
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: null,
    totalTokens: null,
    reuseBasisPoints: null,
  });
  assert.equal(reuseBasisPoints(0, 0), null);
});

test('reuse basis points use exact BigInt floor arithmetic at safe-number extremes', () => {
  assert.equal(reuseBasisPoints(3, 2), 6_666);
  assert.equal(reuseBasisPoints(20_000, 14_999), 7_499);
  assert.equal(reuseBasisPoints(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), 10_000);
});

test('input deltas use exact absolute arithmetic and BigInt truncation toward zero', () => {
  assert.equal(inputDeltaTokens(20_000, 15_000), -5_000);
  assert.equal(inputDeltaTokens(15_000, 20_000), 5_000);
  assert.equal(inputDeltaBasisPoints(20_000, 15_000), -2_500);
  assert.equal(inputDeltaBasisPoints(3, 2), -3_333);
  assert.equal(inputDeltaBasisPoints(3, 4), 3_333);
  assert.equal(inputDeltaBasisPoints(0, 4), null);
  assert.equal(inputDeltaBasisPoints(1, Number.MAX_SAFE_INTEGER), null);
});

test('cache discontinuity policy constants freeze the prototype thresholds', () => {
  assert.deepEqual(CACHE_DISCONTINUITY_POLICY_V1, {
    minimumPreviousCacheReadTokens: 8_192,
    minimumPreviousReuseBasisPoints: 7_500,
    minimumCurrentInputNumerator: 3,
    minimumCurrentInputDenominator: 4,
    maximumCurrentCacheReadNumerator: 1,
    maximumCurrentCacheReadDenominator: 2,
    minimumCacheReadDropTokens: 8_192,
  });
});

test('each policy gate accepts equality and rejects one unit outside', () => {
  const cases = [
    [normalized(8_192, 8_192), normalized(6_144, 0), []],
    [normalized(8_191, 8_191), normalized(6_144, 0), [
      POLICY_GATE_REASON_CODE.PREVIOUS_CACHE_READ_BELOW_MINIMUM,
      POLICY_GATE_REASON_CODE.CACHE_READ_DROP_BELOW_MINIMUM,
    ]],
    [normalized(16_384, 12_288), normalized(12_288, 4_096), []],
    [normalized(20_000, 14_999), normalized(15_000, 0), [
      POLICY_GATE_REASON_CODE.PREVIOUS_REUSE_BELOW_MINIMUM,
    ]],
    [normalized(16_384, 16_384), normalized(12_288, 0), []],
    [normalized(16_384, 16_384), normalized(12_287, 0), [
      POLICY_GATE_REASON_CODE.CURRENT_INPUT_BELOW_COMPARABLE_FLOOR,
    ]],
    [normalized(32_768, 32_768), normalized(24_576, 16_384), []],
    [normalized(32_768, 32_768), normalized(24_576, 16_385), [
      POLICY_GATE_REASON_CODE.CURRENT_CACHE_READ_ABOVE_HALF,
    ]],
    [normalized(12_000, 12_000), normalized(9_000, 3_808), []],
    [normalized(12_000, 12_000), normalized(9_000, 3_809), [
      POLICY_GATE_REASON_CODE.CACHE_READ_DROP_BELOW_MINIMUM,
    ]],
  ];
  for (const [previous, current, expectedReasons] of cases) {
    assert.deepEqual(cacheDiscontinuityReasonCodes(previous, current), expectedReasons);
    assert.equal(isCacheDiscontinuity(previous, current), expectedReasons.length === 0);
  }
});

test('policy cross multiplication stays exact at safe-number extremes', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const comparableFloor = Number((BigInt(maximum) * 3n + 3n) / 4n);
  const previous = normalized(maximum, maximum);
  assert.equal(isCacheDiscontinuity(previous, normalized(comparableFloor, 0)), true);
  assert.equal(isCacheDiscontinuity(previous, normalized(comparableFloor - 1, 0)), false);
});

test('multiple failed policy gates keep the frozen deterministic reason order', () => {
  const reasons = cacheDiscontinuityReasonCodes(
    normalized(10_000, 7_000),
    normalized(7_000, 4_000),
  );
  assert.deepEqual(reasons, POLICY_GATE_REASON_CODE_ORDER);
  assert.deepEqual(reasons, [
    POLICY_GATE_REASON_CODE.PREVIOUS_CACHE_READ_BELOW_MINIMUM,
    POLICY_GATE_REASON_CODE.PREVIOUS_REUSE_BELOW_MINIMUM,
    POLICY_GATE_REASON_CODE.CURRENT_INPUT_BELOW_COMPARABLE_FLOOR,
    POLICY_GATE_REASON_CODE.CURRENT_CACHE_READ_ABOVE_HALF,
    POLICY_GATE_REASON_CODE.CACHE_READ_DROP_BELOW_MINIMUM,
  ]);
});

test('first observation has no previous context or redundant discontinuity boolean', () => {
  const result = createCacheObservation(candidate(1_000, 500), null);
  assert.equal(result.cacheObservation.schemaVersion, 1);
  assert.equal(result.cacheObservation.comparison.state, COMPARISON_STATE.NO_PREVIOUS_OBSERVATION);
  assert.deepEqual(result.cacheObservation.comparison.reasonCodes, []);
  assert.equal(result.cacheObservation.comparison.previousEventId, null);
  assert.equal(Object.hasOwn(result.cacheObservation, 'isDiscontinuity'), false);
});

test('unknown and non-monotonic timestamps exclude an otherwise qualifying edge', () => {
  const previous = normalized(16_384, 16_384);
  const current = normalized(12_288, 8_192);
  for (const timestamps of [
    { previousTimestamp: '', currentTimestamp: '2026-08-30T00:01:00.000Z' },
    {
      previousTimestamp: '2026-08-30T00:01:00.000Z',
      currentTimestamp: '2026-08-30T00:00:00.000Z',
    },
  ]) {
    const result = comparison(previous, current, timestamps);
    assert.equal(result.state, COMPARISON_STATE.UNKNOWN_OR_NON_MONOTONIC_TIMESTAMP);
    assert.equal(result.elapsedMs, null);
    assert.deepEqual(result.reasonCodes, []);
  }
});

test('an unsafe timestamp delta is excluded instead of leaking an unsafe elapsed value', () => {
  const result = comparison(
    normalized(16_384, 16_384),
    normalized(12_288, 8_192),
    {
      previousTimestamp: '-271821-04-20T00:00:00.000Z',
      currentTimestamp: '+275760-09-13T00:00:00.000Z',
    },
  );
  assert.equal(result.state, COMPARISON_STATE.UNKNOWN_OR_NON_MONOTONIC_TIMESTAMP);
  assert.equal(result.elapsedMs, null);
});

test('model comparison excludes only two known different models', () => {
  const previous = normalized(16_384, 16_384);
  const current = normalized(12_288, 8_192);
  assert.equal(comparison(previous, current, {
    previousModel: 'gpt-5',
    currentModel: 'gpt-5.1',
  }).state, COMPARISON_STATE.MODEL_CHANGE);
  assert.equal(comparison(previous, current, {
    previousModel: 'gpt-5',
    currentModel: 'gpt-5',
  }).state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  assert.equal(comparison(previous, current, {
    previousModel: 'gpt-5',
    currentModel: '',
  }).state, COMPARISON_STATE.CACHE_DISCONTINUITY);
});

test('compaction boundary excludes one edge without duplicating its state as a reason', () => {
  const result = comparison(
    normalized(16_384, 16_384),
    normalized(12_288, 8_192),
    { previousCompactionGeneration: 0, currentCompactionGeneration: 1 },
  );
  assert.equal(result.state, COMPARISON_STATE.COMPACTION_BOUNDARY);
  assert.deepEqual(result.reasonCodes, []);
});

test('comparable pairs expose only ordered failed policy gates', () => {
  const result = comparison(normalized(10_000, 7_000), normalized(9_000, 6_000));
  assert.equal(result.state, COMPARISON_STATE.COMPARABLE);
  assert.deepEqual(result.reasonCodes, [
    POLICY_GATE_REASON_CODE.PREVIOUS_CACHE_READ_BELOW_MINIMUM,
    POLICY_GATE_REASON_CODE.PREVIOUS_REUSE_BELOW_MINIMUM,
    POLICY_GATE_REASON_CODE.CURRENT_CACHE_READ_ABOVE_HALF,
    POLICY_GATE_REASON_CODE.CACHE_READ_DROP_BELOW_MINIMUM,
  ]);
});

test('all-pass pairs use cache_discontinuity as the sole truth', () => {
  const result = comparison(normalized(16_384, 16_384), normalized(12_288, 8_192));
  assert.equal(result.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  assert.deepEqual(result.reasonCodes, []);
});

test('short and long elapsed intervals classify the same token pair identically', () => {
  const previous = normalized(16_384, 16_384);
  const current = normalized(12_288, 8_192);
  const start = Date.parse('2026-08-30T00:00:00.000Z');
  for (const elapsedMs of [14_000, 8 * 60 * 60 * 1_000]) {
    const result = comparison(previous, current, {
      previousTimestamp: new Date(start).toISOString(),
      currentTimestamp: new Date(start + elapsedMs).toISOString(),
    });
    assert.equal(result.elapsedMs, elapsedMs);
    assert.equal(result.state, COMPARISON_STATE.CACHE_DISCONTINUITY);
  }
});

test('comparison context uses exact previous/current deltas and reuse values', () => {
  const result = comparison(normalized(20_000, 16_000), normalized(15_000, 7_000));
  assert.deepEqual(result, {
    state: COMPARISON_STATE.CACHE_DISCONTINUITY,
    reasonCodes: [],
    previousEventId: 'previous-event',
    elapsedMs: 60_000,
    previousInputTokens: 20_000,
    inputDeltaTokens: -5_000,
    inputDeltaBasisPoints: -2_500,
    previousCachedInputTokens: 16_000,
    cachedInputDeltaTokens: -9_000,
    previousReuseBasisPoints: 8_000,
  });
});

test('empty cache discontinuity links use the exact independent Map shape', () => {
  const links = createEmptyCacheDiscontinuityLinks();
  assert.deepEqual(Object.keys(links), [
    'protocolEventIdsByMainEventId',
    'mainEventIdByProtocolEventId',
  ]);
  assert.ok(links.protocolEventIdsByMainEventId instanceof Map);
  assert.ok(links.mainEventIdByProtocolEventId instanceof Map);
  assert.notEqual(links.protocolEventIdsByMainEventId, links.mainEventIdByProtocolEventId);
});
