'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { normalizeFsPath } = require('../src/shared/fs-path');
const path = require('node:path');
const { trustedPolicy, createBudget } = require('../src/legacy-raw-owner-budget');
const { buildSourceBackedIndex } = require('../src/codex');
const {
  getSourceAdapter,
  materializeSessionForIndex,
  validateIndexOwnership,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { createServer } = require('../server');
const {
  createCodexLegacyRawOwnerBuilder,
  exactPayloadByteCount,
  exactPayloadByteCountForCommit,
  resolveCodexV2,
  validateCodexV2,
} = require('../src/codex-legacy-raw-owners');
const {
  validateCanonicalLegacyRawOwnerIndex,
  validateCanonicalLegacyRawOwnerIndexForCommit,
} = require('../src/canonical-contract');

function claim(id, file, line) {
  return { rawId: `${id}:raw:${line}`, source: { file, line } };
}

function session(id, file, lines, lineCount = 20) {
  return {
    id, sourceKind: 'codex', sourceFile: file, lineCount,
    rawEvents: lines.map((line) => claim(id, file, line)),
  };
}

async function build(sessions, options = {}) {
  const builder = createCodexLegacyRawOwnerBuilder(options);
  try {
    for (const item of sessions) await builder.observeSession(item);
    return await builder.finish();
  } finally {
    builder.dispose();
  }
}

test('v2 range lookup matches the old point ownership oracle across reordered claims', async () => {
  let seed = 0x12345678;
  const random = (max) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) % max;
  };
  for (let caseIndex = 0; caseIndex < 40; caseIndex += 1) {
    const sessions = [];
    const oracle = new Map();
    for (let index = 0; index < 5; index += 1) {
      const file = `fixture-${random(3)}.jsonl`;
      const id = `session-${caseIndex}-${index}`;
      const lines = Array.from({ length: 10 }, () => random(20) + 1);
      sessions.push(session(id, file, lines));
      for (const line of lines) {
        const key = `${file}:${line}`;
        if (!oracle.has(key)) oracle.set(key, new Set());
        oracle.get(key).add(id);
      }
    }
    const owners = await build(sessions);
    const reordered = await build(sessions.toReversed().map((item) => ({
      ...item, rawEvents: item.rawEvents.toReversed(),
    })));
    assert.deepEqual(owners.payload, reordered.payload);
    validateCanonicalLegacyRawOwnerIndex(owners, 'codex');
    const facts = new Map(sessions.map((item) => [item.id, {
      sourceFile: item.sourceFile, lineCount: item.lineCount, rawEventCount: item.rawEvents.length,
    }]));
    validateCodexV2(owners, new Set(facts.keys()), facts);
    const index = { legacyRawOwners: owners, sessionsById: new Map(sessions.map((item) => [item.id, item])) };
    for (const file of ['fixture-0.jsonl', 'fixture-1.jsonl', 'fixture-2.jsonl']) {
      for (let line = 1; line <= 21; line += 1) {
        const claimed = oracle.get(`${file}:${line}`) || new Set();
        const found = resolveCodexV2(index, file, line);
        assert.equal(found?.sessionId || null, claimed.size === 1 ? [...claimed][0] : null);
        if (found) assert.equal(found.rawIdHint, `${found.sessionId}:raw:${line}`);
      }
    }
  }
});

test('v2 keeps safe-integer boundaries, holes and ambiguity separate', async () => {
  const max = Number.MAX_SAFE_INTEGER;
  const owners = await build([
    session('one', 'edge.jsonl', [max - 2, max], max),
    session('two', 'edge.jsonl', [max], max),
  ]);
  assert.deepEqual(owners.payload.files[0][1], [
    [max - 2, max - 2, 0], [max, max, -1],
  ]);
  assert.equal(owners.entryCount, 1);
  assert.equal(owners.ambiguousLineCount, 1);
  validateCanonicalLegacyRawOwnerIndex(owners, 'codex');
});

test('pre-metadata provisional Raw identity is excluded from legacy lookup', async () => {
  const item = session('final', 'provisional.jsonl', [2, 3]);
  item.rawEvents.unshift({
    rawId: 'provisional:raw:1', sessionId: 'provisional',
    source: { file: 'provisional.jsonl', line: 1 },
  });
  const owners = await build([item]);
  assert.equal(owners.entryCount, 2);
  const index = { legacyRawOwners: owners, sessionsById: new Map([['final', item]]) };
  assert.equal(resolveCodexV2(index, 'provisional.jsonl', 1), null);
  assert.equal(resolveCodexV2(index, 'provisional.jsonl', 2).sessionId, 'final');
  item.rawEvents[0].rawId = 'wrong';
  await assert.rejects(build([item]), { code: 'CANONICAL_CONTRACT_VIOLATION' });
});

test('v2 byte accounting matches native JSON for escapes and Unicode', async () => {
  const payload = {
    sessionIds: ['a\n"\\中文😀\ud800'],
    files: [['__proto__', [[9, 10, 0]]]],
  };
  const expected = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert.equal(exactPayloadByteCount(payload), expected);
  assert.equal(await exactPayloadByteCountForCommit(payload), expected);
});

test('budget reservations are checked before growth and released exactly', () => {
  const budget = createBudget(trustedPolicy({ buildWorkUnits: 2, buildAccountedBytes: 80 }));
  assert.equal(budget.reserve('span'), null);
  assert.equal(budget.reserve('span'), null);
  assert.deepEqual(budget.reserve('span'), {
    limitName: 'build_work_units', limit: 2, observedLowerBound: 3, phase: 'building',
  });
  assert.equal(budget.snapshot().units, 2);
  assert.equal(budget.snapshot().bytes, 80);
  budget.release('span');
  assert.equal(budget.reserve('endpoint'), null);
  assert.equal(budget.snapshot().peakBytes, 80);
  budget.release('endpoint');
  budget.release('span');
  assert.deepEqual({ units: budget.snapshot().units, bytes: budget.snapshot().bytes },
    { units: 0, bytes: 0 });
  const byteBudget = createBudget(trustedPolicy({ buildAccountedBytes: 40 }));
  assert.equal(byteBudget.reserve('span'), null);
  assert.equal(byteBudget.reserve('scratchSlot').limitName, 'build_accounted_bytes');
  assert.equal(byteBudget.snapshot().units, 1);
});

test('special path names use dictionary entries without object-key collisions', async () => {
  const owners = await build([
    session('prototype', '__proto__.jsonl', [1]),
    session('constructor', 'constructor.jsonl', [2]),
  ]);
  const index = { legacyRawOwners: owners, sessionsById: new Map([
    ['prototype', { sourceFile: '__proto__.jsonl' }],
    ['constructor', { sourceFile: 'constructor.jsonl' }],
  ]) };
  assert.equal(resolveCodexV2(index, '__proto__.jsonl', 1).sessionId, 'prototype');
  assert.equal(resolveCodexV2(index, 'constructor.jsonl', 2).sessionId, 'constructor');
});

test('capacity releases optional state but later invalid claims still fail', async () => {
  const policy = trustedPolicy({ buildWorkUnits: 4 });
  const builder = createCodexLegacyRawOwnerBuilder({ policy });
  await builder.observeSession(session('first', 'a.jsonl', [1, 3, 5]));
  assert.deepEqual({ units: builder.budgetSnapshot().units, bytes: builder.budgetSnapshot().bytes },
    { units: 0, bytes: 0 });
  await assert.rejects(builder.observeSession({
    ...session('later', 'b.jsonl', [1]),
    rawEvents: [{ rawId: 'wrong', source: { file: 'b.jsonl', line: 1 } }],
  }), { code: 'CANONICAL_CONTRACT_VIOLATION' });
  builder.dispose();
  builder.dispose();

  const unavailable = await build([session('first', 'a.jsonl', [1, 3, 5])], { policy });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.capacity.limitName, 'build_work_units');
  assert.equal(Object.hasOwn(unavailable, 'payload'), false);
  assert.equal(Object.hasOwn(unavailable, 'entryCount'), false);
  validateCanonicalLegacyRawOwnerIndex(unavailable, 'codex', { policy });
});

test('capacity receipts distinguish build bytes from final payload bytes', async () => {
  const buildPolicy = trustedPolicy({ buildAccountedBytes: 100 });
  const buildLimited = await build([session('s', 'f.jsonl', [1])], { policy: buildPolicy });
  assert.equal(buildLimited.status, 'unavailable');
  assert.equal(buildLimited.capacity.limitName, 'build_accounted_bytes');
  assert.equal(buildLimited.capacity.phase, 'building');
  validateCanonicalLegacyRawOwnerIndex(buildLimited, 'codex', { policy: buildPolicy });

  const payloadPolicy = trustedPolicy({ payloadBytes: 40 });
  const payloadLimited = await build([session('s', 'f.jsonl', [1])], { policy: payloadPolicy });
  assert.equal(payloadLimited.status, 'unavailable');
  assert.equal(payloadLimited.capacity.limitName, 'payload_bytes');
  assert.equal(payloadLimited.capacity.phase, 'finalizing');
  validateCanonicalLegacyRawOwnerIndex(payloadLimited, 'codex', { policy: payloadPolicy });
});

test('available and unavailable envelopes fail closed on tampering', async () => {
  const owners = await build([session('s', 'f.jsonl', [1, 2, 4])]);
  const brokenBytes = structuredClone(owners);
  brokenBytes.accountedBytes += 1;
  assert.throws(() => validateCanonicalLegacyRawOwnerIndex(brokenBytes, 'codex'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
  const brokenRange = structuredClone(owners);
  brokenRange.payload.files[0][1][1][0] = 2;
  brokenRange.accountedBytes = exactPayloadByteCount(brokenRange.payload);
  assert.throws(() => validateCodexV2(brokenRange, new Set(['s'])),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
  const policy = trustedPolicy({ buildWorkUnits: 3 });
  const unavailable = await build([session('s', 'f.jsonl', [1, 3])], { policy });
  for (const change of [
    (value) => { value.capacity.limit += 1; },
    (value) => { value.capacity.observedLowerBound = value.capacity.limit; },
    (value) => { value.capacity.limitName = 'unknown'; },
  ]) {
    const forged = structuredClone(unavailable);
    change(forged);
    assert.throws(() => validateCanonicalLegacyRawOwnerIndex(forged, 'codex', { policy }),
      { code: 'CANONICAL_CONTRACT_VIOLATION' });
  }
  unavailable.payload = owners.payload;
  assert.throws(() => validateCanonicalLegacyRawOwnerIndex(unavailable, 'codex', { policy }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
});

test('unavailable capacity fields reject objects before coercion or serialization', async () => {
  const policy = trustedPolicy({ buildWorkUnits: 3 });
  const original = await build([session('s', 'f.jsonl', [1, 3])], { policy });
  for (const field of ['limitName', 'limit', 'observedLowerBound', 'phase']) {
    for (const validate of [
      (value) => validateCanonicalLegacyRawOwnerIndex(value, 'codex', { policy }),
      (value) => validateCanonicalLegacyRawOwnerIndexForCommit(value, 'codex', { policy }),
    ]) {
      let effects = 0;
      const impostor = {
        [Symbol.toPrimitive]() { effects += 1; return field === 'limitName' ? 'build_work_units' : 4; },
        get toJSON() { effects += 1; return () => original.capacity[field]; },
      };
      const forged = structuredClone(original);
      forged.capacity[field] = impostor;
      await assert.rejects(async () => validate(forged),
        { code: 'CANONICAL_CONTRACT_VIOLATION' });
      assert.equal(effects, 0, `${field} must not execute object hooks`);
    }
  }
});

test('available byte validation stops when the declared budget is exceeded', async () => {
  const ranges = Array.from({ length: 64 }, (_, index) => [index * 2 + 1, index * 2 + 1, 0]);
  const payload = {
    sessionIds: ['s'],
    files: Array.from({ length: 64 }, (_, index) => [`f${index}.jsonl`, ranges]),
  };
  const ownerIndex = {
    schemaVersion: 2, sourceKind: 'codex', status: 'available',
    encoding: 'codex-line-ranges-v1', budgetProfile: trustedPolicy().name,
    entryCount: 4096, ambiguousLineCount: 0, rangeCount: 1,
    accountedBytes: 64, payload,
  };
  assert.throws(() => validateCanonicalLegacyRawOwnerIndex(ownerIndex, 'codex'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
  let checkpoints = 0;
  await assert.rejects(validateCanonicalLegacyRawOwnerIndexForCommit(ownerIndex, 'codex', {
    policy: trustedPolicy({ chunkSize: 1 }),
    onChunk() { checkpoints += 1; },
  }), { code: 'CANONICAL_CONTRACT_VIOLATION' });
  assert.ok(checkpoints <= 64, `64 declared bytes consumed ${checkpoints} checkpoints`);
});

test('capacity exhaustion does not bypass dictionary string integrity', async () => {
  const policy = trustedPolicy({ buildWorkUnits: 3 });
  for (const first of [null, session('first', 'first.jsonl', [1, 3])]) {
    for (const field of ['id', 'file']) {
      const builder = createCodexLegacyRawOwnerBuilder({ policy });
      try {
        if (first) await builder.observeSession(first);
        const tooLong = 'a'.repeat(policy.dictionaryStringBytes + 1);
        const bad = field === 'id'
          ? session(tooLong, 'later.jsonl', [1])
          : session('later', tooLong, [1]);
        await assert.rejects(builder.observeSession(bad),
          { code: 'CANONICAL_CONTRACT_VIOLATION' });
      } finally {
        builder.dispose();
      }
    }
  }
});

test('endpoint preparation and output statistics yield in bounded batches', async () => {
  const count = 20_001;
  const builder = createCodexLegacyRawOwnerBuilder();
  await builder.observeSession({
    ...session('s', 'fixture.jsonl', []),
    lineCount: count * 2,
    rawEvents: {
      *[Symbol.iterator]() {
        for (let index = 0; index < count; index += 1) {
          yield claim('s', 'fixture.jsonl', index * 2 + 1);
        }
      },
    },
  });
  const original = globalThis.BigInt;
  let calls = 0;
  let callsAtFirstEndpointCheckpoint;
  const phases = new Set();
  globalThis.BigInt = function countedBigInt(value) { calls += 1; return original(value); };
  try {
    await builder.finish({ onChunk({ phase }) {
      phases.add(phase);
      if (phase === 'legacy_raw_endpoint_build') callsAtFirstEndpointCheckpoint ??= calls;
    } });
  } finally {
    globalThis.BigInt = original;
    builder.dispose();
  }
  assert.ok(callsAtFirstEndpointCheckpoint <= 4096,
    `first endpoint checkpoint followed ${callsAtFirstEndpointCheckpoint} conversions`);
  assert.ok(phases.has('legacy_raw_range_stats'));
});

test('dictionary sorting and commit fact preparation expose cancellation checkpoints', async () => {
  const builder = createCodexLegacyRawOwnerBuilder();
  try {
    for (let index = 0; index < 4_097; index += 1) {
      await builder.observeSession(session(`session-${index}`, `file-${index}.jsonl`, [1]));
    }
    const phases = new Set();
    const result = await builder.finish({ onChunk({ phase }) { phases.add(phase); } });
    assert.equal(result.status, 'available');
    for (const phase of [
      'legacy_raw_session_dictionary_collect', 'legacy_raw_session_dictionary_sort',
      'legacy_raw_session_dictionary_merge', 'legacy_raw_session_dictionary_remap',
      'legacy_raw_file_dictionary_collect', 'legacy_raw_file_dictionary_sort',
      'legacy_raw_file_dictionary_merge',
    ]) assert.ok(phases.has(phase), phase);
  } finally {
    builder.dispose();
  }

  const index = await buildSourceBackedIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: path.join(__dirname, 'fixtures', 'codex-home'),
  });
  const phases = new Set();
  await validateIndexOwnershipForCommit(index, {
    legacyRawOwnerPolicyForTests: trustedPolicy({ chunkSize: 1 }),
    onChunk({ phase }) { phases.add(phase); },
  });
  for (const phase of ['legacy_raw_session_ids', 'legacy_raw_session_facts',
    'legacy_raw_semantics', 'legacy_raw_fingerprint_capture',
    'legacy_raw_fingerprint_recheck']) assert.ok(phases.has(phase), phase);
});

test('deferred v2 commit skips the synchronous legacy Session ID Set', async () => {
  const index = await buildSourceBackedIndex({
    repoRoot: 'G:\\vibe\\term-agent',
    codexHome: path.join(__dirname, 'fixtures', 'codex-home'),
  });
  const originalKeys = Map.prototype.keys;
  let targetKeyIterations = 0;
  let callsAtFirstAsyncIdCheckpoint;
  Map.prototype.keys = function countedKeys() {
    if (this === index.sessionsById) targetKeyIterations += 1;
    return originalKeys.call(this);
  };
  try {
    await validateIndexOwnershipForCommit(index, {
      legacyRawOwnerPolicyForTests: trustedPolicy({ chunkSize: 1 }),
      onChunk({ phase }) {
        if (phase === 'legacy_raw_session_ids') {
          callsAtFirstAsyncIdCheckpoint ??= targetKeyIterations;
        }
      },
    });
    // Core ProjectQueryStore validation uses keys once; the deferred v2 path
    // must next reach the async Session ID preparation without a legacy Set.
    assert.equal(callsAtFirstAsyncIdCheckpoint, 2);
    const beforeSync = targetKeyIterations;
    validateIndexOwnership(index);
    assert.equal(targetKeyIterations - beforeSync, 2,
      'the synchronous reader retains its ProjectQueryStore and legacy Set iterations');
  } finally {
    Map.prototype.keys = originalKeys;
  }
});

test('semantic validation normalizes each Session file once across sparse ranges', async () => {
  const file = `${'路径😀'.repeat(1_000)}.jsonl`;
  const lines = Array.from({ length: 1_000 }, (_, index) => index * 2 + 1);
  const owners = await build([session('s', file, lines, 2_000)]);
  const fsPath = require('../src/shared/fs-path');
  const codecPath = require.resolve('../src/codex-legacy-raw-owners');
  const originalCodec = require.cache[codecPath];
  const originalNormalize = fsPath.normalizeFsPath;
  let normalizationCalls = 0;
  let instrumentedCodec;
  try {
    fsPath.normalizeFsPath = (value) => {
      normalizationCalls += 1;
      return originalNormalize(value);
    };
    delete require.cache[codecPath];
    instrumentedCodec = require(codecPath);
  } finally {
    fsPath.normalizeFsPath = originalNormalize;
    require.cache[codecPath] = originalCodec;
  }
  await instrumentedCodec.validateCodexV2ForCommit(owners, new Set(['s']),
    new Map([['s', { sourceFile: file, lineCount: 2_000, rawEventCount: lines.length }]]));
  assert.equal(normalizationCalls, 2,
    'one Session fact and one file dictionary check; no per-range normalization');
});

test('v2 semantic validation rejects forged ownership and malformed containers', async () => {
  const owners = await build([session('s', 'f.jsonl', [1, 2, 4])]);
  const ids = new Set(['s']);
  const facts = new Map([['s', {
    sourceFile: 'f.jsonl', lineCount: 4, acceptedBytes: 100, rawEventCount: 3,
  }]]);
  const invalidFacts = [
    new Map([['s', { ...facts.get('s'), sourceFile: 'other.jsonl' }]]),
    new Map([['s', { ...facts.get('s'), acceptedBytes: 3 }]]),
    new Map([['s', { ...facts.get('s'), rawEventCount: 2 }]]),
  ];
  for (const altered of invalidFacts) {
    assert.throws(() => validateCodexV2(owners, ids, altered),
      { code: 'CANONICAL_CONTRACT_VIOLATION' });
  }
  assert.throws(() => validateCodexV2(owners, new Set(), facts),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
  for (const range of [[1, 2, -2], [1.5, 2, 0], [1, Number.MAX_SAFE_INTEGER + 1, 0]]) {
    const bad = structuredClone(owners);
    bad.payload.files[0][1][0] = range;
    assert.throws(() => validateCanonicalLegacyRawOwnerIndex(bad, 'codex'),
      { code: 'CANONICAL_CONTRACT_VIOLATION' });
  }
  const accessor = structuredClone(owners);
  Object.defineProperty(accessor.payload, 'files', {
    enumerable: true, get() { throw new Error('getter must not execute'); },
  });
  assert.throws(() => validateCanonicalLegacyRawOwnerIndex(accessor, 'codex'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
  const sparse = structuredClone(owners);
  delete sparse.payload.files[0];
  assert.throws(() => validateCanonicalLegacyRawOwnerIndex(sparse, 'codex'),
    { code: 'CANONICAL_CONTRACT_VIOLATION' });
});

test('cancelled collection, finalization and commit validation stay AbortError', async () => {
  const many = session('cancel', 'cancel.jsonl', Array.from({ length: 10_000 }, (_, index) => index * 2 + 1), 20_000);
  const collecting = new AbortController();
  const collectBuilder = createCodexLegacyRawOwnerBuilder();
  await assert.rejects(collectBuilder.observeSession(many, {
    signal: collecting.signal,
    onChunk({ phase }) { if (phase === 'legacy_raw_collect') collecting.abort(); },
  }), { name: 'AbortError' });
  collectBuilder.dispose();

  const finishBuilder = createCodexLegacyRawOwnerBuilder();
  await finishBuilder.observeSession(many);
  const finalizing = new AbortController();
  await assert.rejects(finishBuilder.finish({
    signal: finalizing.signal,
    onChunk({ phase }) { if (phase === 'legacy_raw_sweep') finalizing.abort(); },
  }), { name: 'AbortError' });
  assert.equal(finishBuilder.budgetSnapshot().units, 0);
  finishBuilder.dispose();

  const owners = await build([many]);
  const validating = new AbortController();
  await assert.rejects(validateCanonicalLegacyRawOwnerIndexForCommit(owners, 'codex', {
    signal: validating.signal,
    onChunk({ phase }) { if (phase === 'legacy_raw_payload_bytes') validating.abort(); },
  }), { name: 'AbortError' });
});

test('more than one million contiguous owners remain available', async () => {
  const count = 1_000_001;
  const rawEvents = {
    *[Symbol.iterator]() {
      for (let line = 1; line <= count; line += 1) yield claim('long', 'long.jsonl', line);
    },
  };
  const owners = await build([{
    id: 'long', sourceKind: 'codex', sourceFile: 'long.jsonl',
    lineCount: count, rawEvents,
  }]);
  assert.equal(owners.status, 'available');
  assert.equal(owners.entryCount, count);
  assert.equal(owners.rangeCount, 1);
  assert.equal(owners.payload.files[0][0], normalizeFsPath('long.jsonl'));
  validateCanonicalLegacyRawOwnerIndex(owners, 'codex');
});

test('prior sparse and many-file owner boundaries remain available', async () => {
  const sparseCount = 500_001;
  const sparse = await build([{
    id: 'sparse', sourceKind: 'codex', sourceFile: 'sparse.jsonl',
    lineCount: sparseCount * 2,
    rawEvents: {
      *[Symbol.iterator]() {
        for (let index = 0; index < sparseCount; index += 1) {
          yield claim('sparse', 'sparse.jsonl', index * 2 + 1);
        }
      },
    },
  }]);
  assert.equal(sparse.status, 'available');
  assert.equal(sparse.entryCount, sparseCount);
  assert.equal(sparse.rangeCount, sparseCount);

  const many = Array.from({ length: 50_000 }, (_, index) => {
    const id = `session-${index}`;
    const file = `file-${index}.jsonl`;
    return session(id, file, Array.from({ length: 20 }, (_, offset) => offset + 1));
  });
  const owners = await build(many);
  assert.equal(owners.status, 'available');
  assert.equal(owners.entryCount, 1_000_000);
  assert.equal(owners.rangeCount, 50_000);
  assert.equal(owners.payload.files.length, 50_000);
  validateCanonicalLegacyRawOwnerIndex(owners, 'codex');
});

test('HTTP job retains core reading when only legacy file/line lookup exhausts capacity', async () => {
  const policy = trustedPolicy({ buildWorkUnits: 3 });
  const codexHome = path.join(__dirname, 'fixtures', 'codex-home');
  const repoRoot = 'G:\\vibe\\term-agent';
  const sessionId = '11111111-1111-1111-1111-111111111111';
  let builtIndex = null;
  let materializations = 0;
  const server = createServer(null, 0, {
    source: 'codex', codexHome, legacyRawOwnerPolicyForTests: policy,
    sessionPrewarm: false,
    async buildIndex(context) {
      builtIndex = await buildSourceBackedIndex({
        ...context,
        codexHome: context.sourceHome,
        legacyRawOwnerPolicyForTests: policy,
        onLegacyRawCapacity() { throw new Error('diagnostic callback failed'); },
      });
      return builtIndex;
    },
    async materializeSession(...args) {
      materializations += 1;
      return materializeSessionForIndex(...args);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const selected = await fetch(`${base}/api/project`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot }),
    });
    assert.equal(selected.status, 202);
    const { job } = await selected.json();
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await (await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(job.id)}`)).json();
      if (['succeeded', 'failed', 'cancelled'].includes(status.job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(status.job.status, 'succeeded', status.job.error);
    assert.equal(status.state.capabilities.legacyRawLookup.status, 'unavailable');
    assert.equal(status.state.indexDiagnostics.legacyRawLookup.code, 'LEGACY_RAW_LOOKUP_CAPACITY_EXCEEDED');
    assert.equal(status.state.totals.sessionCount, 10);
    assert.equal(builtIndex.legacyRawOwners.status, 'unavailable');
    const sessions = await fetch(`${base}/api/sessions`);
    assert.equal(sessions.status, 200);
    assert.equal((await sessions.json()).total, 10);
    const search = await fetch(`${base}/api/sessions?q=alpha`);
    assert.equal(search.status, 200);
    assert.equal((await search.json()).total, 1);
    const timeline = await fetch(`${base}/api/sessions/${sessionId}/timeline`);
    assert.equal(timeline.status, 200);
    const timelineBody = await timeline.json();
    const eventId = timelineBody.events[0].id;
    const detail = await fetch(`${base}/api/sessions/${sessionId}/events/${encodeURIComponent(eventId)}/detail?layer=main`);
    assert.equal(detail.status, 200);
    const explicit = await fetch(`${base}/api/sessions/${sessionId}/raw/${encodeURIComponent(`${sessionId}:raw:1`)}`);
    assert.equal(explicit.status, 200);
    const indexed = builtIndex.sessionsById.get(sessionId);
    const beforeLegacy = materializations;
    const legacy = await fetch(`${base}/api/raw?file=${encodeURIComponent(indexed.sourceFile)}&line=1`);
    assert.equal(legacy.status, 409);
    assert.deepEqual(await legacy.json(), {
      error: 'Legacy file/line lookup is unavailable for this index',
      code: 'LEGACY_RAW_LOOKUP_UNAVAILABLE',
      indexRevision: 1,
      reason: 'capacity_exceeded',
      retryable: false,
    });
    assert.equal(materializations, beforeLegacy);
    const invalid = await fetch(`${base}/api/raw?file=${encodeURIComponent(indexed.sourceFile)}&line=9007199254740992`);
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('synthetic JSONL blanks and provisional Raw identity survive indexing and HTTP reading', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'legacy-raw-physical-lines-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const provisionalId = '11111111-2222-3333-4444-555555555555';
  const finalId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const directory = path.join(codexHome, 'sessions', '2026', '08', '12');
  const file = path.join(directory, `rollout-${provisionalId}.jsonl`);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const row = (text) => ({
    type: 'event_msg', timestamp: '2026-08-12T00:00:01.000Z',
    payload: { type: 'user_message', message: text },
  });
  const metadata = {
    type: 'session_meta', timestamp: '2026-08-12T00:00:02.000Z',
    payload: { id: finalId, cwd: repoRoot },
  };
  await fsp.writeFile(file,
    `${JSON.stringify(row('before metadata'))}\n\n${JSON.stringify(metadata)}\n\n${JSON.stringify(row('after metadata'))}\n`,
    'utf8');
  const index = await buildSourceBackedIndex({ repoRoot, codexHome });
  const indexed = index.sessionsById.get(finalId);
  assert.ok(indexed);
  assert.equal(indexed.lineCount, 3);
  assert.equal(index.legacyRawOwners.status, 'available');
  assert.equal(index.legacyRawOwners.entryCount, 2);
  const materialized = await materializeSessionForIndex(index, indexed);
  const preMetadataRaw = materialized.rawEvents.find((raw) => raw.source.line === 1);
  const afterMetadataRaw = materialized.rawEvents.find((raw) => raw.source.line === 5);
  assert.equal(preMetadataRaw.rawId, `${provisionalId}:raw:1`);
  assert.equal(afterMetadataRaw.rawId, `${finalId}:raw:5`);
  const locatorFile = afterMetadataRaw.source.file;
  assert.equal(resolveCodexV2(index, locatorFile, 5)?.rawIdHint, afterMetadataRaw.rawId);
  const server = createServer(index, 0, { codexHome });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const timeline = await fetch(`${base}/api/sessions/${finalId}/timeline`);
    assert.equal(timeline.status, 200);
    const events = (await timeline.json()).events;
    assert.ok(events.length > 0);
    const detail = await fetch(`${base}/api/sessions/${finalId}/events/${encodeURIComponent(events[0].id)}/detail?layer=main`);
    assert.equal(detail.status, 200);
    const explicitPre = await fetch(`${base}/api/sessions/${finalId}/raw/${encodeURIComponent(preMetadataRaw.rawId)}`);
    assert.equal(explicitPre.status, 200);
    const explicitAfter = await fetch(`${base}/api/sessions/${finalId}/raw/${encodeURIComponent(afterMetadataRaw.rawId)}`);
    assert.equal(explicitAfter.status, 200);
    for (const line of [1, 2, 4]) {
      const missing = await fetch(`${base}/api/raw?file=${encodeURIComponent(locatorFile)}&line=${line}`);
      assert.equal(missing.status, 404, `physical line ${line} must be a legacy lookup hole`);
    }
    const legacyAfter = await fetch(`${base}/api/raw?file=${encodeURIComponent(locatorFile)}&line=5`);
    assert.equal(legacyAfter.status, 200);
    const legacyBody = await legacyAfter.json();
    assert.equal(legacyBody.line, 5);
    assert.equal(legacyBody.file, locatorFile);
    assert.equal(legacyBody.parsed.payload.message, 'after metadata');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('revisions can lose and regain only the legacy lookup capability', async () => {
  const policy = trustedPolicy({ buildWorkUnits: 50 });
  const codexHome = path.join(__dirname, 'fixtures', 'codex-home');
  const repoRoot = 'G:\\vibe\\term-agent';
  const available = await buildSourceBackedIndex({ repoRoot, codexHome });
  const limited = await buildSourceBackedIndex({
    repoRoot, codexHome, legacyRawOwnerPolicyForTests: policy,
  });
  assert.equal(available.legacyRawOwners.status, 'available');
  assert.equal(limited.legacyRawOwners.status, 'unavailable');
  let candidate = limited;
  const server = createServer(available, 0, {
    codexHome, legacyRawOwnerPolicyForTests: policy,
    buildIndex: async () => candidate,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const install = async () => {
    const selected = await fetch(`${base}/api/project`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot }),
    });
    assert.equal(selected.status, 202);
    const { job } = await selected.json();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fetch(`${base}/api/project/status?jobId=${encodeURIComponent(job.id)}`);
      const status = await response.json();
      if (['succeeded', 'failed', 'cancelled'].includes(status.job.status)) return status;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('project job did not settle');
  };
  try {
    assert.equal((await (await fetch(`${base}/api/state`)).json()).capabilities.legacyRawLookup.status, 'available');
    let status = await install();
    assert.equal(status.job.status, 'succeeded', status.job.error);
    assert.equal(status.state.capabilities.legacyRawLookup.status, 'unavailable');
    assert.equal(status.state.indexRevision, 2);
    candidate = available;
    status = await install();
    assert.equal(status.job.status, 'succeeded', status.job.error);
    assert.equal(status.state.capabilities.legacyRawLookup.status, 'available');
    assert.equal(status.state.indexRevision, 3);
    candidate = {
      ...available,
      legacyRawOwners: {
        ...available.legacyRawOwners,
        accountedBytes: available.legacyRawOwners.accountedBytes + 1,
      },
    };
    status = await install();
    assert.equal(status.job.status, 'failed');
    const current = await (await fetch(`${base}/api/state`)).json();
    assert.equal(current.indexRevision, 3);
    assert.equal(current.capabilities.legacyRawLookup.status, 'available');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('async legacy commit validator rejects every thrown value', async () => {
  const codexHome = path.join(__dirname, 'fixtures', 'codex-home');
  const index = await buildSourceBackedIndex({ repoRoot: 'G:\\vibe\\term-agent', codexHome });
  const adapter = getSourceAdapter('codex');
  for (const reason of [undefined, null, false, 0]) {
    await assert.rejects(validateIndexOwnershipForCommit(index, {
      adapter: {
        ...adapter,
        async validateLegacyRawOwnerIndexForCommit() { throw reason; },
      },
    }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  }
  await assert.rejects(validateIndexOwnershipForCommit(index, {
    adapter: {
      ...adapter,
      async validateLegacyRawOwnerIndexForCommit({ sessionFacts }) {
        sessionFacts.clear();
      },
    },
  }), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });

  const controller = new AbortController();
  await assert.rejects(validateIndexOwnershipForCommit(index, {
    signal: controller.signal,
    onChunk({ phase }) {
      if (phase === 'legacy_raw_fingerprint_capture') controller.abort();
    },
  }), { name: 'AbortError' });
});
