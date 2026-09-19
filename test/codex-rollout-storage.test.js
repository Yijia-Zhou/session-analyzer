'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync, constants: zstdConstants } = require('node:zlib');
const NO_CONTENT_SIZE = { params: { [zstdConstants.ZSTD_c_contentSizeFlag]: 0 } };

const codex = require('../src/codex');
const storage = require('../src/codex-rollout-storage');

async function makeHome(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-zstd-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fsp.mkdir(repoRoot, { recursive: true });
  return { home, repoRoot };
}

function fixtureText(id, cwd) {
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-09-18T10:00:00.000Z',
      payload: { id, cwd },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-18T10:00:01.000Z',
      payload: { type: 'user_message', message: 'Unicode rollout 你好🙂' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-18T10:00:02.000Z',
      payload: { type: 'agent_message', message: 'compressed answer' },
    },
  ];
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function skippableFrame(payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x184D2A50, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

async function collectDecoded(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function writeCompressedRollout(home, id, text) {
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, `rollout-2026-09-18T10-00-00-${id}.jsonl.zst`);
  await fsp.writeFile(file, zstdCompressSync(Buffer.from(text, 'utf8')));
  return file;
}

test('Codex rollout discovery prefers plain siblings and ignores writer scratch files', async (t) => {
  const { home, repoRoot } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const plain = path.join(directory, 'rollout-sibling.jsonl');
  const compressed = `${plain}.zst`;
  await fsp.writeFile(plain, fixtureText('11111111-1111-4111-8111-111111111111', repoRoot));
  await fsp.writeFile(compressed, zstdCompressSync(Buffer.from('not-selected', 'utf8')));
  await fsp.writeFile(`${compressed}.tmp`, zstdCompressSync(Buffer.from('scratch', 'utf8')));
  const compressedOnly = await writeCompressedRollout(
    home,
    '22222222-2222-4222-8222-222222222222',
    fixtureText('22222222-2222-4222-8222-222222222222', repoRoot),
  );

  const files = await storage.collectCodexRolloutFiles(path.join(home, 'sessions'));
  assert.deepEqual(files.map((entry) => entry.physicalPath), [plain, compressedOnly].sort());
  assert.equal(files.find((entry) => entry.logicalPath === plain).compression, 'none');
  assert.equal(files.find((entry) => entry.physicalPath === compressedOnly).compression, 'zstd');
  const index = await codex.buildIndex({ repoRoot, codexHome: home });
  assert.deepEqual(new Set(index.sessions.map((session) => session.id)), new Set([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]));
});

test('Codex rollout resolver rejects paths outside the session root', async (t) => {
  const { home } = await makeHome(t);
  await assert.rejects(
    storage.resolveRolloutArtifact(path.join(home, 'sessions'), '../outside.jsonl'),
    (error) => error.code === storage.CODEX_ROLLOUT_STORAGE_INVALID,
  );
});

test('Zstandard rollout reader joins concatenated unknown-size frames without changing logical bytes', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-multiframe.jsonl.zst');
  const parts = [
    `${JSON.stringify({ message: '第一帧' })}\n`,
    `${JSON.stringify({ message: 'second frame 🙂' })}\n`,
  ];
  const frames = parts.map((part) => zstdCompressSync(Buffer.from(part, 'utf8'), NO_CONTENT_SIZE));
  for (const frame of frames) assert.equal(frame[4] & 0xe0, 0, 'no content-size or single-segment header flags');
  await fsp.writeFile(file, Buffer.concat(frames));
  const descriptor = storage.normalizeArtifactDescriptor(file);
  const chunks = [];
  for await (const chunk of storage.createLogicalReadStream(descriptor)) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString('utf8'), parts.join(''));
});

test('Zstandard reader skips skippable frames without allocating their payload', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-skippable.jsonl.zst');
  const first = Buffer.from('{"message":"before"}\n', 'utf8');
  const second = Buffer.from('{"message":"after"}\n', 'utf8');
  await fsp.writeFile(file, Buffer.concat([
    zstdCompressSync(first, NO_CONTENT_SIZE),
    skippableFrame(Buffer.alloc(180_000, 0x5a)),
    zstdCompressSync(second, NO_CONTENT_SIZE),
  ]));
  const decoded = await collectDecoded(storage.openDecodedStream(
    storage.normalizeArtifactDescriptor(file),
  ));
  assert.equal(decoded.toString('utf8'), Buffer.concat([first, second]).toString('utf8'));
});

test('Zstandard decoder errors before frame completion are contained and classified', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-corrupt-block.jsonl.zst');
  // A structurally valid raw-block frame whose window descriptor exceeds the
  // decoder's configured bound. Native zlib reports this before frame end;
  // the Transform must classify it without an unhandled decoder error.
  const frame = Buffer.concat([
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0xff, 0x19, 0x00, 0x00]),
    Buffer.from('abc', 'utf8'),
  ]);
  await fsp.writeFile(file, frame);
  await assert.rejects(
    collectDecoded(storage.openDecodedStream(storage.normalizeArtifactDescriptor(file))),
    (error) => error.code === storage.CODEX_ROLLOUT_STORAGE_INVALID,
  );
});

test('Zstandard frame parser keeps large compressed blocks bounded across input chunks', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-large-frame.jsonl.zst');
  const payload = crypto.randomBytes(180_000).toString('base64');
  const text = `${JSON.stringify({ payload })}\n`;
  await fsp.writeFile(file, zstdCompressSync(Buffer.from(text, 'utf8'), NO_CONTENT_SIZE));
  const chunks = [];
  for await (const chunk of storage.createLogicalReadStream(storage.normalizeArtifactDescriptor(file))) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString('utf8'), text);
});

test('compressed-only Codex rollouts preserve logical bytes, line refs, and source-backed hydration', async (t) => {
  const { home, repoRoot } = await makeHome(t);
  const id = '33333333-3333-4333-8333-333333333333';
  const text = fixtureText(id, repoRoot);
  const physicalFile = await writeCompressedRollout(home, id, text);
  const index = await codex.__testOnly.buildUncompactedIndexForDetailTests({
    repoRoot,
    codexHome: home,
  });
  const session = index.sessionsById.get(id);
  assert.ok(session);
  assert.equal(session.sourceFile.endsWith('.jsonl'), true);
  assert.equal(session.sourceFile.endsWith('.jsonl.zst'), false);
  assert.equal(session.bytes, Buffer.byteLength(text, 'utf8'));
  assert.deepEqual(session._sourceIdentity.compression, 'zstd');
  assert.equal(session.sourceAbsFile, physicalFile);
  const raw = await codex.readRawLine(index, session.sourceFile, 2);
  assert.equal(raw.line, 2);
  assert.match(raw.raw, /Unicode rollout/);
  assert.equal(raw.parsed.payload.message, 'Unicode rollout 你好🙂');
  const compactIndex = await codex.buildIndex({
    repoRoot,
    codexHome: home,
  });
  const warmIndex = await codex.buildIndex({
    repoRoot,
    codexHome: home,
    previousIndex: compactIndex,
  });
  assert.equal(warmIndex.totals.reusedFileCount, 1);

  const strictIndex = await codex.buildSourceBackedIndex({ repoRoot, codexHome: home });
  const strictSession = strictIndex.sessionsById.get(id);
  assert.ok(strictSession);
  const dependencySet = strictIndex.materializationDependencies.get(
    strictSession.materializationDescriptor.dependencySetId,
  );
  const materialized = await codex.materializeCodexSession({
    materializationContext: strictIndex,
    indexedSession: strictSession,
    dependencySet,
  });
  const hydratedRaw = await codex.readIndexedCodexRawRecord(
    strictIndex,
    materialized,
    materialized.rawEvents[1],
  );
  assert.equal(hydratedRaw.parsed.payload.message, 'Unicode rollout 你好🙂');
  const event = materialized.logicalEvents.find((candidate) => candidate.kind === 'user_message');
  assert.ok(event);
  const detail = await codex.buildHydratedEventDetail(strictIndex, materialized, event.id);
  assert.match(JSON.stringify(detail), /Unicode rollout/);
  assert.equal(
    crypto.createHash('sha256').update(Buffer.from(text)).digest('base64url'),
    dependencySet.entries[0].digest,
  );
  const warmStrictIndex = await codex.buildSourceBackedIndex({
    repoRoot,
    codexHome: home,
    previousIndex: strictIndex,
  });
  assert.equal(warmStrictIndex.totals.reusedFileCount, 1);
});

test('corrupt compressed rollouts are diagnosed and isolated from readable sessions', async (t) => {
  const { home, repoRoot } = await makeHome(t);
  const goodId = '44444444-4444-4444-8444-444444444444';
  await writeCompressedRollout(home, goodId, fixtureText(goodId, repoRoot));
  const badDirectory = path.join(home, 'sessions', '2026', '09', '18');
  const badFile = path.join(badDirectory, 'rollout-2026-09-18T11-00-00-55555555-5555-4555-8555-555555555555.jsonl.zst');
  await fsp.writeFile(badFile, Buffer.from('not a zstandard frame', 'utf8'));
  const diagnostics = [];
  const index = await codex.__testOnly.buildUncompactedIndexForDetailTests({
    repoRoot,
    codexHome: home,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions[0].id, goodId);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.path === badFile));
});

test('truncated Zstandard frames fail with a bounded storage diagnostic', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-truncated.jsonl.zst');
  const frame = zstdCompressSync(Buffer.from('{"message":"truncated"}\n', 'utf8'));
  await fsp.writeFile(file, frame.subarray(0, Math.max(1, frame.length - 2)));
  await assert.rejects(
    (async () => {
      for await (const unused of storage.createLogicalReadStream(storage.normalizeArtifactDescriptor(file))) {
        void unused;
      }
    })(),
    (error) => error.code === storage.CODEX_ROLLOUT_STORAGE_INVALID,
  );
});

test('accepted compressed representation fails closed after plain/compressed conversion', async (t) => {
  const { home, repoRoot } = await makeHome(t);
  const id = '66666666-6666-4666-8666-666666666666';
  const text = fixtureText(id, repoRoot);
  const compressed = await writeCompressedRollout(home, id, text);
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome: home });
  const indexedSession = index.sessionsById.get(id);
  assert.ok(indexedSession);
  const dependencySet = index.materializationDependencies.get(
    indexedSession.materializationDescriptor.dependencySetId,
  );
  const session = await codex.materializeCodexSession({
    materializationContext: index,
    indexedSession,
    dependencySet,
  });
  const logicalPath = compressed.slice(0, -4);
  await fsp.unlink(compressed);
  await fsp.writeFile(logicalPath, text, 'utf8');
  await assert.rejects(
    codex.readIndexedCodexRawRecord(index, session, session.rawEvents[1]),
    (error) => error.code === 'INDEXED_SOURCE_STALE',
  );
});

test('compressed reader observes cancellation before opening a source', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    storage.hashLogicalPrefix('C:\\synthetic\\rollout.jsonl.zst', 0, controller.signal),
    (error) => error.name === 'AbortError',
  );
});

test('representation conversion during index verification rejects the mixed build', async (t) => {
  const { home, repoRoot } = await makeHome(t);
  const id = '99999999-0918-4918-8918-999999999999';
  const text = fixtureText(id, repoRoot);
  const compressed = await writeCompressedRollout(home, id, text);
  let converted = false;
  await assert.rejects(codex.buildSourceBackedIndex({
    repoRoot, codexHome: home,
    beforeSourceSnapshotVerificationForTests: async () => {
      if (converted) return;
      converted = true;
      await fsp.writeFile(compressed.slice(0, -4), text);
      await fsp.unlink(compressed);
    },
  }), (error) => error.code === 'SOURCE_CHANGED_DURING_INDEX');
  assert.equal(converted, true);
});

test('compressed reader cancels an active decode and closes its private streams', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-cancel.jsonl.zst');
  const text = `${JSON.stringify({ payload: crypto.randomBytes(220_000).toString('base64') })}\n`;
  await fsp.writeFile(file, zstdCompressSync(Buffer.from(text, 'utf8'), NO_CONTENT_SIZE));
  const controller = new AbortController();
  await assert.rejects(
    (async () => {
      for await (const chunk of storage.createLogicalReadStream(
        storage.normalizeArtifactDescriptor(file),
        { signal: controller.signal },
      )) {
        controller.abort();
        void chunk;
      }
    })(),
    (error) => error.name === 'AbortError',
  );
});

test('openDecodedStream active cancellation rejects promptly while finishing a frame', async (t) => {
  const { home } = await makeHome(t);
  const directory = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'rollout-cancel-open.jsonl.zst');
  const text = `${JSON.stringify({ payload: crypto.randomBytes(240_000).toString('base64') })}\n`;
  await fsp.writeFile(file, zstdCompressSync(Buffer.from(text, 'utf8'), NO_CONTENT_SIZE));
  const controller = new AbortController();
  const consume = (async () => {
    for await (const chunk of storage.openDecodedStream(
      storage.normalizeArtifactDescriptor(file),
      { signal: controller.signal },
    )) {
      controller.abort();
      void chunk;
    }
  })();
  let timer;
  try {
    await Promise.race([
      assert.rejects(consume, (error) => error.name === 'AbortError'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('active Zstandard cancellation hung')), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
});
