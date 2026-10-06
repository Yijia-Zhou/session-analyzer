'use strict';

// These are accounting proxies for live builder structures, not V8 heap sizes.
// A record includes its primary array/Map slot. Extra sorting references have
// their own slot charge. Changing a weight requires a new budget profile.
const PROFILE = Object.freeze({
  name: 'legacy-raw-v2-default-1',
  payloadBytes: 64 * 1024 * 1024,
  buildAccountedBytes: 128 * 1024 * 1024,
  buildWorkUnits: 8_388_608,
  dictionaryStringBytes: 64 * 1024,
  unavailableBytes: 4 * 1024,
  chunkSize: 4_096,
});

const WEIGHTS = Object.freeze({
  span: 40,
  endpoint: 40,
  range: 32,
  dictionaryEntry: 48,
  activeOwner: 32,
  scratchSlot: 8,
});

function trustedPolicy(overrides) {
  if (overrides === undefined) return PROFILE;
  const result = { ...PROFILE, ...overrides };
  for (const key of ['payloadBytes', 'buildAccountedBytes', 'buildWorkUnits',
    'dictionaryStringBytes', 'unavailableBytes', 'chunkSize']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 1) {
      throw new TypeError(`Invalid legacy Raw owner policy ${key}`);
    }
  }
  if (result.chunkSize > 4_096) throw new TypeError('Legacy Raw owner chunk size exceeds 4096');
  return Object.freeze(result);
}

function createBudget(policy = PROFILE) {
  let units = 0;
  let bytes = 0;
  let peakUnits = 0;
  let peakBytes = 0;
  const reserve = (kind, count = 1, extraBytes = 0, phase = 'building') => {
    if (!Object.hasOwn(WEIGHTS, kind)
        || !Number.isSafeInteger(count) || count < 0
        || !Number.isSafeInteger(extraBytes) || extraBytes < 0) {
      throw new TypeError('Invalid legacy Raw owner budget reservation');
    }
    const nextUnits = units + count;
    const nextBytes = bytes + count * WEIGHTS[kind] + extraBytes;
    if (!Number.isSafeInteger(nextUnits) || !Number.isSafeInteger(nextBytes)) {
      throw new RangeError('Legacy Raw owner budget arithmetic overflow');
    }
    if (nextUnits > policy.buildWorkUnits) {
      return { limitName: 'build_work_units', limit: policy.buildWorkUnits,
        observedLowerBound: nextUnits, phase };
    }
    if (nextBytes > policy.buildAccountedBytes) {
      return { limitName: 'build_accounted_bytes', limit: policy.buildAccountedBytes,
        observedLowerBound: nextBytes, phase };
    }
    units = nextUnits;
    bytes = nextBytes;
    peakUnits = Math.max(peakUnits, units);
    peakBytes = Math.max(peakBytes, bytes);
    return null;
  };
  const release = (kind, count = 1, extraBytes = 0) => {
    if (!Object.hasOwn(WEIGHTS, kind)
        || !Number.isSafeInteger(count) || count < 0
        || !Number.isSafeInteger(extraBytes) || extraBytes < 0) {
      throw new TypeError('Invalid legacy Raw owner budget release');
    }
    units -= count;
    bytes -= count * WEIGHTS[kind] + extraBytes;
    if (units < 0 || bytes < 0) throw new Error('Legacy Raw owner budget underflow');
  };
  const clear = () => { units = 0; bytes = 0; };
  return Object.freeze({ reserve, release, clear, snapshot: () => ({
    units, bytes, peakUnits, peakBytes,
  }) });
}

function unavailable(policy, capacity) {
  const result = {
    schemaVersion: 2,
    sourceKind: 'codex',
    status: 'unavailable',
    reason: 'capacity_exceeded',
    budgetProfile: policy.name,
    capacity,
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > policy.unavailableBytes) {
    throw new Error('Legacy Raw owner capacity receipt exceeds envelope budget');
  }
  return result;
}

module.exports = { PROFILE, WEIGHTS, trustedPolicy, createBudget, unavailable };
