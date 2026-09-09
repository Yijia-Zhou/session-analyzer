'use strict';

const CACHE_OBSERVATION_SCHEMA_VERSION = 1;

const CACHE_DISCONTINUITY_POLICY_V1 = Object.freeze({
  minimumPreviousCacheReadTokens: 8_192,
  minimumPreviousReuseBasisPoints: 7_500,
  minimumCurrentInputNumerator: 3,
  minimumCurrentInputDenominator: 4,
  maximumCurrentCacheReadNumerator: 1,
  maximumCurrentCacheReadDenominator: 2,
  minimumCacheReadDropTokens: 8_192,
});

const COMPARISON_STATE = Object.freeze({
  NO_PREVIOUS_OBSERVATION: 'no_previous_observation',
  UNKNOWN_OR_NON_MONOTONIC_TIMESTAMP: 'unknown_or_non_monotonic_timestamp',
  MODEL_CHANGE: 'model_change',
  COMPACTION_BOUNDARY: 'compaction_boundary',
  COMPARABLE: 'comparable',
  CACHE_DISCONTINUITY: 'cache_discontinuity',
});

const PUBLIC_COMPARISON_STATES = Object.freeze([
  COMPARISON_STATE.NO_PREVIOUS_OBSERVATION,
  COMPARISON_STATE.UNKNOWN_OR_NON_MONOTONIC_TIMESTAMP,
  COMPARISON_STATE.MODEL_CHANGE,
  COMPARISON_STATE.COMPACTION_BOUNDARY,
  COMPARISON_STATE.COMPARABLE,
  COMPARISON_STATE.CACHE_DISCONTINUITY,
]);
const publicComparisonStateSet = new Set(PUBLIC_COMPARISON_STATES);

const POLICY_GATE_REASON_CODE = Object.freeze({
  PREVIOUS_CACHE_READ_BELOW_MINIMUM: 'previous_cache_read_below_minimum',
  PREVIOUS_REUSE_BELOW_MINIMUM: 'previous_reuse_below_minimum',
  CURRENT_INPUT_BELOW_COMPARABLE_FLOOR: 'current_input_below_comparable_floor',
  CURRENT_CACHE_READ_ABOVE_HALF: 'current_cache_read_above_half',
  CACHE_READ_DROP_BELOW_MINIMUM: 'cache_read_drop_below_minimum',
});

const POLICY_GATE_REASON_CODE_ORDER = Object.freeze([
  POLICY_GATE_REASON_CODE.PREVIOUS_CACHE_READ_BELOW_MINIMUM,
  POLICY_GATE_REASON_CODE.PREVIOUS_REUSE_BELOW_MINIMUM,
  POLICY_GATE_REASON_CODE.CURRENT_INPUT_BELOW_COMPARABLE_FLOOR,
  POLICY_GATE_REASON_CODE.CURRENT_CACHE_READ_ABOVE_HALF,
  POLICY_GATE_REASON_CODE.CACHE_READ_DROP_BELOW_MINIMUM,
]);
const policyGateReasonCodeSet = new Set(POLICY_GATE_REASON_CODE_ORDER);
const policyGateReasonCodeArrays = new Array(1 << POLICY_GATE_REASON_CODE_ORDER.length);
policyGateReasonCodeArrays[0] = Object.freeze([]);
const POLICY_BIGINT = Object.freeze({
  minimumCurrentInputNumerator: BigInt(
    CACHE_DISCONTINUITY_POLICY_V1.minimumCurrentInputNumerator,
  ),
  minimumCurrentInputDenominator: BigInt(
    CACHE_DISCONTINUITY_POLICY_V1.minimumCurrentInputDenominator,
  ),
  maximumCurrentCacheReadNumerator: BigInt(
    CACHE_DISCONTINUITY_POLICY_V1.maximumCurrentCacheReadNumerator,
  ),
  maximumCurrentCacheReadDenominator: BigInt(
    CACHE_DISCONTINUITY_POLICY_V1.maximumCurrentCacheReadDenominator,
  ),
  minimumCacheReadDropTokens: BigInt(
    CACHE_DISCONTINUITY_POLICY_V1.minimumCacheReadDropTokens,
  ),
});

const NORMALIZATION_REASON_CODE = Object.freeze({
  MISSING_INPUT_TOKENS: 'missing_input_tokens',
  INVALID_INPUT_TOKENS: 'invalid_input_tokens',
  MISSING_CACHED_INPUT_TOKENS: 'missing_cached_input_tokens',
  INVALID_CACHED_INPUT_TOKENS: 'invalid_cached_input_tokens',
  CACHED_INPUT_EXCEEDS_INPUT: 'cached_input_exceeds_input',
});

const NORMALIZATION_REASON_CODE_ORDER = Object.freeze([
  NORMALIZATION_REASON_CODE.MISSING_INPUT_TOKENS,
  NORMALIZATION_REASON_CODE.INVALID_INPUT_TOKENS,
  NORMALIZATION_REASON_CODE.MISSING_CACHED_INPUT_TOKENS,
  NORMALIZATION_REASON_CODE.INVALID_CACHED_INPUT_TOKENS,
  NORMALIZATION_REASON_CODE.CACHED_INPUT_EXCEEDS_INPUT,
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function reuseBasisPoints(inputTokens, cachedInputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0
      || !isNonNegativeSafeInteger(cachedInputTokens)) return null;
  const result = (BigInt(cachedInputTokens) * 10_000n) / BigInt(inputTokens);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

function inputDeltaTokens(previousInputTokens, currentInputTokens) {
  if (!isNonNegativeSafeInteger(previousInputTokens)
      || !isNonNegativeSafeInteger(currentInputTokens)) return null;
  const result = currentInputTokens - previousInputTokens;
  return Number.isSafeInteger(result) ? result : null;
}

function inputDeltaBasisPoints(previousInputTokens, currentInputTokens) {
  if (!Number.isSafeInteger(previousInputTokens) || previousInputTokens <= 0
      || !isNonNegativeSafeInteger(currentInputTokens)) return null;
  const result = (
    (BigInt(currentInputTokens) - BigInt(previousInputTokens)) * 10_000n
  ) / BigInt(previousInputTokens);
  return result >= BigInt(Number.MIN_SAFE_INTEGER) && result <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(result)
    : null;
}

function cachedInputDeltaTokens(previousCachedInputTokens, currentCachedInputTokens) {
  if (!isNonNegativeSafeInteger(previousCachedInputTokens)
      || !isNonNegativeSafeInteger(currentCachedInputTokens)) return null;
  const result = currentCachedInputTokens - previousCachedInputTokens;
  return Number.isSafeInteger(result) ? result : null;
}

function optionalTokenValue(candidate, field) {
  if (!isRecord(candidate) || !Object.hasOwn(candidate, field)) return null;
  return isNonNegativeSafeInteger(candidate[field]) ? candidate[field] : null;
}

function normalizeCacheObservationCandidate(candidate) {
  const source = isRecord(candidate) ? candidate : null;
  const reasonCodes = [];
  const hasInput = Boolean(source && Object.hasOwn(source, 'inputTokens'));
  const hasCachedInput = Boolean(source && Object.hasOwn(source, 'cachedInputTokens'));
  const inputTokens = hasInput && isNonNegativeSafeInteger(source.inputTokens)
    ? source.inputTokens
    : null;
  const cachedInputTokens = hasCachedInput && isNonNegativeSafeInteger(source.cachedInputTokens)
    ? source.cachedInputTokens
    : null;

  if (!hasInput) reasonCodes.push(NORMALIZATION_REASON_CODE.MISSING_INPUT_TOKENS);
  else if (inputTokens === null) reasonCodes.push(NORMALIZATION_REASON_CODE.INVALID_INPUT_TOKENS);
  if (!hasCachedInput) reasonCodes.push(NORMALIZATION_REASON_CODE.MISSING_CACHED_INPUT_TOKENS);
  else if (cachedInputTokens === null) {
    reasonCodes.push(NORMALIZATION_REASON_CODE.INVALID_CACHED_INPUT_TOKENS);
  }
  if (inputTokens !== null
      && cachedInputTokens !== null
      && cachedInputTokens > inputTokens) {
    reasonCodes.push(NORMALIZATION_REASON_CODE.CACHED_INPUT_EXCEEDS_INPUT);
  }
  if (reasonCodes.length) return { observation: null, reasonCodes };

  return {
    observation: {
      inputTokens,
      cachedInputTokens,
      uncachedInputTokens: inputTokens - cachedInputTokens,
      outputTokens: optionalTokenValue(source, 'outputTokens'),
      totalTokens: optionalTokenValue(source, 'totalTokens'),
      reuseBasisPoints: reuseBasisPoints(inputTokens, cachedInputTokens),
    },
    reasonCodes: [],
  };
}

function isNormalizedCacheObservation(value) {
  if (!isRecord(value)
      || !isNonNegativeSafeInteger(value.inputTokens)
      || !isNonNegativeSafeInteger(value.cachedInputTokens)
      || value.cachedInputTokens > value.inputTokens
      || value.uncachedInputTokens !== value.inputTokens - value.cachedInputTokens
      || (value.outputTokens !== null && !isNonNegativeSafeInteger(value.outputTokens))
      || (value.totalTokens !== null && !isNonNegativeSafeInteger(value.totalTokens))) return false;
  return value.reuseBasisPoints === reuseBasisPoints(value.inputTokens, value.cachedInputTokens);
}

function requireNormalizedObservation(value, owner) {
  if (!isNormalizedCacheObservation(value)) {
    throw new TypeError(`${owner} must be a normalized cache observation`);
  }
  return value;
}

function cacheDiscontinuityReasonCodesForValidatedObservations(previous, current) {
  const reasonCodes = [];
  let reasonMask = 0;
  const policy = CACHE_DISCONTINUITY_POLICY_V1;
  const previousCached = BigInt(previous.cachedInputTokens);
  const currentCached = BigInt(current.cachedInputTokens);
  const previousInput = BigInt(previous.inputTokens);
  const currentInput = BigInt(current.inputTokens);

  if (previous.cachedInputTokens < policy.minimumPreviousCacheReadTokens) {
    reasonCodes.push(POLICY_GATE_REASON_CODE.PREVIOUS_CACHE_READ_BELOW_MINIMUM);
    reasonMask |= 1;
  }
  if (previous.reuseBasisPoints === null
      || previous.reuseBasisPoints < policy.minimumPreviousReuseBasisPoints) {
    reasonCodes.push(POLICY_GATE_REASON_CODE.PREVIOUS_REUSE_BELOW_MINIMUM);
    reasonMask |= 2;
  }
  if (currentInput * POLICY_BIGINT.minimumCurrentInputDenominator
      < previousInput * POLICY_BIGINT.minimumCurrentInputNumerator) {
    reasonCodes.push(POLICY_GATE_REASON_CODE.CURRENT_INPUT_BELOW_COMPARABLE_FLOOR);
    reasonMask |= 4;
  }
  if (currentCached * POLICY_BIGINT.maximumCurrentCacheReadDenominator
      > previousCached * POLICY_BIGINT.maximumCurrentCacheReadNumerator) {
    reasonCodes.push(POLICY_GATE_REASON_CODE.CURRENT_CACHE_READ_ABOVE_HALF);
    reasonMask |= 8;
  }
  if (previousCached - currentCached < POLICY_BIGINT.minimumCacheReadDropTokens) {
    reasonCodes.push(POLICY_GATE_REASON_CODE.CACHE_READ_DROP_BELOW_MINIMUM);
    reasonMask |= 16;
  }
  if (!policyGateReasonCodeArrays[reasonMask]) {
    policyGateReasonCodeArrays[reasonMask] = Object.freeze(reasonCodes);
  }
  return policyGateReasonCodeArrays[reasonMask];
}

function cacheDiscontinuityReasonCodes(previous, current) {
  requireNormalizedObservation(previous, 'previous');
  requireNormalizedObservation(current, 'current');
  return cacheDiscontinuityReasonCodesForValidatedObservations(previous, current);
}

function isCacheDiscontinuity(previous, current) {
  return cacheDiscontinuityReasonCodes(previous, current).length === 0;
}

function parsedTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function normalizedModel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compactionGeneration(value, field) {
  const normalized = value === undefined ? 0 : value;
  if (!isNonNegativeSafeInteger(normalized)) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return normalized;
}

function emptyComparison() {
  return {
    state: COMPARISON_STATE.NO_PREVIOUS_OBSERVATION,
    reasonCodes: policyGateReasonCodeArrays[0],
    previousEventId: null,
    elapsedMs: null,
    previousInputTokens: null,
    inputDeltaTokens: null,
    inputDeltaBasisPoints: null,
    previousCachedInputTokens: null,
    cachedInputDeltaTokens: null,
    previousReuseBasisPoints: null,
  };
}

function compareValidatedAdjacentCacheObservations(previous, current, context = {}) {
  if (previous === null || previous === undefined) return emptyComparison();
  const previousEventId = typeof context.previousEventId === 'string'
    ? context.previousEventId.trim()
    : '';
  if (!previousEventId) throw new TypeError('previousEventId must be a non-empty string');

  const comparison = {
    state: COMPARISON_STATE.UNKNOWN_OR_NON_MONOTONIC_TIMESTAMP,
    reasonCodes: policyGateReasonCodeArrays[0],
    previousEventId,
    elapsedMs: null,
    previousInputTokens: previous.inputTokens,
    inputDeltaTokens: inputDeltaTokens(previous.inputTokens, current.inputTokens),
    inputDeltaBasisPoints: inputDeltaBasisPoints(previous.inputTokens, current.inputTokens),
    previousCachedInputTokens: previous.cachedInputTokens,
    cachedInputDeltaTokens: cachedInputDeltaTokens(
      previous.cachedInputTokens,
      current.cachedInputTokens,
    ),
    previousReuseBasisPoints: previous.reuseBasisPoints,
  };
  const previousTimestampMs = parsedTimestamp(context.previousTimestamp);
  const currentTimestampMs = parsedTimestamp(context.currentTimestamp);
  if (previousTimestampMs === null
      || currentTimestampMs === null
      || currentTimestampMs <= previousTimestampMs) return comparison;

  const elapsedMs = currentTimestampMs - previousTimestampMs;
  if (!Number.isSafeInteger(elapsedMs)) return comparison;
  comparison.elapsedMs = elapsedMs;
  const previousModel = normalizedModel(context.previousModel);
  const currentModel = normalizedModel(context.currentModel);
  if (previousModel && currentModel && previousModel !== currentModel) {
    comparison.state = COMPARISON_STATE.MODEL_CHANGE;
    return comparison;
  }
  const previousGeneration = compactionGeneration(
    context.previousCompactionGeneration,
    'previousCompactionGeneration',
  );
  const currentGeneration = compactionGeneration(
    context.currentCompactionGeneration,
    'currentCompactionGeneration',
  );
  if (previousGeneration !== currentGeneration) {
    comparison.state = COMPARISON_STATE.COMPACTION_BOUNDARY;
    return comparison;
  }

  comparison.reasonCodes = cacheDiscontinuityReasonCodesForValidatedObservations(previous, current);
  comparison.state = comparison.reasonCodes.length
    ? COMPARISON_STATE.COMPARABLE
    : COMPARISON_STATE.CACHE_DISCONTINUITY;
  return comparison;
}

function compareAdjacentCacheObservations(previous, current, context = {}) {
  requireNormalizedObservation(current, 'current');
  if (previous !== null && previous !== undefined) {
    requireNormalizedObservation(previous, 'previous');
  }
  return compareValidatedAdjacentCacheObservations(previous, current, context);
}

function createCacheObservation(candidate, previous = null, context = {}) {
  const normalized = normalizeCacheObservationCandidate(candidate);
  if (!normalized.observation) {
    return {
      cacheObservation: null,
      normalizationReasonCodes: normalized.reasonCodes,
    };
  }
  let normalizedPrevious = null;
  if (previous !== null && previous !== undefined) {
    if (isNormalizedCacheObservation(previous)) {
      normalizedPrevious = previous;
    } else {
      const previousResult = normalizeCacheObservationCandidate(previous);
      if (!previousResult.observation) {
        throw new TypeError('previous must contain valid required cache accounting');
      }
      normalizedPrevious = previousResult.observation;
    }
  }
  return {
    cacheObservation: {
      schemaVersion: CACHE_OBSERVATION_SCHEMA_VERSION,
      ...normalized.observation,
      comparison: compareValidatedAdjacentCacheObservations(
        normalizedPrevious,
        normalized.observation,
        context,
      ),
    },
    normalizationReasonCodes: [],
  };
}

function isPublicComparisonState(value) {
  return publicComparisonStateSet.has(value);
}

function isPolicyGateReasonCode(value) {
  return policyGateReasonCodeSet.has(value);
}

function createEmptyCacheDiscontinuityLinks() {
  return {
    protocolEventIdsByMainEventId: new Map(),
    mainEventIdByProtocolEventId: new Map(),
  };
}

module.exports = {
  CACHE_DISCONTINUITY_POLICY_V1,
  CACHE_OBSERVATION_SCHEMA_VERSION,
  COMPARISON_STATE,
  NORMALIZATION_REASON_CODE,
  NORMALIZATION_REASON_CODE_ORDER,
  POLICY_GATE_REASON_CODE,
  POLICY_GATE_REASON_CODE_ORDER,
  PUBLIC_COMPARISON_STATES,
  cacheDiscontinuityReasonCodes,
  cacheDiscontinuityReasonCodesForValidatedObservations,
  cachedInputDeltaTokens,
  compareAdjacentCacheObservations,
  createCacheObservation,
  createEmptyCacheDiscontinuityLinks,
  inputDeltaBasisPoints,
  inputDeltaTokens,
  isCacheDiscontinuity,
  isNormalizedCacheObservation,
  isPolicyGateReasonCode,
  isPublicComparisonState,
  normalizeCacheObservationCandidate,
  reuseBasisPoints,
};
