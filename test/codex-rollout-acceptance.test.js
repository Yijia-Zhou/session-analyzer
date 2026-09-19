'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const vm = require('node:vm');
const { zstdCompressSync, zstdDecompressSync } = require('node:zlib');

const codex = require('../src/codex');
const storage = require('../src/codex-rollout-storage');
const snapshots = require('../src/codex-rollout-snapshots');

const SESSION_ID = 'abababab-abab-4bab-8bab-abababababab';

function fixtureRecords(id, repoRoot) {
  return [
    {
      type: 'session_meta',
      timestamp: '2026-09-18T10:00:00.000Z',
      payload: { id, cwd: repoRoot },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-18T10:00:01.000Z',
      payload: {
        type: 'user_message',
        message: 'parity request 你好🙂',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-09-18T10:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        call_id: 'call-parity',
        arguments: '{"command":"printf parity"}',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-09-18T10:00:03.000Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-parity',
        output: 'tool parity output 你好🙂',
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-18T10:00:04.000Z',
      payload: {
        type: 'agent_message',
        message: 'assistant parity answer 你好🙂',
      },
    },
  ];
}

function fixtureText(id, repoRoot) {
  return `${fixtureRecords(id, repoRoot).map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function rawZstdFrame(payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  assert.ok(body.length >= 256 && body.length <= 65_791);
  const header = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x60, 0, 0, 0, 0, 0]);
  header.writeUInt16LE(body.length - 256, 5);
  header.writeUIntLE((body.length << 3) | 1, 7, 3);
  return Buffer.concat([header, body]);
}

async function makeHome(t, repoRoot) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-acceptance-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  await fsp.mkdir(path.join(home, 'repo'), { recursive: true });
  const sessions = path.join(home, 'sessions', '2026', '09', '18');
  await fsp.mkdir(sessions, { recursive: true });
  return { home, repoRoot, sessions };
}

async function writeRollout(home, id, text, compression = 'none') {
  const logicalPath = path.join(home, 'sessions', '2026', '09', '18', `rollout-2026-09-18T10-00-00-${id}.jsonl`);
  const physicalPath = compression === 'zstd' ? `${logicalPath}.zst` : logicalPath;
  const bytes = compression === 'zstd'
    ? zstdCompressSync(Buffer.from(text, 'utf8'))
    : Buffer.from(text, 'utf8');
  await fsp.writeFile(physicalPath, bytes);
  return { logicalPath, physicalPath };
}

function logicalSnapshot(session) {
  return {
    id: session.id,
    sourceKind: session.sourceKind,
    sourceFile: session.sourceFile,
    bytes: session.bytes,
    lineCount: session.lineCount,
    cwdSet: [...session.cwdSet].sort(),
    counts: session.counts,
    logicalEvents: session.logicalEvents,
    rawEvents: session.rawEvents,
  };
}

async function materialize(index, sessionId) {
  const indexedSession = index.sessionsById.get(sessionId);
  assert.ok(indexedSession, `missing indexed session ${sessionId}`);
  const dependencySet = index.materializationDependencies.get(
    indexedSession.materializationDescriptor.dependencySetId,
  );
  assert.ok(dependencySet, `missing dependency set for ${sessionId}`);
  return codex.materializeCodexSession({
    materializationContext: index,
    indexedSession,
    dependencySet,
  });
}

test('plain and compressed rollouts have identical logical, search, and count results', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-acceptance-repo-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'project');
  await fsp.mkdir(repoRoot, { recursive: true });
  const text = fixtureText(SESSION_ID, repoRoot);
  const plain = await makeHome(t, repoRoot);
  const compressed = await makeHome(t, repoRoot);
  await writeRollout(plain.home, SESSION_ID, text, 'none');
  await writeRollout(compressed.home, SESSION_ID, text, 'zstd');
  await snapshots.clearSnapshotsForTests();
  const decodeCountBeforeColdBuild = snapshots.snapshotStatsForTests().decodeCount;

  const [plainIndex, compressedIndex] = await Promise.all([
    codex.buildSourceBackedIndex({ repoRoot, codexHome: plain.home }),
    codex.buildSourceBackedIndex({ repoRoot, codexHome: compressed.home }),
  ]);
  assert.equal(
    snapshots.snapshotStatsForTests().decodeCount - decodeCountBeforeColdBuild,
    1,
    'a cold compressed source should be decoded once into the private snapshot',
  );
  assert.deepEqual(compressedIndex.totals, plainIndex.totals);
  assert.equal(plainIndex.totals.reusedFileCount, 0);
  assert.equal(compressedIndex.totals.reusedFileCount, 0);

  const [plainSession, compressedSession] = await Promise.all([
    materialize(plainIndex, SESSION_ID),
    materialize(compressedIndex, SESSION_ID),
  ]);
  assert.deepEqual(logicalSnapshot(compressedSession), logicalSnapshot(plainSession));

  const filters = {
    q: 'parity',
    layer: 'main',
    sort: 'updated-desc',
    offset: 0,
    limit: 150,
    locale: 'en',
  };
  assert.deepEqual(
    await codex.filterSessions(compressedIndex, filters),
    await codex.filterSessions(plainIndex, filters),
  );
  assert.deepEqual(
    codex.getTimeline(compressedIndex, compressedSession, filters),
    codex.getTimeline(plainIndex, plainSession, filters),
  );
  assert.deepEqual(compressedSession.counts, plainSession.counts);

  const [plainWarm, compressedWarm] = await Promise.all([
    codex.buildSourceBackedIndex({ repoRoot, codexHome: plain.home, previousIndex: plainIndex }),
    codex.buildSourceBackedIndex({ repoRoot, codexHome: compressed.home, previousIndex: compressedIndex }),
  ]);
  assert.equal(
    snapshots.snapshotStatsForTests().decodeCount,
    decodeCountBeforeColdBuild + 1,
    'an unchanged warm compressed index should reuse its decoded snapshot',
  );
  assert.equal(plainWarm.totals.reusedFileCount, 1);
  assert.equal(compressedWarm.totals.reusedFileCount, 1);
  const withoutReuseCount = (totals) => {
    const { reusedFileCount, ...rest } = totals;
    return rest;
  };
  assert.deepEqual(withoutReuseCount(plainWarm.totals), withoutReuseCount(plainIndex.totals));
  assert.deepEqual(withoutReuseCount(compressedWarm.totals), withoutReuseCount(compressedIndex.totals));
});

test('plain and compressed source-backed Raw detail returns the same source row', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-raw-repo-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'project');
  await fsp.mkdir(repoRoot, { recursive: true });
  const text = fixtureText(SESSION_ID, repoRoot);
  const plain = await makeHome(t, repoRoot);
  const compressed = await makeHome(t, repoRoot);
  await writeRollout(plain.home, SESSION_ID, text, 'none');
  await writeRollout(compressed.home, SESSION_ID, text, 'zstd');
  const [plainIndex, compressedIndex] = await Promise.all([
    codex.buildSourceBackedIndex({ repoRoot, codexHome: plain.home }),
    codex.buildSourceBackedIndex({ repoRoot, codexHome: compressed.home }),
  ]);
  const [plainSession, compressedSession] = await Promise.all([
    materialize(plainIndex, SESSION_ID),
    materialize(compressedIndex, SESSION_ID),
  ]);
  const plainRaw = plainSession.rawEvents.find((raw) => raw.payloadType === 'user_message');
  const compressedRaw = compressedSession.rawEvents.find((raw) => raw.payloadType === 'user_message');
  assert.ok(plainRaw);
  assert.ok(compressedRaw);
  assert.equal(plainRaw.source.line, compressedRaw.source.line);
  const [plainRecord, compressedRecord] = await Promise.all([
    codex.readIndexedCodexRawRecord(plainIndex, plainSession, plainRaw),
    codex.readIndexedCodexRawRecord(compressedIndex, compressedSession, compressedRaw),
  ]);
  assert.deepEqual(compressedRecord, plainRecord);
  const [plainDetail, compressedDetail] = await Promise.all([
    codex.buildHydratedEventDetail(plainIndex, plainSession, plainRaw.rawId, 'raw', { locale: 'en' }),
    codex.buildHydratedEventDetail(compressedIndex, compressedSession, compressedRaw.rawId, 'raw', { locale: 'en' }),
  ]);
  assert.deepEqual(compressedDetail, plainDetail);
  assert.match(JSON.stringify(compressedDetail), /parity request/);
});

test('large Unicode rollout bytes survive plain and zstd chunked reads', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-large-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const id = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
  const records = [
    {
      type: 'session_meta',
      timestamp: '2026-09-18T11:00:00.000Z',
      payload: { id, cwd: path.join(root, 'repo') },
    },
    {
      type: 'event_msg',
      timestamp: '2026-09-18T11:00:01.000Z',
      payload: { type: 'user_message', message: `large-${'界🙂🚀é'.repeat(300000)}` },
    },
  ];
  const text = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  assert.ok(Buffer.byteLength(text, 'utf8') > 3_000_000);
  const plainPath = path.join(root, 'plain.jsonl');
  const compressedPath = path.join(root, 'compressed.jsonl.zst');
  await fsp.mkdir(path.join(root, 'repo'), { recursive: true });
  await fsp.writeFile(plainPath, text, 'utf8');
  await fsp.writeFile(compressedPath, zstdCompressSync(Buffer.from(text, 'utf8')), 'binary');

  async function readAll(filePath) {
    const chunks = [];
    for await (const chunk of storage.createLogicalReadStream(
      storage.normalizeArtifactDescriptor(filePath),
      { streamOptions: { highWaterMark: 4096 } },
    )) {
      chunks.push(Buffer.from(chunk));
    }
    return { bytes: Buffer.concat(chunks), chunkCount: chunks.length };
  }
  const [plainRead, compressedRead] = await Promise.all([
    readAll(plainPath),
    readAll(compressedPath),
  ]);
  assert.ok(plainRead.chunkCount > 1);
  assert.ok(compressedRead.chunkCount > 1);
  assert.deepEqual(compressedRead.bytes, plainRead.bytes);
  assert.equal(plainRead.bytes.toString('utf8'), text);
  assert.equal(compressedRead.bytes.toString('utf8'), text);

  const expectedLine = JSON.stringify(records[1]);
  const [plainLine, compressedLine] = await Promise.all([
    storage.readLogicalLine(storage.normalizeArtifactDescriptor(plainPath), 2),
    storage.readLogicalLine(storage.normalizeArtifactDescriptor(compressedPath), 2),
  ]);
  assert.equal(plainLine.line, expectedLine);
  assert.equal(compressedLine.line, expectedLine);
});

test('source-backed adapter survives concatenated raw frames at the default 64 KiB boundary', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-frame-boundary-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'project');
  await fsp.mkdir(repoRoot, { recursive: true });
  const home = await makeHome(t, repoRoot);
  const id = 'efefefef-efef-4fef-8fef-efefefefefef';
  const records = fixtureRecords(id, repoRoot);
  const firstLogicalBytes = 65_522;
  const firstRecordText = JSON.stringify(records[0]);
  const firstPrefix = `${firstRecordText}\n`;
  const paddingBytes = firstLogicalBytes - Buffer.byteLength(firstPrefix, 'utf8') - 1;
  assert.ok(paddingBytes > 0);
  const firstText = `${firstPrefix}${' '.repeat(paddingBytes)}\n`;
  const secondText = `${records.slice(1).map((record) => JSON.stringify(record)).join('\n')}\n`;
  const firstFrame = rawZstdFrame(firstText);
  const secondFrame = rawZstdFrame(secondText);
  const bytes = Buffer.concat([firstFrame, secondFrame]);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

  assert.equal(Buffer.byteLength(firstText, 'utf8'), firstLogicalBytes);
  assert.equal(firstFrame.length, 65_532);
  assert.equal(firstFrame.length + magic.length, 65_536);
  assert.deepEqual(zstdDecompressSync(firstFrame), Buffer.from(firstText, 'utf8'));
  assert.deepEqual(zstdDecompressSync(secondFrame), Buffer.from(secondText, 'utf8'));
  assert.deepEqual(bytes.subarray(firstFrame.length, firstFrame.length + magic.length), magic);

  const logicalPath = path.join(
    home.sessions,
    `rollout-2026-09-18T12-00-00-${id}.jsonl`,
  );
  const physicalPath = `${logicalPath}.zst`;
  await fsp.writeFile(physicalPath, bytes);
  const diagnostics = [];
  const index = await codex.buildSourceBackedIndex({
    repoRoot,
    codexHome: home.home,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessionsById.get(id)?.id, id);
  assert.equal(
    diagnostics.some((diagnostic) => (
      diagnostic.code === storage.CODEX_ROLLOUT_STORAGE_INVALID
      || /corrupt Codex Zstandard rollout/i.test(diagnostic.message || '')
    )),
    false,
  );

  const session = await materialize(index, id);
  const userRaw = session.rawEvents.find((raw) => raw.payloadType === 'user_message');
  const toolRaw = session.rawEvents.find((raw) => raw.payloadType === 'function_call_output');
  assert.ok(userRaw);
  assert.ok(toolRaw);
  const [userRecord, toolRecord] = await Promise.all([
    codex.readIndexedCodexRawRecord(index, session, userRaw),
    codex.readIndexedCodexRawRecord(index, session, toolRaw),
  ]);
  assert.equal(userRecord.raw, JSON.stringify(records[1]));
  assert.deepEqual(userRecord.parsed, records[1]);
  assert.equal(toolRecord.raw, JSON.stringify(records[3]));
  assert.deepEqual(toolRecord.parsed, records[3]);

  const userEvent = session.logicalEvents.find((event) => event.kind === 'user_message');
  assert.ok(userEvent);
  const [detail, rawDetail] = await Promise.all([
    codex.buildHydratedEventDetail(index, session, userEvent.id, userEvent.layer, { locale: 'en' }),
    codex.buildHydratedEventDetail(index, session, userRaw.rawId, 'raw', { locale: 'en' }),
  ]);
  assert.ok(detail);
  assert.ok(rawDetail);
  assert.match(JSON.stringify(detail), /parity request/);
  const rawJson = [...rawDetail.timelineSections, ...rawDetail.inspectorSections]
    .find((section) => section.title === 'Raw JSON');
  assert.ok(rawJson);
  assert.deepEqual(rawJson.value, userRecord.parsed);
});

test('compressed snapshot refreshes after same-size rewrite with the same normalized stat', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-rewrite-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rewrite.jsonl.zst');
  const firstText = `${JSON.stringify({ message: 'A'.repeat(500000) })}\n`;
  const secondText = `${JSON.stringify({ message: 'B'.repeat(500000) })}\n`;
  const firstBytes = zstdCompressSync(Buffer.from(firstText, 'utf8'));
  const secondBytes = zstdCompressSync(Buffer.from(secondText, 'utf8'));
  assert.equal(firstBytes.length, secondBytes.length, 'rewrite fixture must preserve physical size');
  await fsp.writeFile(file, firstBytes);
  const stableMtime = new Date('2020-01-02T03:04:05.678Z');
  await fsp.utimes(file, stableMtime, stableMtime);
  await snapshots.clearSnapshotsForTests();
  const descriptor = storage.normalizeArtifactDescriptor(file);
  const readAll = async () => {
    const chunks = [];
    for await (const chunk of storage.createLogicalReadStream(descriptor)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };
  assert.equal(await readAll(), firstText);
  const firstStat = await storage.acquireRolloutStat(descriptor);
  const decodeCountAfterFirstRead = snapshots.snapshotStatsForTests().decodeCount;

  await fsp.writeFile(file, secondBytes);
  // Keep the normalized mtime and physical size stable while changing content.
  await fsp.utimes(file, stableMtime, stableMtime);
  const secondStat = await storage.acquireRolloutStat(descriptor);
  assert.equal(secondStat.physicalBytes, firstStat.physicalBytes);
  assert.deepEqual(secondStat.fileIdentity, firstStat.fileIdentity);
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  assert.equal(await readAll(), secondText);
  assert.equal(
    snapshots.snapshotStatsForTests().decodeCount,
    decodeCountAfterFirstRead + 1,
    'changed compressed bytes must not reuse a stale decoded snapshot',
  );
});

test('isolated storage without built-in zstd fails closed while plain reads remain available', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-no-zstd-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const plainPath = path.join(root, 'plain.jsonl');
  const compressedPath = path.join(root, 'compressed.jsonl.zst');
  await fsp.writeFile(plainPath, '{"message":"plain remains readable"}\n', 'utf8');
  await fsp.writeFile(compressedPath, zstdCompressSync(Buffer.from('{"message":"compressed"}\n', 'utf8')));

  const sourcePath = path.resolve(require.resolve('../src/codex-rollout-storage'));
  const source = await fsp.readFile(sourcePath, 'utf8');
  const realZlib = require('node:zlib');
  const unavailableZlib = { ...realZlib, createZstdDecompress: undefined };
  const isolatedModule = { exports: {} };
  const context = vm.createContext({
    Buffer,
    clearTimeout,
    console,
    process,
    setTimeout,
    TextDecoder,
  });
  const factory = vm.runInContext(
    `(function(require, module, exports, __filename, __dirname) {${source}\n})`,
    context,
    { filename: sourcePath },
  );
  const sourceRequire = createRequire(sourcePath);
  const isolatedRequire = (request) => request === 'node:zlib' ? unavailableZlib : sourceRequire(request);
  factory(isolatedRequire, isolatedModule, isolatedModule.exports, sourcePath, path.dirname(sourcePath));
  const isolatedStorage = isolatedModule.exports;

  assert.equal(isolatedStorage.hasBuiltInZstd(), false);
  const plainLine = await isolatedStorage.readLogicalLine(
    isolatedStorage.normalizeArtifactDescriptor(plainPath),
    1,
  );
  assert.equal(plainLine.line, '{"message":"plain remains readable"}');
  await assert.rejects(
    (async () => {
      for await (const unused of isolatedStorage.createLogicalReadStream(
        isolatedStorage.normalizeArtifactDescriptor(compressedPath),
      )) {
        void unused;
      }
    })(),
    (error) => error.code === isolatedStorage.CODEX_ROLLOUT_ZSTD_UNAVAILABLE,
  );
});
