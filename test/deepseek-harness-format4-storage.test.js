'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zstdCompressSync } = require('node:zlib');
const storage = require('../src/deepseek-harness-storage');

// Synthetic records derived from the pinned 0.1.7-rc.2 v4 codec contract.
const header = (overrides = {}) => ({
  type: 'session', version: 4, id: 'synthetic-format-4', createdAt: 1700000000000,
  cwd: '/synthetic/project', isSeeded: false, delegationDepth: 0, ...overrides,
});
const event = (overrides = {}) => ({
  type: 'synthetic/event', seq: 8, time: 1700000000001, data: {}, ...overrides,
});
const line = (value) => `${JSON.stringify(value)}\n`;
const invalid = { code: 'DEEPSEEK_STORAGE_INVALID' };

async function temporaryDirectory(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-format4-storage-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('canonical generation names distinguish versions and physical encodings', () => {
  for (const [name, version, compression] of [
    ['session.jsonl', 0, 'none'], ['session.jsonl.zstd', 0, 'zstd'],
    ['session.v4.jsonl', 4, 'none'], ['session.v4.jsonl.zstd', 4, 'zstd'],
    ['session.v100.jsonl', 100, 'none'],
  ]) {
    assert.deepEqual(storage.parseSessionArtifactName(name), { version, compression });
    assert.equal(storage.compressionForArtifact(name), compression);
  }
  for (const name of ['session.v0.jsonl', 'session.v04.jsonl', 'session.V4.jsonl',
    'Session.v4.jsonl', 'session.v4.jsonl.tmp', 'session.v4.jsonl.zstd.tmp',
    'session.v-4.jsonl', 'session.v9007199254740992.jsonl']) {
    assert.equal(storage.parseSessionArtifactName(name), null, name);
    assert.throws(() => storage.compressionForArtifact(name), invalid);
  }
});

test('v4 header preserves isSeeded and checks the generation while legacy v0 stays supported', () => {
  const seeded = header({ isSeeded: true, parentSession: 'synthetic-parent' });
  const { type, ...expected } = seeded;
  assert.deepEqual(storage.parseHeaderText(line(seeded), 4), expected);
  assert.throws(() => storage.parseHeaderText(line(seeded), 0), invalid);
  const legacy = header({ version: 0, seedLength: 2 });
  delete legacy.isSeeded;
  assert.equal(storage.parseHeaderText(line(legacy), 0).seedLength, 2);
  for (const version of [1, 2, 3, 5]) {
    assert.throws(() => storage.parseHeaderText(line(header({ version }))), {
      code: 'DEEPSEEK_FORMAT_VERSION_UNSUPPORTED',
    });
  }
});

test('v4 rejects missing or mistyped seed ownership and stale physical header fields', () => {
  for (const overrides of [{ isSeeded: undefined }, { isSeeded: 0 }, { seedLength: 2 },
    { sandboxMode: 'workspace-write' }, { approvalPolicy: 'never' }, { extra: true }, { cwd: 'relative/project' }]) {
    assert.throws(() => storage.parseHeaderText(line(header(overrides))), invalid);
  }
  assert.equal(storage.parseHeaderText(line(header({ cwd: 'C:\\synthetic\\project' }))).cwd, 'C:\\synthetic\\project');
});

test('v4 source references retain inclusive ranges without altering physical Raw data', () => {
  const physical = event({ sourceEventSeqs: [0, [2, 4], 6], surfaceOp: { op: 'replace', startSeq: 2, endSeq: 5 } });
  const before = JSON.stringify(physical);
  const decoded = storage.decodeStorageRecord(physical, 4);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].sourceEventSeqs, [0, [2, 4], 6]);
  assert.equal(storage.sourceEventSeqsMatch(decoded[0].sourceEventSeqs, [6, 2, 0, 4, 3]), true);
  assert.equal(decoded[0].seq, physical.seq);
  assert.equal(decoded[0].data, physical.data);
  assert.equal(JSON.stringify(physical), before);
  assert.deepEqual(storage.decodeSessionEventRecord(event({ sourceEventSeqs: [5, 0, 3] }), 4).sourceEventSeqs,
    [5, 0, 3]);
  assert.equal(storage.decodeSessionEventRecord(physical, 0), physical);
});

test('source-reference matching is exact without expanding ranges or sorting scalar history', () => {
  for (const refs of [[0, [2, 4], 6], [6, 4, 0, 3, 2]]) {
    const decoded = storage.decodeSessionEventRecord(event({ sourceEventSeqs: refs }), 4);
    for (const [expected, matches] of [[[6, 2, 0, 4, 3], true], [[0, 2, 3, 4], false],
      [[0, 2, 3, 4, 5], false], [[0, 2, 3, 4, 4], false], [[0, 2, 3, 4, '6'], false]]) {
      assert.equal(storage.sourceEventSeqsMatch(decoded.sourceEventSeqs, expected), matches);
    }
    assert.deepEqual(decoded.sourceEventSeqs, refs);
  }
  assert.equal(storage.sourceEventSeqsMatch(undefined, []), false);
  assert.equal(storage.sourceEventSeqsMatch([], []), true);
  assert.equal(storage.sourceEventSeqsMatch([[3, 3]], [3]), true);
  assert.equal(storage.sourceEventSeqsMatch([[3, 4]], [3]), false);
  assert.equal(storage.sourceEventSeqsMatch([3], [3]), true); // Legacy singleton.
});

test('one large source range retains only its encoded endpoints', () => {
  const physical = event({ seq: 1000000, sourceEventSeqs: [[0, 999999]] });
  const decoded = storage.decodeSessionEventRecord(physical, 4);
  assert.equal(decoded.sourceEventSeqs.length, 1);
  assert.deepEqual(decoded.sourceEventSeqs, [[0, 999999]]);
  assert.equal(storage.sourceEventSeqsMatch(decoded.sourceEventSeqs, [0, 999999]), false);
  const max = Number.MAX_SAFE_INTEGER;
  const safeBoundary = storage.decodeSessionEventRecord(event({ seq: max, sourceEventSeqs: [[0, max - 1]] }), 4);
  assert.deepEqual(safeBoundary.sourceEventSeqs, [[0, max - 1]]);
  assert.equal(storage.sourceEventSeqsMatch(safeBoundary.sourceEventSeqs, [0]), false);
  assert.throws(() => storage.decodeSessionEventRecord(event({ seq: max, sourceEventSeqs: [[0, max]] }), 4), invalid);
});

test('compact source-reference validation agrees with the prior expanded contract on small inputs', () => {
  // Independent small-domain oracle: expansion is intentional only in this
  // test, to protect acceptance equivalence including unordered scalar lists.
  function oracle(refs, seq) {
    const count = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
    if (!Array.isArray(refs)) return null;
    const values = [];
    let hasRange = false;
    for (const entry of refs) {
      if (!Array.isArray(entry)) {
        if (!count(entry) || entry >= seq) return null;
        values.push(entry);
      } else {
        if (entry.length !== 2 || !entry.every(count)) return null;
        const [start, end] = entry;
        if (start > end || end >= seq || end - start + 1 > seq - values.length) return null;
        for (let i = start; i <= end; i += 1) values.push(i);
        hasRange = true;
      }
    }
    if (new Set(values).size !== values.length) return null;
    if (hasRange && values.some((n, i) => i && n <= values[i - 1])) return null;
    return values;
  }
  const entries = [-0, -1, 0, 1, 3, 5, 1.5, null, '1', [], [0], [0, 0], [0, 2], [2, 4], [4, 3], [0, 5]];
  const cases = [[], ...entries.map(a => [a])];
  for (const a of entries) for (const b of entries) cases.push([a, b]);
  for (const a of entries) for (const b of entries) for (const c of entries) cases.push([a, b, c]);
  for (const refs of cases) {
    const expected = oracle(refs, 5);
    const physical = event({ seq: 5, sourceEventSeqs: refs });
    if (expected === null) assert.throws(() => storage.decodeSessionEventRecord(physical, 4), invalid);
    else {
      const decoded = storage.decodeSessionEventRecord(physical, 4);
      assert.deepEqual(decoded.sourceEventSeqs, refs);
      assert.equal(storage.sourceEventSeqsMatch(decoded.sourceEventSeqs, expected), true);
      assert.equal(storage.sourceEventSeqsMatch(decoded.sourceEventSeqs, [...expected].reverse()), true);
    }
  }
});

test('v4 rejects malformed source references and retired or malformed physical envelopes', () => {
  for (const sourceEventSeqs of [null, {}, [8], [-1], [-0], [1.5], [0, 0], [[1]],
    [[2, 1]], [[1, 8]], [[0, 2], 1], [4, [0, 2]], [[0, 2], [2, 4]]]) {
    assert.throws(() => storage.decodeStorageRecord(event({ sourceEventSeqs }), 4), invalid);
  }
  for (const overrides of [{ time: 'now' }, { seq: -0 }, { data: undefined },
    { ignorable: false }, { extra: true }, { type: 'assistant/chunk' }]) {
    const physical = JSON.parse(JSON.stringify(event(overrides)));
    // JSON canonicalizes -0; preserve it for this in-memory codec test.
    if (Object.is(overrides.seq, -0)) physical.seq = -0;
    assert.throws(() => storage.decodeStorageRecord(physical, 4), invalid);
  }
  assert.throws(() => storage.decodeStorageRecord({ type: 'text-chunks', seq0: 0, time0: 1, data: {} }, 4), invalid);
});

test('v4 refuses retired syntax in interpreted slots while preserving opaque extensions', () => {
  const wrapper = { type: 'tool-result', toolCallId: 'synthetic-call', content: [] };
  const cases = [
    { type: 'tool/code-dispatch-start' }, { type: 'tool/code-dispatch' },
    { type: 'request/header', data: { header: { system: 'retired' } } },
    { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'runtime-context' }, content: [] } },
    { type: 'system/message', data: { message: { content: [wrapper] } } },
    { type: 'assistant/message', data: { message: { content: [wrapper] } } },
    { type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'plugin' }, content: [] }] } },
    { type: 'compaction/summary', data: { rawOutput: [wrapper] } },
    { type: 'tool/ptc-dispatch', data: { content: [wrapper] } },
    { type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'block-end', block: wrapper } }] } },
    { type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'block-start', blockType: 'tool-result' } }] } },
  ];
  for (const overrides of cases) {
    assert.throws(() => storage.decodeSessionEventRecord(event(overrides), 4), invalid);
    assert.equal(storage.decodeSessionEventRecord(event(overrides), 0).type, overrides.type);
  }
  for (const overrides of [
    { type: 'tool/code-dispatch', ignorable: true },
    { type: 'request/header', data: { header: { tools: [{ parameters: { system: 'opaque', content: [wrapper] } }] } } },
    { type: 'tool/call', data: { arguments: { source: { kind: 'plugin' }, content: [wrapper] } } },
    { type: 'user/message', data: { source: { kind: 'plugin:custom-producer' }, content: [{ type: 'custom', payload: wrapper }] } },
  ]) {
    assert.equal(storage.decodeSessionEventRecord(event(overrides), 4).type, overrides.type);
  }
});

test('v4 surface endpoints are independently earlier, unlike numeric source-reference ranges', () => {
  const physical = event({ seq: 9, surfaceOp: { op: 'replace', startSeq: 5, endSeq: 2 } });
  assert.equal(storage.decodeSessionEventRecord(physical, 4), physical);
  for (const [startSeq, endSeq] of [[9, 2], [5, 9], [10, 2], [5, 10], [-1, 2], [5, -1]]) {
    assert.throws(() => storage.decodeSessionEventRecord({ ...physical, surfaceOp: { op: 'replace', startSeq, endSeq } }, 4), invalid);
  }
  assert.throws(() => storage.decodeSessionEventRecord({ ...physical, sourceEventSeqs: [[5, 2]] }, 4), invalid);
});

test('v4 native tool-result admission prevents legacy wrappers and contradictory call or error identities', () => {
  const message = {
    id: 'result-1', role: 'tool', toolCallId: 'call-1', source: { kind: 'tool', callId: 'call-1' },
    content: [{ type: 'text', text: 'synthetic result' }],
  };
  const physical = event({ type: 'tool/result', data: { message } });
  assert.equal(storage.decodeSessionEventRecord(physical, 4), physical);
  for (const change of [
    { role: 'user' }, { id: '' }, { toolCallId: 'other-call' },
    { source: { kind: 'tool', callId: 'other-call' } }, { isError: 'false' },
    { content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
  ]) {
    assert.throws(() => storage.decodeSessionEventRecord({ ...physical, data: { message: { ...message, ...change } } }, 4), invalid);
  }
  assert.throws(() => storage.decodeSessionEventRecord({ ...physical, data: { message, error: {} } }, 4), invalid);
  assert.equal(storage.decodeSessionEventRecord({ ...physical, data: { message: { ...message, isError: true }, error: {} } }, 4).type,
    'tool/result');
});

for (const compression of ['none', 'zstd']) {
  test(`v4 ${compression} header and Raw reads retain exact physical records`, {
    skip: compression === 'zstd' && typeof zstdCompressSync !== 'function',
  }, async (t) => {
    const directory = await temporaryDirectory(t);
    const filename = path.join(directory, `session.v4.jsonl${compression === 'zstd' ? '.zstd' : ''}`);
    const records = [line(header()), line(event({ seq: 0 })), line(event({ seq: 1, sourceEventSeqs: [0] }))];
    const bytes = compression === 'zstd'
      ? Buffer.concat(records.map((text) => zstdCompressSync(Buffer.from(text))))
      : Buffer.from(records.join(''));
    await fsp.writeFile(filename, bytes);
    assert.equal((await storage.readSessionHeader(filename)).version, 4);
    const read = await storage.readCommittedArtifactPrefix(filename, compression);
    assert.deepEqual(read.prefix.recordTexts, records.map((text) => text.trimEnd()));
    const accepted = { fileIdentity: read.fileIdentity, acceptedBytes: bytes.length, digest: storage.hashBuffer(bytes) };
    assert.equal((await storage.readPhysicalRecordText(filename, compression, 2, undefined, accepted)).recordText,
      records[2].trimEnd());
    const mismatched = path.join(directory, `session.jsonl${compression === 'zstd' ? '.zstd' : ''}`);
    await fsp.writeFile(mismatched, bytes);
    await assert.rejects(storage.readSessionHeader(mismatched), invalid);
  });
}

for (const successor of ['session.v4.jsonl', 'session.v5.jsonl', 'session.jsonl.zstd']) {
  test(`accepted predecessor becomes stale when ${successor} appears unchanged alongside it`, async (t) => {
    const directory = await temporaryDirectory(t);
    const filename = path.join(directory, 'session.jsonl');
    const legacyHeader = header({ version: 0 });
    delete legacyHeader.isSeeded;
    const bytes = Buffer.from(line(legacyHeader));
    await fsp.writeFile(filename, bytes);
    const read = await storage.readCommittedArtifactPrefix(filename, 'none');
    const accepted = { fileIdentity: read.fileIdentity, acceptedBytes: bytes.length, digest: storage.hashBuffer(bytes) };
    await storage.readCommittedArtifactPrefix(filename, 'none', undefined, accepted);
    await fsp.writeFile(path.join(directory, successor), 'new canonical artifact');
    assert.equal(storage.hashBuffer(await fsp.readFile(filename)), accepted.digest);
    await assert.rejects(storage.readCommittedArtifactPrefix(filename, 'none', undefined, accepted), {
      code: 'INDEXED_SOURCE_STALE', statusCode: 409,
    });
    await assert.rejects(storage.readPhysicalRecordText(filename, 'none', 0, undefined, accepted), {
      code: 'INDEXED_SOURCE_STALE',
    });
  });
}

test('accepted newest generation tolerates historical encodings and temporary successors', async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = path.join(directory, 'session.v4.jsonl');
  const bytes = Buffer.from(line(header()));
  await fsp.writeFile(filename, bytes);
  const read = await storage.readCommittedArtifactPrefix(filename, 'none');
  const accepted = { fileIdentity: read.fileIdentity, acceptedBytes: bytes.length, digest: storage.hashBuffer(bytes) };
  for (const name of ['session.jsonl', 'session.jsonl.zstd', 'session.v5.jsonl.tmp', 'session.v04.jsonl']) {
    await fsp.writeFile(path.join(directory, name), 'ignored');
  }
  await storage.readCommittedArtifactPrefix(filename, 'none', undefined, accepted);
  await fsp.writeFile(path.join(directory, 'session.v4.jsonl.zstd'), 'ambiguous generation');
  await assert.rejects(storage.readCommittedArtifactPrefix(filename, 'none', undefined, accepted), {
    code: 'INDEXED_SOURCE_STALE',
  });
});
