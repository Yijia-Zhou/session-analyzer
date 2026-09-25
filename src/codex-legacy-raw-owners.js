'use strict';

const { setImmediate: yieldImmediate } = require('node:timers/promises');
const { normalizeFsPath } = require('./shared/fs-path');
const { PROFILE, trustedPolicy, createBudget, unavailable } = require('./legacy-raw-owner-budget');

const ENCODING = 'codex-line-ranges-v1';
const MAX_LINE = Number.MAX_SAFE_INTEGER;

function contract(message) {
  const error = new Error(`Codex legacy Raw owner ${message}`);
  error.code = 'CANONICAL_CONTRACT_VIOLATION';
  return error;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function provisionalSessionIdFromFile(file) {
  const basename = file.split(/[\\/]/u).pop() || '';
  const uuid = basename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu);
  return uuid?.[1] || basename.replace(/\.jsonl$/iu, '');
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Indexing cancelled');
  error.name = 'AbortError';
  throw error;
}

async function checkpoint(signal, onChunk, phase) {
  throwIfAborted(signal);
  try { onChunk?.({ phase }); } catch { /* Observers cannot change admission. */ }
  await yieldImmediate(undefined, { signal });
  throwIfAborted(signal);
}

function checkedSum(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw contract(`${label} overflows a safe integer`);
  return result;
}

function requirePlain(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw contract(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw contract(`${label} has invalid keys`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw contract(`${label}.${key} must be an enumerable data property`);
    }
  }
  return value;
}

function requireDense(value, label, maxLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > maxLength) throw contract(`${label} must be a bounded array`);
  // The array length is bounded before ownKeys can allocate its key list.
  // Commit callers cap maxLength at the trusted build-work-unit ceiling; byte
  // preflight further rejects arrays that cannot fit their declared payload.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) {
    throw contract(`${label} must be dense without custom properties`);
  }
  if (value.length <= 3) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw contract(`${label}[${index}] must be an enumerable data property`);
      }
    }
  }
  return value;
}

function* denseValues(value, label, maxLength) {
  const array = requireDense(value, label, maxLength);
  for (let index = 0; index < array.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw contract(`${label}[${index}] must be an enumerable data property`);
    }
    yield descriptor.value;
  }
}

function encodedStringBytes(value, policy, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > policy.dictionaryStringBytes) {
    throw contract(`${label} is not a bounded nonempty string`);
  }
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function* payloadByteSteps(payload, policy = PROFILE, maxElements = policy.payloadBytes,
  maxBytes = Number.MAX_SAFE_INTEGER, capacityOutcome = false) {
  requirePlain(payload, ['sessionIds', 'files'], 'payload');
  let bytes = Buffer.byteLength('{"sessionIds":[],"files":[]}', 'utf8');
  const exceeded = (lowerBound) => {
    if (capacityOutcome) return { status: 'capacity_exceeded', observedLowerBound: lowerBound };
    throw contract('payload bytes exceed the declared or trusted budget');
  };
  // Minimum JSON costs reject an impossible array before Reflect.ownKeys creates
  // a full key list. A successful check also bounds that list by maxElements and
  // by the remaining byte budget; per-index descriptors are checked on the drain.
  const minimumCost = (array, elementBytes) => Array.isArray(array) && array.length
    ? array.length * elementBytes - 1 : 0;
  if (bytes > maxBytes) return exceeded(bytes);
  const minimumIds = minimumCost(payload.sessionIds, 4);
  if (minimumIds > maxBytes - bytes) return exceeded(bytes + minimumIds);
  let i = 0;
  for (const id of denseValues(payload.sessionIds, 'sessionIds', maxElements)) {
    bytes = checkedSum(bytes, encodedStringBytes(id, policy, 'session ID') + (i ? 1 : 0), 'payload bytes');
    if (bytes > maxBytes) return exceeded(bytes);
    i += 1;
    yield;
  }
  const minimumFiles = minimumCost(payload.files, 9);
  if (minimumFiles > maxBytes - bytes) return exceeded(bytes + minimumFiles);
  let fileIndex = 0;
  for (const filePair of denseValues(payload.files, 'files', maxElements)) {
    const pair = requireDense(filePair, 'file pair', 2);
    if (pair.length !== 2) throw contract('file pair must have two entries');
    bytes = checkedSum(bytes, 5 + encodedStringBytes(pair[0], policy, 'file') + (fileIndex ? 1 : 0), 'payload bytes');
    if (bytes > maxBytes) return exceeded(bytes);
    const minimumRanges = minimumCost(pair[1], 8);
    if (minimumRanges > maxBytes - bytes) return exceeded(bytes + minimumRanges);
    let rangeIndex = 0;
    for (const rawRange of denseValues(pair[1], 'file ranges', maxElements)) {
      const range = requireDense(rawRange, 'range', 3);
      if (range.length !== 3 || !range.every(Number.isSafeInteger)) {
        throw contract('range must contain three safe integers');
      }
      bytes = checkedSum(bytes,
        4 + String(range[0]).length + String(range[1]).length + String(range[2]).length
          + (rangeIndex ? 1 : 0), 'payload bytes');
      if (bytes > maxBytes) return exceeded(bytes);
      rangeIndex += 1;
      yield;
    }
    fileIndex += 1;
    yield;
  }
  return bytes;
}

function exactPayloadByteCount(payload, policy = PROFILE, maxElements = policy.payloadBytes,
  maxBytes = Number.MAX_SAFE_INTEGER) {
  const steps = payloadByteSteps(payload, policy, maxElements, maxBytes);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

async function exactPayloadByteCountForCommit(payload, options = {}) {
  const policy = options.policy || PROFILE;
  const steps = payloadByteSteps(payload, policy, options.maxElements ?? policy.payloadBytes,
    options.maxBytes ?? Number.MAX_SAFE_INTEGER, options.capacityOutcome === true);
  let work = 0;
  while (true) {
    throwIfAborted(options.signal);
    const step = steps.next();
    if (step.done) return step.value;
    work += 1;
    if (work >= policy.chunkSize) {
      work = 0;
      await checkpoint(options.signal, options.onChunk, 'legacy_raw_payload_bytes');
    }
  }
}

// This generator is shared by the synchronous reader and the commit drain.
// It checks semantic ownership without expanding a range into individual lines.
function* validationSteps(ownerIndex, sessionIds, sessionFacts, policy = PROFILE) {
  if (ownerIndex.status === 'unavailable') return;
  const payload = ownerIndex.payload;
  const ids = payload.sessionIds;
  const files = payload.files;
  const counts = new Map();
  const maxLineByFile = new Map();
  const factCacheBudget = createBudget(policy);
  if (sessionFacts) {
    for (const [id, fact] of sessionFacts) {
      const file = normalizeFsPath(fact.sourceFile);
      const receipt = factCacheBudget.reserve('dictionaryEntry', 1, 0, 'finalizing');
      if (receipt) throw contract('normalized Session facts exceed trusted validation workspace budget');
      counts.set(id, { count: 0, file });
      // Codex lineCount counts nonblank records, while Raw locators use physical
      // line numbers. Accepted UTF-8 bytes are a conservative physical-line
      // ceiling even when blank lines occur between accepted records.
      const bound = fact.acceptedBytes ?? fact.lineCount;
      maxLineByFile.set(file, Math.max(maxLineByFile.get(file) || 0, bound));
      yield;
    }
  }
  let entryCount = 0;
  let ambiguousLineCount = 0;
  let rangeCount = 0;
  let previousId = null;
  for (const id of ids) {
    encodedStringBytes(id, policy, 'session ID');
    if (previousId !== null && compareCodeUnits(previousId, id) >= 0) throw contract('Session dictionary is not sorted and unique');
    if (!(sessionIds instanceof Set) || !sessionIds.has(id)) throw contract('Session dictionary references an unknown Session');
    previousId = id;
    yield;
  }
  let previousFile = null;
  for (const [file, ranges] of files) {
    encodedStringBytes(file, policy, 'file');
    if (normalizeFsPath(file) !== file || (previousFile !== null && compareCodeUnits(previousFile, file) >= 0)) {
      throw contract('file dictionary is not normalized, sorted and unique');
    }
    if (!ranges.length) throw contract('file must have at least one range');
    previousFile = file;
    let priorEnd = 0;
    let priorOwner = null;
    const maxLine = maxLineByFile.get(file) || 0;
    for (const [start, end, owner] of ranges) {
      if (start < 1 || end < start || end > MAX_LINE || owner < -1 || owner >= ids.length) {
        throw contract('range endpoints or owner are invalid');
      }
      if (start <= priorEnd || (priorOwner === owner && priorEnd < MAX_LINE && start === priorEnd + 1)) {
        throw contract('ranges overlap or leave an unmerged same-owner adjacency');
      }
      if (sessionFacts && end > maxLine) throw contract('range exceeds accepted file physical-line bound');
      const length = end - start + 1;
      if (owner === -1) {
        ambiguousLineCount = checkedSum(ambiguousLineCount, length, 'ambiguous line count');
      } else {
        const id = ids[owner];
        if (sessionFacts) {
          const fact = sessionFacts.get(id);
          const counted = counts.get(id);
          if (!fact || !counted || counted.file !== file
              || end > (fact.acceptedBytes ?? fact.lineCount)) {
            throw contract('range belongs to the wrong Session or file');
          }
          const next = checkedSum(counted.count, length, 'per-Session owner count');
          if (next > fact.rawEventCount) {
            throw contract('range exceeds Session Raw event count');
          }
          counted.count = next;
        } else {
          const next = checkedSum(counts.get(id) || 0, length, 'per-Session owner count');
          counts.set(id, next);
        }
        entryCount = checkedSum(entryCount, length, 'entry count');
      }
      rangeCount = checkedSum(rangeCount, 1, 'range count');
      priorEnd = end;
      priorOwner = owner;
      yield;
    }
  }
  if (ownerIndex.entryCount !== entryCount
      || ownerIndex.ambiguousLineCount !== ambiguousLineCount
      || ownerIndex.rangeCount !== rangeCount) {
    throw contract('declared range counters do not match payload');
  }
}

function validateCodexV2(ownerIndex, sessionIds, sessionFacts, policy = PROFILE) {
  for (const _ of validationSteps(ownerIndex, sessionIds, sessionFacts, policy)) { /* drain */ }
}

async function validateCodexV2ForCommit(ownerIndex, sessionIds, sessionFacts, options = {}) {
  const policy = options.policy || PROFILE;
  let work = 0;
  for (const _ of validationSteps(ownerIndex, sessionIds, sessionFacts, policy)) {
    work += 1;
    if (work >= policy.chunkSize) {
      work = 0;
      await checkpoint(options.signal, options.onChunk, 'legacy_raw_semantics');
    }
  }
  throwIfAborted(options.signal);
}

function createCodexLegacyRawOwnerBuilder(options = {}) {
  const policy = trustedPolicy(options.policy);
  const budget = createBudget(policy);
  let sessions = new Map();
  let files = new Map();
  let capacity = null;
  let finished = false;
  let disposed = false;
  let collectionWork = 0;
  const abandon = (receipt) => {
    if (capacity) return;
    capacity = receipt;
    sessions.clear();
    files.clear();
    budget.clear();
    try {
      const observation = options.onCapacity?.(receipt);
      if (observation && typeof observation.catch === 'function') observation.catch(() => {});
    } catch { /* Observation only. */ }
  };
  const reserve = (kind, count = 1, extraBytes = 0, phase = 'building') => {
    const receipt = budget.reserve(kind, count, extraBytes, phase);
    if (receipt) abandon(receipt);
    return !receipt;
  };
  const sortedKeysForCommit = async (map, signal, onChunk, phase) => {
    const count = map.size;
    if (!reserve('scratchSlot', count, 0, 'finalizing')) return null;
    let values = [];
    let work = 0;
    for (const key of map.keys()) {
      values.push(key);
      if (++work >= policy.chunkSize) {
        work = 0;
        await checkpoint(signal, onChunk, `${phase}_collect`);
      }
    }
    const chunkSlots = Math.min(policy.chunkSize, count);
    if (!reserve('scratchSlot', chunkSlots, 0, 'finalizing')) return null;
    for (let start = 0; start < count; start += policy.chunkSize) {
      const chunk = values.slice(start, start + policy.chunkSize).sort(compareCodeUnits);
      for (let offset = 0; offset < chunk.length; offset += 1) {
        values[start + offset] = chunk[offset];
      }
      await checkpoint(signal, onChunk, `${phase}_sort`);
    }
    budget.release('scratchSlot', chunkSlots);
    if (count > policy.chunkSize) {
      if (!reserve('scratchSlot', count, 0, 'finalizing')) return null;
      let scratch = new Array(count);
      for (let width = policy.chunkSize; width < count; width *= 2) {
        for (let left = 0; left < count; left += width * 2) {
          const middle = Math.min(left + width, count);
          const right = Math.min(left + width * 2, count);
          let first = left;
          let second = middle;
          for (let at = left; at < right; at += 1) {
            scratch[at] = second >= right
              || (first < middle && compareCodeUnits(values[first], values[second]) <= 0)
              ? values[first++] : values[second++];
            if (++work >= policy.chunkSize) {
              work = 0;
              await checkpoint(signal, onChunk, `${phase}_merge`);
            }
          }
        }
        [values, scratch] = [scratch, values];
      }
      scratch = null;
      budget.release('scratchSlot', count);
    }
    return values;
  };
  const observeSession = async (session, { signal, onChunk } = {}) => {
    if (finished || disposed) throw new Error('Codex legacy Raw owner builder is closed');
    if (!session || typeof session.id !== 'string' || !session.id || session.sourceKind !== 'codex') {
      throw contract('Session identity or source is invalid');
    }
    const expectedFile = normalizeFsPath(session.sourceFile);
    if (!expectedFile) throw contract('Session source file is invalid');
    const provisionalSessionId = provisionalSessionIdFromFile(session.sourceFile);
    const finalRawPrefix = `${session.id}:raw:`;
    const provisionalRawPrefix = `${provisionalSessionId}:raw:`;
    let finalIdentitySeen = false;
    let dictionaryStringsChecked = false;
    let sessionIdBytes = 0;
    let fileBytes = 0;
    const physicalLineBound = session.bytes ?? session.lineCount;
    if (!Number.isSafeInteger(physicalLineBound) || physicalLineBound < 0) {
      throw contract('Session accepted source bound is invalid');
    }
    for (const raw of session.rawEvents || []) {
      throwIfAborted(signal);
      collectionWork += 1;
      if (collectionWork >= policy.chunkSize) {
        collectionWork = 0;
        await checkpoint(signal, onChunk, 'legacy_raw_collect');
      }
      const rawFile = raw?.source?.file || '';
      const file = rawFile === session.sourceFile || rawFile === expectedFile
        ? expectedFile : normalizeFsPath(rawFile);
      const line = raw?.source?.line;
      if (!file || !Number.isSafeInteger(line) || line < 1) continue;
      // This check remains active after capacity is exhausted.
      if (file !== expectedFile) throw contract('eligible claim has inconsistent file');
      if (line > physicalLineBound) throw contract('eligible claim exceeds accepted physical-line bound');
      const claimSessionId = typeof raw.sessionId === 'string' && raw.sessionId
        ? raw.sessionId : session.id;
      const prefix = claimSessionId === session.id ? finalRawPrefix
        : claimSessionId === provisionalSessionId ? provisionalRawPrefix
          : `${claimSessionId}:raw:`;
      if (typeof raw.rawId !== 'string' || !raw.rawId.startsWith(prefix)
          || raw.rawId.slice(prefix.length) !== String(line)) {
        throw contract('eligible claim has inconsistent Raw ID');
      }
      // A record before the first accepted session_meta can use the filename's
      // provisional Session ID. It is readable by explicit identity, but the
      // final Session's legacy file/line address cannot encode that Raw ID.
      if (claimSessionId !== session.id) {
        if (claimSessionId !== provisionalSessionId || finalIdentitySeen) {
          throw contract('eligible claim has invalid provisional Session identity');
        }
        continue;
      }
      finalIdentitySeen = true;
      if (!dictionaryStringsChecked) {
        sessionIdBytes = Buffer.byteLength(session.id, 'utf8');
        fileBytes = Buffer.byteLength(expectedFile, 'utf8');
        if (sessionIdBytes > policy.dictionaryStringBytes) {
          throw contract('Session ID exceeds dictionary string budget');
        }
        if (fileBytes > policy.dictionaryStringBytes) {
          throw contract('file exceeds dictionary string budget');
        }
        dictionaryStringsChecked = true;
      }
      if (!capacity) {
        let owner = sessions.get(session.id);
        if (owner === undefined) {
          if (reserve('dictionaryEntry', 1, sessionIdBytes)) {
            owner = sessions.size;
            sessions.set(session.id, owner);
          }
        }
        let entry = !capacity && files.get(file);
        if (!capacity && !entry) {
          if (reserve('dictionaryEntry', 1, fileBytes)) {
            entry = { spans: [] };
            files.set(file, entry);
          }
        }
        if (!capacity) {
          const spans = entry.spans;
          const last = spans[spans.length - 1];
          if (last && last.owner === owner && (line === last.end || (last.end < MAX_LINE && line === last.end + 1))) {
            last.end = line;
          } else if (reserve('span')) {
            spans.push({ start: line, end: line, owner });
          }
        }
      }
    }
  };
  const finish = async ({ signal, onChunk } = {}) => {
    if (finished || disposed) throw new Error('Codex legacy Raw owner builder is closed');
    finished = true;
    try {
      throwIfAborted(signal);
      if (capacity) return unavailable(policy, capacity);
      const sortedIds = await sortedKeysForCommit(sessions, signal, onChunk, 'legacy_raw_session_dictionary');
      if (!sortedIds) return unavailable(policy, capacity);
      if (!reserve('scratchSlot', sortedIds.length, 0, 'finalizing')) return unavailable(policy, capacity);
      const remap = new Array(sortedIds.length);
      let dictionaryWork = 0;
      for (let index = 0; index < sortedIds.length; index += 1) {
        remap[sessions.get(sortedIds[index])] = index;
        if (++dictionaryWork >= policy.chunkSize) {
          dictionaryWork = 0;
          await checkpoint(signal, onChunk, 'legacy_raw_session_dictionary_remap');
        }
      }
      const outputFiles = [];
      let entryCount = 0;
      let ambiguousLineCount = 0;
      let rangeCount = 0;
      let normalizationWork = 0;
      const sortedFiles = await sortedKeysForCommit(files, signal, onChunk, 'legacy_raw_file_dictionary');
      if (!sortedFiles) return unavailable(policy, capacity);
      for (const file of sortedFiles) {
        throwIfAborted(signal);
        const spans = files.get(file).spans;
        const endpointCount = spans.length * 2;
        if (!Number.isSafeInteger(endpointCount)) throw contract('endpoint count overflows');
        if (!reserve('endpoint', endpointCount, 0, 'finalizing')) return unavailable(policy, capacity);
        let endpoints = [];
        let endpointWork = 0;
        for (const span of spans) {
          endpoints.push([BigInt(span.start), 1, span.owner]);
          endpoints.push([BigInt(span.end) + 1n, -1, span.owner]);
          endpointWork += 2;
          if (endpointWork >= policy.chunkSize) {
            endpointWork = 0;
            await checkpoint(signal, onChunk, 'legacy_raw_endpoint_build');
          }
        }
        const chunkCount = Math.ceil(endpoints.length / policy.chunkSize);
        if (!reserve('scratchSlot', endpoints.length + chunkCount * 3, 0, 'finalizing')) {
          return unavailable(policy, capacity);
        }
        const chunks = [];
        for (let start = 0; start < endpoints.length; start += policy.chunkSize) {
          const chunk = endpoints.slice(start, start + policy.chunkSize);
          chunk.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
          chunks.push(chunk);
          normalizationWork += chunk.length;
          if (normalizationWork >= policy.chunkSize) {
            normalizationWork = 0;
            await checkpoint(signal, onChunk, 'legacy_raw_sort');
          }
        }
        endpoints = null;
        budget.release('scratchSlot', endpointCount);
        const positions = new Array(chunks.length).fill(0);
        const heap = [];
        const less = (left, right) => chunks[left][positions[left]][0] < chunks[right][positions[right]][0];
        const push = (run) => {
          let at = heap.length;
          heap.push(run);
          while (at > 0) {
            const parent = (at - 1) >> 1;
            if (!less(heap[at], heap[parent])) break;
            [heap[at], heap[parent]] = [heap[parent], heap[at]];
            at = parent;
          }
        };
        const pop = () => {
          const result = heap[0];
          const last = heap.pop();
          if (heap.length) {
            heap[0] = last;
            let at = 0;
            while (true) {
              const left = at * 2 + 1;
              if (left >= heap.length) break;
              const right = left + 1;
              const smaller = right < heap.length && less(heap[right], heap[left]) ? right : left;
              if (!less(heap[smaller], heap[at])) break;
              [heap[at], heap[smaller]] = [heap[smaller], heap[at]];
              at = smaller;
            }
          }
          return result;
        };
        for (let run = 0; run < chunks.length; run += 1) push(run);
        const nextEvent = () => {
          const run = pop();
          const value = chunks[run][positions[run]++];
          if (positions[run] < chunks[run].length) push(run);
          return value;
        };
        const active = new Map();
        const output = [];
        let pending = null;
        let lastPoint = null;
        let processed = 0;
        while (pending || heap.length) {
          const event = pending || nextEvent();
          pending = null;
          const point = event[0];
          if (lastPoint !== null && lastPoint < point && active.size) {
            const start = Number(lastPoint);
            const end = Number(point - 1n);
            const owner = active.size === 1 ? remap[active.keys().next().value] : -1;
            const previous = output[output.length - 1];
            if (previous && previous[2] === owner && previous[1] < MAX_LINE && previous[1] + 1 === start) {
              previous[1] = end;
            } else {
              if (!reserve('range', 1, 0, 'finalizing')) return unavailable(policy, capacity);
              output.push([start, end, owner]);
            }
          }
          let current = event;
          while (current && current[0] === point) {
            const oldCount = active.get(current[2]) || 0;
            const newCount = oldCount + current[1];
            if (newCount < 0) throw contract('endpoint refcount underflow');
            if (newCount === 0) {
              active.delete(current[2]);
              budget.release('activeOwner');
            } else if (oldCount === 0) {
              if (!reserve('activeOwner', 1, 0, 'finalizing')) return unavailable(policy, capacity);
              active.set(current[2], newCount);
            } else active.set(current[2], newCount);
            current = heap.length ? nextEvent() : null;
            processed += 1;
            if (processed >= policy.chunkSize) {
              processed = 0;
              await checkpoint(signal, onChunk, 'legacy_raw_sweep');
            }
          }
          pending = current;
          lastPoint = point;
        }
        if (active.size) throw contract('endpoint sweep left active owners');
        for (const [start, end, owner] of output) {
          const length = end - start + 1;
          if (owner === -1) ambiguousLineCount = checkedSum(ambiguousLineCount, length, 'ambiguous line count');
          else entryCount = checkedSum(entryCount, length, 'entry count');
          rangeCount = checkedSum(rangeCount, 1, 'range count');
          normalizationWork += 1;
          if (normalizationWork >= policy.chunkSize) {
            normalizationWork = 0;
            await checkpoint(signal, onChunk, 'legacy_raw_range_stats');
          }
        }
        if (!reserve('scratchSlot', 1, 0, 'finalizing')) return unavailable(policy, capacity);
        outputFiles.push([file, output]);
        budget.release('endpoint', endpointCount);
        budget.release('scratchSlot', chunkCount * 3);
        budget.release('span', spans.length);
        files.delete(file);
        normalizationWork += 1;
        if (normalizationWork >= policy.chunkSize) {
          normalizationWork = 0;
          await checkpoint(signal, onChunk, 'legacy_raw_finalize_file');
        }
      }
      const payload = { sessionIds: sortedIds, files: outputFiles };
       const accountedBytes = await exactPayloadByteCountForCommit(payload,
         { policy, signal, onChunk, maxElements: policy.buildWorkUnits,
           maxBytes: policy.payloadBytes, capacityOutcome: true });
       if (accountedBytes?.status === 'capacity_exceeded') {
         abandon({ limitName: 'payload_bytes', limit: policy.payloadBytes,
           observedLowerBound: accountedBytes.observedLowerBound, phase: 'finalizing' });
         return unavailable(policy, capacity);
      }
      const result = {
        schemaVersion: 2, sourceKind: 'codex', status: 'available', encoding: ENCODING,
        budgetProfile: policy.name, entryCount, ambiguousLineCount, rangeCount,
        accountedBytes, payload,
      };
      // Ownership moves to the Index. dispose() must not mutate this payload.
      sessions = null;
      files = null;
      budget.clear();
      return result;
    } finally {
      if (sessions) sessions.clear();
      if (files) files.clear();
      budget.clear();
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    sessions?.clear();
    files?.clear();
    budget.clear();
  };
  return Object.freeze({ observeSession, finish, dispose, budgetSnapshot: budget.snapshot });
}

function resolveCodexV2(index, file, line) {
  if (typeof file !== 'string' || !file || !Number.isSafeInteger(line) || line < 1) return null;
  const payload = index?.legacyRawOwners?.payload;
  if (!payload || !Array.isArray(payload.files)) return null;
  const normalized = normalizeFsPath(file);
  let low = 0;
  let high = payload.files.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const comparison = compareCodeUnits(payload.files[middle][0], normalized);
    if (comparison < 0) low = middle + 1;
    else high = middle;
  }
  if (low >= payload.files.length || payload.files[low][0] !== normalized) return null;
  const ranges = payload.files[low][1];
  low = 0;
  high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle][1] < line) low = middle + 1;
    else high = middle;
  }
  if (low >= ranges.length || ranges[low][0] > line || ranges[low][2] === -1) return null;
  const sessionId = payload.sessionIds[ranges[low][2]];
  const indexedSession = index.sessionsById.get(sessionId);
  if (!indexedSession || normalizeFsPath(indexedSession.sourceFile) !== normalized) {
    throw contract('lookup file does not match indexed Session');
  }
  return { sessionId, rawIdHint: `${sessionId}:raw:${line}`, line };
}

module.exports = {
  ENCODING, exactPayloadByteCount, exactPayloadByteCountForCommit,
  validateCodexV2, validateCodexV2ForCommit,
  createCodexLegacyRawOwnerBuilder, resolveCodexV2,
};
