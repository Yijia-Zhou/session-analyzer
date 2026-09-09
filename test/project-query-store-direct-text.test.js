'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { gzipSync } = require('node:zlib');

const SOURCE_ROOT = process.env.S5_DIRECT_TEXT_SOURCE_ROOT
  ? path.resolve(process.env.S5_DIRECT_TEXT_SOURCE_ROOT)
  : path.join(__dirname, '..');
const projectQueryStore = require(path.join(SOURCE_ROOT, 'src', 'project-query-store.js'));
const { createSessionQuery } = require(path.join(SOURCE_ROOT, 'src', 'session-query.js'));

const {
  PROJECT_QUERY_CHUNK_MAX_BYTES,
  PROJECT_QUERY_CHUNK_MAX_ROWS,
  PROJECT_QUERY_GZIP_MIN_BYTES,
  PROJECT_QUERY_LAYERS,
  PROJECT_QUERY_STORE_SCHEMA_VERSION,
  buildProjectQueryStore,
  createProjectQueryStoreBuilder,
  readProjectQueryRowPreview,
  scanProjectQueryShard,
  validateProjectQueryStore,
  validateProjectQueryStoreForCommit,
} = projectQueryStore;

const FROZEN_CHUNK_MAX_ROWS = 4_096;
const FROZEN_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
const FROZEN_GZIP_MIN_BYTES = 7 * 512 * 1024;
const FROZEN_CONTRACT_CODE = 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION';
const FROZEN_CHUNK_KEYS = Object.freeze([
  'rowStart',
  'rowCount',
  'uncompressedBytes',
  'codec',
  'data',
  'rowOffsets',
]);
const FROZEN_EXPORT_KEYS = Object.freeze([
  'PROJECT_QUERY_CHUNK_MAX_BYTES',
  'PROJECT_QUERY_CHUNK_MAX_ROWS',
  'PROJECT_QUERY_GZIP_MIN_BYTES',
  'PROJECT_QUERY_LAYERS',
  'PROJECT_QUERY_STORE_SCHEMA_VERSION',
  'buildProjectQueryStore',
  'createProjectQueryStoreBuilder',
  'dictionaryString',
  'projectQueryProjectionDigest',
  'projectQueryProjectionDigestAsync',
  'projectQueryProjectionDigestForSession',
  'readProjectQueryRowPreview',
  'requireValidatedProjectQueryStore',
  'scanProjectQueryShard',
  'validateProjectQueryStore',
  'validateProjectQueryStoreForCommit',
]);

// Frozen from two byte-identical independent M0 runs against target
// 3419a49ae2c1c9a6ff7e1e34ecb3b550ba1f9ec1 before product implementation.
const FROZEN_PARENT_CAPTURE_SHA256 = Object.freeze({
  physical: 'd1b7b1685f1160a777db014ebcb333c6fd361a5a27244783ffa524cd00cda897',
  lateFailure: '1c52beb635b9da678cdd340d7e6e1d1f7525271189766cbe32738c1942c22e41',
});
const FROZEN_PARENT_PHYSICAL_FACTS = Object.freeze({
  schemaVersion: 2,
  sessionIds: ['session-z', 'session-a', 'session-m'],
  projectionDigests: [
    { sessionId: 'session-z', digest: '9ePathTH3tinYUllZMXWERC9WR9104qB-hURBCmUv1c' },
    { sessionId: 'session-a', digest: 'jwSauOQufQ11esrqrxZKhGaSWcnicsn-RG_ZBUrQwlU' },
    { sessionId: 'session-m', digest: 'olOek2f0R3mQAnYIqbpq1nXWSswPA3qcrrYPt1vLDx0' },
  ],
  dictionaryValues: [
    '',
    '/repo/shared.js',
    '/repo/z-new.js',
    '/repo/z-raw.jsonl',
    'exec',
    'write',
    'z-main-code',
    'z-main-empty',
    '2026-09-04T01:00:01.000Z',
    '2026-09-04T01:00:02.000Z',
    'command',
    'message',
    'assistant',
    'success',
    'Shared label',
    'declared_source',
    'z-protocol',
    '2026-09-04T01:00:03.000Z',
    'protocol',
    'turn_context',
    'z-raw',
    '2026-09-04T01:00:04.000Z',
    'response_item',
    '/repo/a-source.js',
    '/repo/a-new.js',
    'apply_patch',
    'a-main',
    '2026-09-04T02:00:01.000Z',
    'patch',
    'completed',
    'runtime_fallback',
    '/repo/a-raw.jsonl',
    'a-raw',
    '2026-09-04T02:00:02.000Z',
    'task_complete',
    'event_msg',
  ],
  dictionaryUtf8Sha256: '56049c966fe22089b96d0cfa2975055f361513d7b1e020aa0f4c744ebb5a58f0',
  accountedBytes: 1396,
  storeDigest: '1ddc9a74a9289054544d015fc913dc8fc97b2e20ef680764adfa2ad5157b65e9',
  decodedRowsDigest: '37cd45c9628f649c0c7cfb65359c466f8b715da6a08646949fa6b5fc9ba61c24',
  queryResultsDigest: '85b1af401727feead3078f63c0db5d95e4b25622f29dc8b2da7d962cdf63b944',
});

function frozenContractError(message) {
  const error = new Error(`ProjectQueryStore contract violation: ${message}`);
  error.code = FROZEN_CONTRACT_CODE;
  return error;
}

// Independent test-local copy of the target/current frame serializer. It must
// stay frame-based so it cannot accidentally share the candidate implementation.
function currentTextFrame(row) {
  const preview = Buffer.from(row.preview, 'utf8');
  const searchText = Buffer.from(row.searchText, 'utf8');
  const frame = Buffer.allocUnsafe(8 + preview.length + searchText.length);
  frame.writeUInt32LE(preview.length, 0);
  frame.writeUInt32LE(searchText.length, 4);
  preview.copy(frame, 8);
  searchText.copy(frame, 8 + preview.length);
  return frame;
}

function currentTextChunk(layer, frames, rowStart) {
  const rowOffsets = new Uint32Array(frames.length + 1);
  let uncompressedBytes = 0;
  for (let index = 0; index < frames.length; index += 1) {
    rowOffsets[index] = uncompressedBytes;
    uncompressedBytes += frames[index].length;
  }
  rowOffsets[frames.length] = uncompressedBytes;
  const plain = Buffer.concat(frames, uncompressedBytes);
  const codec = layer === 'main' || uncompressedBytes < FROZEN_GZIP_MIN_BYTES
    ? 'identity'
    : 'gzip-1';
  const data = codec === 'identity' ? plain : gzipSync(plain, { level: 1 });
  return {
    rowStart,
    rowCount: frames.length,
    uncompressedBytes,
    codec,
    data,
    rowOffsets,
  };
}

function currentTextChunks(rows, layer) {
  const chunks = [];
  let frames = [];
  let frameBytes = 0;
  let rowStart = 0;
  const flush = () => {
    if (!frames.length) return;
    chunks.push(currentTextChunk(layer, frames, rowStart));
    rowStart += frames.length;
    frames = [];
    frameBytes = 0;
  };
  for (const row of rows) {
    const frame = currentTextFrame(row);
    if (frame.length > FROZEN_CHUNK_MAX_BYTES) {
      throw frozenContractError(`single ${layer} text row exceeds 4 MiB`);
    }
    if (frames.length >= FROZEN_CHUNK_MAX_ROWS
        || frameBytes + frame.length > FROZEN_CHUNK_MAX_BYTES) flush();
    frames.push(frame);
    frameBytes += frame.length;
  }
  flush();
  return chunks;
}

function textEvent(layer, index, row) {
  const timestamp = `2026-09-04T00:00:${String(index % 60).padStart(2, '0')}.000Z`;
  if (layer === 'raw') {
    return {
      rawId: `raw-text-${index}`,
      timestamp,
      recordType: 'response_item',
      payloadType: 'text_fixture',
      role: '',
      status: '',
      toolName: '',
      preview: row.preview,
      searchText: row.searchText,
      source: { file: '/fixture/raw.jsonl' },
      touchedFiles: [],
    };
  }
  return {
    id: `${layer}-text-${index}`,
    layer,
    timestamp,
    kind: layer === 'main' ? 'message' : 'protocol',
    subtype: 'text_fixture',
    status: '',
    toolName: '',
    label: '',
    preview: row.preview,
    searchText: row.searchText,
    source: { file: `/fixture/${layer}.jsonl` },
    touchedFiles: [],
    rawRefs: [],
  };
}

function textSession(rows, layer, id = `text-${layer}`) {
  const events = rows.map((row, index) => textEvent(layer, index, row));
  return {
    id,
    logicalEvents: layer === 'raw' ? [] : events,
    rawEvents: layer === 'raw' ? events : [],
  };
}

function candidateTextChunks(rows, layer) {
  const session = textSession(rows, layer);
  return buildProjectQueryStore([session]).shardsBySessionId.get(session.id)[layer].textChunks;
}

function chunkOffsetBytes(chunk) {
  return Buffer.from(
    chunk.rowOffsets.buffer,
    chunk.rowOffsets.byteOffset,
    chunk.rowOffsets.byteLength,
  );
}

function assertChunkParity(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: chunk count`);
  for (let index = 0; index < expected.length; index += 1) {
    const actualChunk = actual[index];
    const expectedChunk = expected[index];
    assert.deepEqual(Object.keys(actualChunk), FROZEN_CHUNK_KEYS, `${label}/${index}: field order`);
    assert.equal(actualChunk.rowStart, expectedChunk.rowStart, `${label}/${index}: rowStart`);
    assert.equal(actualChunk.rowCount, expectedChunk.rowCount, `${label}/${index}: rowCount`);
    assert.equal(
      actualChunk.uncompressedBytes,
      expectedChunk.uncompressedBytes,
      `${label}/${index}: uncompressedBytes`,
    );
    assert.equal(actualChunk.codec, expectedChunk.codec, `${label}/${index}: codec`);
    assert.deepEqual(actualChunk.data, expectedChunk.data, `${label}/${index}: data bytes`);
    assert.deepEqual(
      chunkOffsetBytes(actualChunk),
      chunkOffsetBytes(expectedChunk),
      `${label}/${index}: rowOffsets bytes`,
    );
  }
}

function captureError(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return { code: error.code, message: error.message };
  }
}

function assertTextParity(rows, layer, label) {
  let expected;
  let actual;
  let expectedError = null;
  let actualError = null;
  try {
    expected = currentTextChunks(rows, layer);
  } catch (error) {
    expectedError = { code: error.code, message: error.message };
  }
  try {
    actual = candidateTextChunks(rows, layer);
  } catch (error) {
    actualError = { code: error.code, message: error.message };
  }
  assert.deepEqual(actualError, expectedError, `${label}/${layer}: error parity`);
  if (!expectedError) assertChunkParity(actual, expected, `${label}/${layer}`);
}

function rowsWithFrameBytes(frameByteLengths) {
  return frameByteLengths.map((frameBytes, index) => {
    assert.ok(frameBytes >= 8, `frame ${index} must include both headers`);
    return { preview: String.fromCharCode(97 + (index % 26)).repeat(frameBytes - 8), searchText: '' };
  });
}

function rowCountAndByteBoundaryRows(rowCount) {
  const emptyPrefixCount = rowCount - 1;
  const prefixBytes = emptyPrefixCount * 8;
  const lastFrameBytes = FROZEN_CHUNK_MAX_BYTES - prefixBytes;
  return [
    ...Array.from({ length: emptyPrefixCount }, () => ({ preview: '', searchText: '' })),
    ...rowsWithFrameBytes([lastFrameBytes]),
    { preview: '', searchText: '' },
  ];
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function completeValueDigest(rootValue, options = {}) {
  const hash = crypto.createHash('sha256');
  const objectIds = new WeakMap();
  let nextObjectId = 0;
  const writeText = (tag, value) => {
    const text = String(value);
    hash.update(`${tag}:${Buffer.byteLength(text, 'utf8')}:`, 'utf8');
    hash.update(text, 'utf8');
    hash.update(';', 'utf8');
  };
  const writeBytes = (tag, bytes) => {
    hash.update(`${tag}:${bytes.byteLength}:`, 'utf8');
    hash.update(bytes);
    hash.update(';', 'utf8');
  };
  const visit = (value, context = {}) => {
    if (value === null) {
      writeText('primitive', 'null');
      return;
    }
    const type = typeof value;
    if (type === 'undefined') {
      writeText('primitive', 'undefined');
      return;
    }
    if (type === 'string') {
      writeText('string', value);
      return;
    }
    if (type === 'boolean') {
      writeText('boolean', value ? 'true' : 'false');
      return;
    }
    if (type === 'number') {
      const text = Number.isNaN(value) ? 'NaN' : Object.is(value, -0) ? '-0' : String(value);
      writeText('number', text);
      return;
    }
    if (type === 'bigint') {
      writeText('bigint', value.toString());
      return;
    }
    if (type !== 'object') throw new Error(`Unsupported digest value: ${type}`);
    if (objectIds.has(value)) {
      writeText('reference', objectIds.get(value));
      return;
    }
    const objectId = nextObjectId;
    nextObjectId += 1;
    objectIds.set(value, objectId);
    writeText('object-id', objectId);
    if (Buffer.isBuffer(value)) {
      writeBytes('Buffer', value);
      return;
    }
    if (ArrayBuffer.isView(value)) {
      writeText('typed-array', value.constructor.name);
      writeBytes(
        'typed-array-bytes',
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
      return;
    }
    if (value instanceof ArrayBuffer) {
      writeBytes('ArrayBuffer', Buffer.from(value));
      return;
    }
    if (Array.isArray(value)) {
      writeText('array-length', value.length);
      for (let index = 0; index < value.length; index += 1) {
        writeText('array-index', index);
        if (Object.hasOwn(value, index)) visit(value[index]);
        else writeText('array-hole', index);
      }
      return;
    }
    if (value instanceof Map) {
      writeText('map-size', value.size);
      let ordinal = 0;
      for (const [key, mapped] of value) {
        writeText('map-entry', ordinal);
        visit(key);
        visit(mapped);
        ordinal += 1;
      }
      return;
    }
    if (value instanceof Set) {
      writeText('set-size', value.size);
      let ordinal = 0;
      for (const member of value) {
        writeText('set-entry', ordinal);
        visit(member);
        ordinal += 1;
      }
      return;
    }
    if (value instanceof Date) {
      writeText('date', value.toISOString());
      return;
    }
    writeText('object-constructor', value.constructor?.name || 'null-prototype');
    const keys = Object.getOwnPropertyNames(value);
    if (options.sortObjectKeys) keys.sort();
    writeText('object-key-count', keys.length);
    for (const key of keys) {
      writeText('object-key', key);
      if (context.root && key === 'generatedAt' && options.normalizeGeneratedAt) {
        visit('<NORMALIZED_INDEX_GENERATED_AT>');
      } else if (options.normalizeDeepSeekElapsedMs
          && rootValue?.sourceKind === 'deepseek-harness'
          && value === rootValue.totals
          && key === 'elapsedMs') {
        visit('<NORMALIZED_DEEPSEEK_ELAPSED_MS>');
      } else {
        visit(value[key]);
      }
    }
  };
  visit(rootValue, { root: true });
  return hash.digest('hex');
}

function physicalDigest(value) {
  return completeValueDigest(value);
}

function normalizedIndexDigest(index) {
  return completeValueDigest(index, {
    normalizeGeneratedAt: true,
    normalizeDeepSeekElapsedMs: true,
    sortObjectKeys: true,
  });
}

function dictionaryValues(store) {
  const values = [];
  const { offsets, utf8 } = store.dictionaries;
  for (let index = 0; index < offsets.length - 1; index += 1) {
    values.push(utf8.toString('utf8', offsets[index], offsets[index + 1]));
  }
  return values;
}

function textRowsForSession(session, layer) {
  const events = layer === 'raw'
    ? session.rawEvents
    : session.logicalEvents.filter((event) => event.layer === layer);
  return events.map((event) => ({ preview: event.preview || '', searchText: event.searchText || '' }));
}

function assertFixtureTextOracle(store, sessions) {
  for (const session of sessions) {
    const shards = store.shardsBySessionId.get(session.id);
    for (const layer of PROJECT_QUERY_LAYERS) {
      assertChunkParity(
        shards[layer].textChunks,
        currentTextChunks(textRowsForSession(session, layer), layer),
        `physical/${session.id}/${layer}`,
      );
    }
  }
}

function physicalLogicalEvent(id, layer, overrides = {}) {
  return {
    id,
    layer,
    timestamp: overrides.timestamp || '2026-09-04T01:00:00.000Z',
    kind: overrides.kind || (layer === 'main' ? 'command' : 'protocol'),
    subtype: overrides.subtype || 'fixture',
    status: overrides.status || '',
    toolName: overrides.toolName || '',
    label: overrides.label || 'Shared label',
    preview: overrides.preview || '',
    searchText: overrides.searchText || '',
    source: { file: overrides.sourceFile || '/repo/shared.js' },
    touchedFiles: overrides.touchedFiles || [],
    rawRefs: overrides.rawRefs || [],
  };
}

function physicalRawEvent(id, overrides = {}) {
  return {
    rawId: id,
    timestamp: overrides.timestamp || '2026-09-04T01:00:00.000Z',
    recordType: overrides.recordType || 'response_item',
    payloadType: overrides.payloadType || 'message',
    role: overrides.role || '',
    status: overrides.status || '',
    toolName: overrides.toolName || '',
    preview: overrides.preview || '',
    searchText: overrides.searchText || '',
    source: { file: overrides.sourceFile || '/repo/raw.jsonl' },
    touchedFiles: overrides.touchedFiles || [],
  };
}

function makePhysicalFixture() {
  const sessions = [
    {
      id: 'session-z',
      logicalEvents: [
        physicalLogicalEvent('z-main-code', 'main', {
          timestamp: '2026-09-04T01:00:01.000Z',
          kind: 'command',
          subtype: 'exec',
          status: 'success',
          toolName: 'exec',
          label: 'Shared label',
          preview: 'needle ASCII preview',
          searchText: 'needle 汉字 😀 \ud800',
          sourceFile: '/repo/shared.js',
          touchedFiles: ['/repo/shared.js', '/repo/z-new.js', '/repo/shared.js'],
          rawRefs: [
            { file: '/repo/shared.js' },
            { file: '/repo/z-raw.jsonl' },
            { file: '/repo/z-raw.jsonl' },
          ],
        }),
        physicalLogicalEvent('z-main-empty', 'main', {
          timestamp: '2026-09-04T01:00:02.000Z',
          kind: 'message',
          subtype: 'assistant',
          preview: '',
          searchText: 'search-only',
          sourceFile: '/repo/z-new.js',
          touchedFiles: ['/repo/shared.js'],
        }),
        physicalLogicalEvent('z-protocol', 'protocol', {
          timestamp: '2026-09-04T01:00:03.000Z',
          kind: 'protocol',
          subtype: 'turn_context',
          label: '',
          preview: 'protocol π',
          searchText: 'protocol search',
          sourceFile: '/repo/z-raw.jsonl',
          touchedFiles: ['/repo/shared.js'],
        }),
      ],
      rawEvents: [
        physicalRawEvent('z-raw', {
          timestamp: '2026-09-04T01:00:04.000Z',
          recordType: 'response_item',
          payloadType: 'message',
          role: 'assistant',
          preview: 'raw \udc00',
          searchText: 'raw needle',
          sourceFile: '/repo/z-raw.jsonl',
          touchedFiles: ['/repo/shared.js', '/repo/z-new.js'],
        }),
      ],
    },
    {
      id: 'session-a',
      logicalEvents: [
        physicalLogicalEvent('a-main', 'main', {
          timestamp: '2026-09-04T02:00:01.000Z',
          kind: 'patch',
          subtype: 'apply_patch',
          status: 'completed',
          toolName: 'apply_patch',
          label: 'Shared label',
          preview: 'non-empty preview',
          searchText: '',
          sourceFile: '/repo/a-source.js',
          touchedFiles: ['/repo/shared.js', '/repo/a-new.js', '/repo/a-new.js'],
          rawRefs: [{ file: '/repo/shared.js' }],
        }),
      ],
      rawEvents: [
        physicalRawEvent('a-raw', {
          timestamp: '2026-09-04T02:00:02.000Z',
          recordType: 'event_msg',
          payloadType: 'task_complete',
          preview: 'raw astral 𠜎',
          searchText: 'raw final',
          sourceFile: '/repo/a-raw.jsonl',
          touchedFiles: ['/repo/a-new.js', '/repo/shared.js'],
        }),
      ],
    },
    {
      id: 'session-m',
      logicalEvents: [],
      rawEvents: [],
    },
  ];
  const presentationForEvent = (_session, event) => {
    if (event.id === 'z-main-code') {
      return {
        scriptOperation: true,
        declaredRequestNames: ['exec', 'exec', 'write', ''],
        requestEvidence: 'declared_source',
      };
    }
    if (event.id === 'a-main') {
      return {
        scriptOperation: false,
        declaredRequestNames: ['apply_patch', 'apply_patch', 'write'],
        requestEvidence: 'runtime_fallback',
      };
    }
    return null;
  };
  return { sessions, presentationForEvent };
}

function indexedSummaryForPhysicalSession(session, ordinal) {
  return {
    id: session.id,
    sourceKind: 'synthetic',
    sourceSessionId: session.id,
    title: `Fixture ${session.id}`,
    sourceFile: `/fixture/${session.id}.jsonl`,
    bytes: 100 + ordinal,
    lineCount: session.logicalEvents.length + session.rawEvents.length,
    cwdSet: ['/repo'],
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: `2026-09-04T0${ordinal + 1}:00:00.000Z`,
    updatedAt: `2026-09-04T0${ordinal + 1}:30:00.000Z`,
    counts: { failedCommands: 0 },
    rawEventCount: session.rawEvents.length,
    logicalEventCount: session.logicalEvents.length,
    summary: {
      topTools: [],
      failedCommandCount: 0,
      patchedFiles: [],
      protocolCount: session.logicalEvents.filter((event) => event.layer === 'protocol').length,
    },
  };
}

async function decodedRowsForStore(store, sessions) {
  const decoded = [];
  for (const session of sessions) {
    for (const layer of PROJECT_QUERY_LAYERS) {
      const rows = [];
      await scanProjectQueryShard(
        store,
        session.id,
        layer,
        { includeText: true },
        (row) => rows.push(row),
      );
      decoded.push({ sessionId: session.id, layer, rows });
    }
  }
  return decoded;
}

function chunkCapture(chunk) {
  return {
    keys: Object.keys(chunk),
    rowStart: chunk.rowStart,
    rowCount: chunk.rowCount,
    uncompressedBytes: chunk.uncompressedBytes,
    codec: chunk.codec,
    dataSha256: sha256(chunk.data),
    rowOffsetsHex: chunkOffsetBytes(chunk).toString('hex'),
  };
}

async function capturePhysicalFixture() {
  const { sessions, presentationForEvent } = makePhysicalFixture();
  const store = buildProjectQueryStore(sessions, { presentationForEvent });
  validateProjectQueryStore(store, sessions.map((session) => session.id));
  assertFixtureTextOracle(store, sessions);
  const decodedRows = await decodedRowsForStore(store, sessions);
  const indexedSessions = sessions.map(indexedSummaryForPhysicalSession);
  const index = {
    sourceKind: 'synthetic',
    repoRoot: '/repo',
    sessions: indexedSessions,
    sessionsById: new Map(indexedSessions.map((session) => [session.id, session])),
    projectQueryStore: store,
  };
  const query = createSessionQuery();
  const queryResults = {
    search: await query.filterSessions(index, {
      q: 'needle',
      layer: 'main',
      sort: 'updated-desc',
      offset: 0,
      limit: 50,
    }),
    fileFilter: await query.filterSessions(index, {
      file: 'shared.js',
      layer: 'main',
      sort: 'updated-desc',
      offset: 0,
      limit: 50,
    }),
    toolFilter: await query.filterSessions(index, {
      tool: 'exec',
      layer: 'main',
      sort: 'updated-desc',
      offset: 0,
      limit: 50,
    }),
    suggestions: await query.fileSuggestions(index, { layer: 'main', limit: 80 }),
  };
  return {
    schemaVersion: store.schemaVersion,
    storeKeys: Object.keys(store),
    sessionIds: [...store.shardsBySessionId.keys()],
    shardKeys: [...store.shardsBySessionId].map(([sessionId, shards]) => ({
      sessionId,
      keys: Object.keys(shards),
      layerKeys: PROJECT_QUERY_LAYERS.map((layer) => ({ layer, keys: Object.keys(shards[layer]) })),
    })),
    projectionDigests: [...store.shardsBySessionId].map(([sessionId, shards]) => ({
      sessionId,
      digest: shards.projectionDigest,
    })),
    dictionaryValues: dictionaryValues(store),
    dictionaryUtf8Sha256: sha256(store.dictionaries.utf8),
    dictionaryOffsetsHex: Buffer.from(
      store.dictionaries.offsets.buffer,
      store.dictionaries.offsets.byteOffset,
      store.dictionaries.offsets.byteLength,
    ).toString('hex'),
    textChunks: [...store.shardsBySessionId].map(([sessionId, shards]) => ({
      sessionId,
      layers: PROJECT_QUERY_LAYERS.map((layer) => ({
        layer,
        chunks: shards[layer].textChunks.map(chunkCapture),
      })),
    })),
    shardDigests: [...store.shardsBySessionId].map(([sessionId, shards]) => ({
      sessionId,
      digest: physicalDigest(shards),
    })),
    accountedBytes: store.accountedBytes,
    storeDigest: physicalDigest(store),
    decodedRowsDigest: physicalDigest(decodedRows),
    queryResultsDigest: physicalDigest(queryResults),
    queryResultFacts: {
      searchTotal: queryResults.search.total,
      searchEventTotal: queryResults.search.matchingEventTotal,
      fileTotal: queryResults.fileFilter.total,
      toolTotal: queryResults.toolFilter.total,
      suggestions: queryResults.suggestions,
    },
  };
}

const FIXED_FIXTURE_TIME = new Date('2026-09-04T00:00:00.000Z');
const CROSS_ADAPTER_TEMP_ROOT = path.join(os.tmpdir(), 'session-analyzer-s5-direct-text');

async function writeFixedFile(filePath, text) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, text, 'utf8');
  await fsp.utimes(filePath, FIXED_FIXTURE_TIME, FIXED_FIXTURE_TIME);
}

async function buildFrozenClaudeFixture(getSourceAdapter) {
  const home = path.join(CROSS_ADAPTER_TEMP_ROOT, 'claude-home');
  const repoRoot = path.join(CROSS_ADAPTER_TEMP_ROOT, 'claude-repo');
  const projectDir = path.join(home, 'projects', '-s5-direct-text');
  await fsp.mkdir(repoRoot, { recursive: true });
  for (const fixtureName of ['semantic-lifecycle.jsonl', 'detail-responsibility-archetypes.jsonl']) {
    const source = await fsp.readFile(
      path.join(__dirname, 'fixtures', 'claude', fixtureName),
      'utf8',
    );
    await writeFixedFile(
      path.join(projectDir, fixtureName),
      source.replaceAll('__REPO_ROOT__', repoRoot.replaceAll('\\', '\\\\')),
    );
  }
  return getSourceAdapter('claude-code').buildIndex({ repoRoot, sourceHome: home });
}

async function buildFrozenCodeModeFixture(getSourceAdapter) {
  const home = path.join(CROSS_ADAPTER_TEMP_ROOT, 'code-mode-home');
  const repoRoot = path.join(CROSS_ADAPTER_TEMP_ROOT, 'code-mode-repo');
  const sessionId = '97979797-9797-4797-8797-979797979797';
  const sessionDir = path.join(home, 'sessions', '2026', '07', '15');
  const source = await fsp.readFile(
    path.join(__dirname, 'fixtures', 'code-mode', 'structured-declared-sequential.jsonl'),
    'utf8',
  );
  const meta = JSON.stringify({
    timestamp: '2026-07-15T00:00:00.000Z',
    type: 'session_meta',
    payload: { id: sessionId, cwd: repoRoot, originator: 'codex_cli' },
  });
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeFixedFile(
    path.join(sessionDir, `rollout-2026-07-15T00-00-00-${sessionId}.jsonl`),
    `${meta}\n${source}`,
  );
  return getSourceAdapter('codex').buildIndex({ repoRoot, sourceHome: home });
}

function captureIndexFacts(index) {
  return {
    sourceKind: index.sourceKind,
    sessionIds: index.sessions.map((session) => session.id),
    sessionsByIdKeys: [...index.sessionsById.keys()],
    projectionDigests: index.sessions.map((session) => ({
      id: session.id,
      queryProjectionDigest: session.queryProjectionDigest,
    })),
    reusedFileCount: index.totals.reusedFileCount,
    materializationDependencyCount: index.materializationDependencies?.size ?? 0,
    projectQueryStoreDigest: physicalDigest(index.projectQueryStore),
    ...(process.env.S5_DIRECT_TEXT_INCLUDE_COMPLETE_INDEX === '1'
      ? { normalizedIndexDigest: normalizedIndexDigest(index) }
      : {}),
  };
}

async function assertAdapterIndexTextOracle(index) {
  const store = index.projectQueryStore;
  assert.ok(store);
  assert.deepEqual(
    [...store.shardsBySessionId.keys()],
    [...index.sessionsById.keys()],
    `${index.sourceKind}: packed Map order`,
  );
  for (const [sessionId, shards] of store.shardsBySessionId) {
    assert.equal(
      index.sessionsById.get(sessionId).queryProjectionDigest,
      shards.projectionDigest,
      `${index.sourceKind}/${sessionId}: Indexed projection digest`,
    );
    for (const layer of PROJECT_QUERY_LAYERS) {
      const rows = [];
      await scanProjectQueryShard(store, sessionId, layer, { includeText: true }, (row) => {
        rows.push({ preview: row.preview, searchText: row.searchText });
      });
      assertChunkParity(
        shards[layer].textChunks,
        currentTextChunks(rows, layer),
        `${index.sourceKind}/${sessionId}/${layer}`,
      );
    }
  }
}

async function captureAdapters() {
  const { getSourceAdapter, validateIndexOwnershipForCommit } = require(
    path.join(SOURCE_ROOT, 'src', 'source-adapters.js')
  );
  const preserveFixtures = process.env.S5_DIRECT_TEXT_PRESERVE_CAPTURE_FIXTURES === '1';
  if (!preserveFixtures) {
    await fsp.rm(CROSS_ADAPTER_TEMP_ROOT, { recursive: true, force: true });
  }
  await fsp.mkdir(CROSS_ADAPTER_TEMP_ROOT, { recursive: true });
  try {
    const codex = await getSourceAdapter('codex').buildIndex({
      repoRoot: 'G:\\vibe\\term-agent',
      sourceHome: path.join(__dirname, 'fixtures', 'codex-home'),
    });
    await validateIndexOwnershipForCommit(codex);

    const claude = await buildFrozenClaudeFixture(getSourceAdapter);
    await validateIndexOwnershipForCommit(claude);

    const deepSeek = await getSourceAdapter('deepseek-harness').buildIndex({
      repoRoot: '/home/joejack/dsh_playground/spike/ws/normal',
      sourceHome: path.join(__dirname, 'fixtures', 'deepseek-harness', 'sessions'),
    });
    await validateIndexOwnershipForCommit(deepSeek);

    const codeMode = await buildFrozenCodeModeFixture(getSourceAdapter);
    await validateIndexOwnershipForCommit(codeMode);

    for (const index of [codex, claude, deepSeek, codeMode]) {
      await assertAdapterIndexTextOracle(index);
    }

    return {
      codex: captureIndexFacts(codex),
      claude: captureIndexFacts(claude),
      deepSeek: captureIndexFacts(deepSeek),
      codeMode: captureIndexFacts(codeMode),
    };
  } finally {
    if (!preserveFixtures) {
      await fsp.rm(CROSS_ADAPTER_TEMP_ROOT, { recursive: true, force: true });
    }
  }
}

function codexRecordLines(id, repoRoot, marker, extra = false) {
  const records = [
    {
      timestamp: '2026-09-04T03:00:00.000Z',
      type: 'session_meta',
      payload: { id, cwd: repoRoot, originator: 'codex_cli' },
    },
    {
      timestamp: '2026-09-04T03:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `user ${marker}` }],
      },
    },
    {
      timestamp: '2026-09-04T03:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `assistant ${marker}` }],
      },
    },
  ];
  if (extra) {
    records.push({
      timestamp: '2026-09-04T03:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `changed ${marker}` }],
      },
    });
  }
  return `${records.map(JSON.stringify).join('\n')}\n`;
}

async function writeReuseSession(home, repoRoot, id, marker, options = {}) {
  const file = path.join(
    home,
    'sessions',
    '2026',
    '09',
    '04',
    `rollout-2026-09-04T03-00-00-${id}.jsonl`,
  );
  await writeFixedFile(file, codexRecordLines(id, repoRoot, marker, options.extra === true));
  if (options.changedTime) {
    const changedTime = new Date('2026-09-04T00:00:02.000Z');
    await fsp.utimes(file, changedTime, changedTime);
  }
  return file;
}

function reuseIdentityFacts(index, previous, ids) {
  return {
    sameIndex: index === previous,
    sameStore: index.projectQueryStore === previous?.projectQueryStore,
    sessionIdentity: Object.fromEntries(ids.map((id) => [
      id,
      index.sessionsById.get(id) === previous?.sessionsById.get(id),
    ])),
  };
}

function reuseIndexFacts(index, previous, ids) {
  return {
    reusedFileCount: index.totals.reusedFileCount,
    identity: reuseIdentityFacts(index, previous, ids),
    projectQueryStoreDigest: physicalDigest(index.projectQueryStore),
    sessionIds: index.sessions.map((session) => session.id),
    projectionDigests: index.sessions.map((session) => ({
      id: session.id,
      queryProjectionDigest: session.queryProjectionDigest,
    })),
  };
}

async function captureCodexReuse() {
  const { buildSourceBackedIndex } = require(path.join(SOURCE_ROOT, 'src', 'codex.js'));
  const root = path.join(os.tmpdir(), 'session-analyzer-s5-direct-text-reuse');
  const home = path.join(root, 'codex-home');
  const repoRoot = path.join(root, 'repo');
  const firstId = '11111111-2222-4333-8444-555555555555';
  const secondId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  const addedId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  try {
    await writeReuseSession(home, repoRoot, firstId, 'first');
    const secondFile = await writeReuseSession(home, repoRoot, secondId, 'second');
    const fresh = await buildSourceBackedIndex({ repoRoot, codexHome: home, previousIndex: null });
    const unchanged = await buildSourceBackedIndex({ repoRoot, codexHome: home, previousIndex: fresh });

    await writeReuseSession(home, repoRoot, firstId, 'first', { extra: true, changedTime: true });
    const changed = await buildSourceBackedIndex({ repoRoot, codexHome: home, previousIndex: fresh });

    await writeReuseSession(home, repoRoot, firstId, 'first');
    const addedFile = await writeReuseSession(home, repoRoot, addedId, 'added');
    const added = await buildSourceBackedIndex({ repoRoot, codexHome: home, previousIndex: fresh });

    await fsp.rm(addedFile, { force: true });
    await fsp.rm(secondFile, { force: true });
    const removed = await buildSourceBackedIndex({ repoRoot, codexHome: home, previousIndex: fresh });

    return {
      fresh: {
        reusedFileCount: fresh.totals.reusedFileCount,
        projectQueryStoreDigest: physicalDigest(fresh.projectQueryStore),
        sessionIds: fresh.sessions.map((session) => session.id),
      },
      unchanged: reuseIndexFacts(unchanged, fresh, [firstId, secondId]),
      changed: reuseIndexFacts(changed, fresh, [firstId, secondId]),
      added: reuseIndexFacts(added, fresh, [firstId, secondId, addedId]),
      removed: reuseIndexFacts(removed, fresh, [firstId, secondId]),
    };
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function lateFailureSession() {
  return {
    id: 'late-failure',
    logicalEvents: [
      physicalLogicalEvent('failed-main', 'main', {
        kind: 'failed-main-kind',
        subtype: 'failed-main-subtype',
        label: 'failed-main-label',
        preview: 'failed main preview',
        searchText: 'failed main search',
        sourceFile: '/failed/main.js',
        touchedFiles: ['/failed/touched.js'],
      }),
      physicalLogicalEvent('failed-protocol', 'protocol', {
        kind: 'failed-protocol-kind',
        subtype: 'failed-protocol-subtype',
        preview: 'x'.repeat(FROZEN_CHUNK_MAX_BYTES - 7),
        searchText: '',
        sourceFile: '/failed/protocol.js',
      }),
    ],
    rawEvents: [],
  };
}

function validAfterFailureSession() {
  return {
    id: 'valid-after-failure',
    logicalEvents: [physicalLogicalEvent('valid-main', 'main', {
      kind: 'valid-kind',
      subtype: 'valid-subtype',
      label: 'valid-label',
      preview: 'valid preview',
      searchText: 'valid search',
      sourceFile: '/valid/source.js',
      touchedFiles: ['/valid/touched.js'],
    })],
    rawEvents: [],
  };
}

function captureLateFailure() {
  const builder = createProjectQueryStoreBuilder();
  const error = captureError(() => builder.addSession(lateFailureSession()));
  const digest = builder.addSession(validAfterFailureSession());
  const store = builder.finish();
  return {
    error,
    continuedDigest: digest,
    sessionIds: [...store.shardsBySessionId.keys()],
    dictionaryValues: dictionaryValues(store),
    accountedBytes: store.accountedBytes,
    storeDigest: physicalDigest(store),
  };
}

function runPatchedGzipChild(mode) {
  const sourcePath = path.join(SOURCE_ROOT, 'src', 'project-query-store.js');
  const script = String.raw`
    'use strict';
    const zlib = require('node:zlib');
    const mode = process.argv[2];
    let gzipCalls = 0;
    zlib.gzipSync = () => {
      gzipCalls += 1;
      if (mode === 'gzip-error') {
        const error = new Error('frozen gzip failure');
        error.code = 'FROZEN_GZIP_FAILURE';
        throw error;
      }
      return Buffer.from('stub');
    };
    const {
      buildProjectQueryStore,
      PROJECT_QUERY_CHUNK_MAX_BYTES,
      PROJECT_QUERY_CHUNK_MAX_ROWS,
      PROJECT_QUERY_GZIP_MIN_BYTES,
    } = require(process.argv[1]);
    const event = (id, preview) => ({
      id,
      layer: 'protocol',
      timestamp: '',
      kind: 'protocol',
      subtype: 'fixture',
      status: '',
      toolName: '',
      label: '',
      preview,
      searchText: '',
      source: { file: '' },
      touchedFiles: [],
      rawRefs: [],
    });
    let logicalEvents;
    if (mode === 'row-limit') {
      logicalEvents = Array.from(
        { length: PROJECT_QUERY_CHUNK_MAX_ROWS },
        (_, index) => event('legal-' + index, 'x'.repeat(888)),
      );
      logicalEvents.push(event('oversized', 'x'.repeat(PROJECT_QUERY_CHUNK_MAX_BYTES - 7)));
    } else if (mode === 'byte-limit') {
      logicalEvents = [
        event('legal', 'x'.repeat(PROJECT_QUERY_GZIP_MIN_BYTES - 8)),
        event('oversized', 'x'.repeat(PROJECT_QUERY_CHUNK_MAX_BYTES - 7)),
      ];
    } else {
      logicalEvents = [event('gzip', 'x'.repeat(PROJECT_QUERY_GZIP_MIN_BYTES - 8))];
    }
    let error = null;
    try {
      buildProjectQueryStore([{ id: 'gzip-order', logicalEvents, rawEvents: [] }]);
    } catch (caught) {
      error = { code: caught.code, message: caught.message };
    }
    process.stdout.write(JSON.stringify({ gzipCalls, error }));
  `;
  const result = childProcess.spawnSync(
    process.execPath,
    ['-e', script, sourcePath, mode],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function rowCapSession() {
  const oversizedRows = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') return 5_000_001;
      if (property === Symbol.iterator) return function* emptyRows() {};
      return Reflect.get(target, property, receiver);
    },
  });
  const rawEvents = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'map') return () => oversizedRows;
      return Reflect.get(target, property, receiver);
    },
  });
  return { id: 'row-cap', logicalEvents: [], rawEvents };
}

function cancellationFixtureSession() {
  return {
    id: 'cancellation-fixture',
    logicalEvents: [
      ...Array.from({ length: 513 }, (_, index) => physicalLogicalEvent(
        `cancel-main-${index}`,
        'main',
        {
          timestamp: `2026-09-04T04:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
          kind: 'message',
          subtype: 'fixture',
          preview: `preview-${index}`,
          searchText: `search-${index}`,
        },
      )),
      physicalLogicalEvent('cancel-protocol', 'protocol', {
        timestamp: '2026-09-04T05:00:00.000Z',
        preview: 'protocol preview',
        searchText: 'protocol search',
      }),
    ],
    rawEvents: [physicalRawEvent('cancel-raw', {
      timestamp: '2026-09-04T05:00:01.000Z',
      preview: 'raw preview',
      searchText: 'raw search',
    })],
  };
}

async function captureM0() {
  return {
    physical: await capturePhysicalFixture(),
    adapters: await captureAdapters(),
    reuse: await captureCodexReuse(),
    lateFailure: captureLateFailure(),
  };
}

function registerTests() {
  test('direct text parent constants, layer order, schema, and production API are frozen', () => {
    assert.equal(PROJECT_QUERY_CHUNK_MAX_ROWS, FROZEN_CHUNK_MAX_ROWS);
    assert.equal(PROJECT_QUERY_CHUNK_MAX_BYTES, FROZEN_CHUNK_MAX_BYTES);
    assert.equal(PROJECT_QUERY_GZIP_MIN_BYTES, FROZEN_GZIP_MIN_BYTES);
    assert.equal(PROJECT_QUERY_STORE_SCHEMA_VERSION, 2);
    assert.deepEqual(PROJECT_QUERY_LAYERS, ['main', 'protocol', 'raw']);
    assert.deepEqual(Object.keys(projectQueryStore), FROZEN_EXPORT_KEYS);
  });

  test('direct text CURRENT oracle matches exact UTF-8 and field permutations', async (t) => {
    const cases = [
      { name: 'empty layer', makeRows: () => [] },
      { name: 'empty text', makeRows: () => [{ preview: '', searchText: '' }] },
      { name: 'ASCII', makeRows: () => [{ preview: 'ASCII preview', searchText: 'ASCII search' }] },
      { name: 'multibyte Unicode', makeRows: () => [{ preview: '汉字 café', searchText: '多字节 κόσμος' }] },
      { name: 'astral Unicode', makeRows: () => [{ preview: '😀𠜎', searchText: '🧪🚀' }] },
      { name: 'lone high surrogate', makeRows: () => [{ preview: '\ud800', searchText: 'high\ud800end' }] },
      { name: 'lone low surrogate', makeRows: () => [{ preview: '\udc00', searchText: 'low\udc00end' }] },
      {
        name: 'invalid adjacent surrogate sequences',
        makeRows: () => [{ preview: '\ud800\ud800', searchText: '\udc00\udc00' }],
      },
      {
        name: 'invalid separated surrogate sequences',
        makeRows: () => [{ preview: 'a\ud800b\udc00c', searchText: '\udc00x\ud800' }],
      },
      {
        name: 'empty preview non-empty search',
        makeRows: () => [{ preview: '', searchText: 'search only' }],
      },
      {
        name: 'non-empty preview empty search',
        makeRows: () => [{ preview: 'preview only', searchText: '' }],
      },
    ];
    for (const fixture of cases) {
      await t.test(fixture.name, () => {
        const rows = fixture.makeRows();
        for (const layer of PROJECT_QUERY_LAYERS) assertTextParity(rows, layer, fixture.name);
      });
    }
  });

  test('direct text CURRENT oracle matches large preview and search placements', async (t) => {
    const mebibyte = 1024 * 1024;
    const cases = [
      {
        name: '1 MiB preview',
        rows: [{ preview: 'p'.repeat(mebibyte), searchText: '' }],
      },
      {
        name: '1 MiB search',
        rows: [{ preview: '', searchText: 's'.repeat(mebibyte) }],
      },
      {
        name: 'mixed large preview and search',
        rows: [{ preview: 'p'.repeat(mebibyte), searchText: 's'.repeat(mebibyte) }],
      },
    ];
    for (const fixture of cases) {
      await t.test(fixture.name, () => assertTextParity(fixture.rows, 'main', fixture.name));
    }
  });

  test('direct text CURRENT oracle matches row-count boundaries and identity chunks', async (t) => {
    const cases = [
      { name: '4095 rows', count: FROZEN_CHUNK_MAX_ROWS - 1 },
      { name: '4096 rows', count: FROZEN_CHUNK_MAX_ROWS },
      { name: '4097 rows', count: FROZEN_CHUNK_MAX_ROWS + 1 },
      { name: 'multiple identity chunks', count: (2 * FROZEN_CHUNK_MAX_ROWS) + 1 },
    ];
    for (const fixture of cases) {
      await t.test(fixture.name, () => {
        const rows = Array.from({ length: fixture.count }, () => ({ preview: '', searchText: '' }));
        assertTextParity(rows, fixture.name === 'multiple identity chunks' ? 'protocol' : 'main', fixture.name);
      });
    }
  });

  test('direct text CURRENT oracle matches exact row and aggregate byte boundaries', async (t) => {
    const cases = [
      {
        name: 'single frame exactly 4 MiB',
        rows: rowsWithFrameBytes([FROZEN_CHUNK_MAX_BYTES]),
      },
      {
        name: 'chunk total limit minus one',
        rows: rowsWithFrameBytes([2_000_000, FROZEN_CHUNK_MAX_BYTES - 1 - 2_000_000]),
      },
      {
        name: 'chunk total exactly limit',
        rows: rowsWithFrameBytes([2_000_000, FROZEN_CHUNK_MAX_BYTES - 2_000_000]),
      },
      {
        name: 'candidate row takes aggregate over limit',
        rows: rowsWithFrameBytes([FROZEN_CHUNK_MAX_BYTES - 4, 8]),
      },
      {
        name: '4095 rows exactly 4 MiB then legal row',
        rows: rowCountAndByteBoundaryRows(FROZEN_CHUNK_MAX_ROWS - 1),
      },
      {
        name: '4096 rows exactly 4 MiB then legal row',
        rows: rowCountAndByteBoundaryRows(FROZEN_CHUNK_MAX_ROWS),
      },
    ];
    for (const fixture of cases) {
      await t.test(fixture.name, () => assertTextParity(fixture.rows, 'main', fixture.name));
    }
  });

  test('direct text CURRENT oracle matches exact codec and gzip byte boundaries', async (t) => {
    for (const layer of ['protocol', 'raw']) {
      for (const delta of [-1, 0, 1]) {
        const totalBytes = FROZEN_GZIP_MIN_BYTES + delta;
        const name = `${layer} gzip threshold ${delta < 0 ? '- 1' : delta > 0 ? '+ 1' : 'exact'}`;
        await t.test(name, () => {
          assertTextParity(rowsWithFrameBytes([totalBytes]), layer, name);
        });
      }
    }
    await t.test('Main above gzip threshold remains identity', () => {
      const rows = rowsWithFrameBytes([FROZEN_GZIP_MIN_BYTES + 1]);
      assertTextParity(rows, 'main', 'main-above-gzip');
      assert.equal(candidateTextChunks(rows, 'main')[0].codec, 'identity');
    });
    for (const layer of ['protocol', 'raw']) {
      await t.test(`${layer} multiple gzip chunks`, () => {
        const rows = rowsWithFrameBytes([FROZEN_GZIP_MIN_BYTES, FROZEN_GZIP_MIN_BYTES]);
        assertTextParity(rows, layer, `${layer}-multiple-gzip`);
        assert.deepEqual(candidateTextChunks(rows, layer).map((chunk) => chunk.codec), ['gzip-1', 'gzip-1']);
      });
    }
  });

  test('direct text oversized rows preserve exact layer error code and message', async (t) => {
    const rows = rowsWithFrameBytes([FROZEN_CHUNK_MAX_BYTES + 1]);
    for (const layer of PROJECT_QUERY_LAYERS) {
      await t.test(layer, () => {
        const expected = captureError(() => currentTextChunks(rows, layer));
        const actual = captureError(() => candidateTextChunks(rows, layer));
        assert.deepEqual(actual, expected);
        assert.deepEqual(actual, {
          code: FROZEN_CONTRACT_CODE,
          message: `ProjectQueryStore contract violation: single ${layer} text row exceeds 4 MiB`,
        });
      });
    }
  });

  test('direct text row-limit oversized error precedes pending gzip', () => {
    assert.deepEqual(runPatchedGzipChild('row-limit'), {
      gzipCalls: 0,
      error: {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: single protocol text row exceeds 4 MiB',
      },
    });
  });

  test('direct text byte-limit oversized error precedes pending gzip', () => {
    assert.deepEqual(runPatchedGzipChild('byte-limit'), {
      gzipCalls: 0,
      error: {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: single protocol text row exceeds 4 MiB',
      },
    });
  });

  test('direct text physical PQS, dictionary, digest, decoded row, and query snapshot matches parent', async () => {
    const capture = await capturePhysicalFixture();
    assert.equal(
      sha256(Buffer.from(JSON.stringify(capture), 'utf8')),
      FROZEN_PARENT_CAPTURE_SHA256.physical,
    );
    const {
      schemaVersion,
      sessionIds,
      projectionDigests,
      dictionaryValues: orderedDictionaryValues,
      dictionaryUtf8Sha256,
      accountedBytes,
      storeDigest,
      decodedRowsDigest,
      queryResultsDigest,
    } = capture;
    assert.deepEqual({
      schemaVersion,
      sessionIds,
      projectionDigests,
      dictionaryValues: orderedDictionaryValues,
      dictionaryUtf8Sha256,
      accountedBytes,
      storeDigest,
      decodedRowsDigest,
      queryResultsDigest,
    }, FROZEN_PARENT_PHYSICAL_FACTS);
  });

  test('direct text committed Codex, Claude, DeepSeek, and Code Mode Indexes use the CURRENT oracle', async () => {
    const capture = await captureAdapters();
    assert.deepEqual(
      Object.fromEntries(Object.entries(capture).map(([name, facts]) => [name, facts.sourceKind])),
      {
        codex: 'codex',
        claude: 'claude-code',
        deepSeek: 'deepseek-harness',
        codeMode: 'codex',
      },
    );
    for (const facts of Object.values(capture)) {
      assert.ok(facts.sessionIds.length > 0);
      assert.match(facts.projectQueryStoreDigest, /^[a-f0-9]{64}$/u);
      assert.equal(facts.projectionDigests.length, facts.sessionIds.length);
      assert.ok(facts.projectionDigests.every((entry) => /^[A-Za-z0-9_-]{43}$/u.test(
        entry.queryProjectionDigest,
      )));
    }
  });

  test('direct text preserves fresh, unchanged, changed, added, and removed previous-Index reuse', async () => {
    const capture = await captureCodexReuse();
    assert.deepEqual({
      fresh: capture.fresh.reusedFileCount,
      unchanged: capture.unchanged.reusedFileCount,
      changed: capture.changed.reusedFileCount,
      added: capture.added.reusedFileCount,
      removed: capture.removed.reusedFileCount,
    }, { fresh: 0, unchanged: 2, changed: 1, added: 2, removed: 1 });
    assert.equal(capture.unchanged.identity.sameStore, true);
    assert.equal(capture.changed.identity.sameStore, false);
    assert.equal(capture.added.identity.sameStore, false);
    assert.equal(capture.removed.identity.sameStore, false);
    assert.equal(
      capture.unchanged.projectQueryStoreDigest,
      capture.fresh.projectQueryStoreDigest,
    );
    assert.notEqual(capture.changed.projectQueryStoreDigest, capture.fresh.projectQueryStoreDigest);
    assert.notEqual(capture.added.projectQueryStoreDigest, capture.fresh.projectQueryStoreDigest);
    assert.notEqual(capture.removed.projectQueryStoreDigest, capture.fresh.projectQueryStoreDigest);
    assert.deepEqual(capture.unchanged.identity.sessionIdentity, {
      '11111111-2222-4333-8444-555555555555': true,
      '66666666-7777-4888-8999-aaaaaaaaaaaa': true,
    });
    assert.deepEqual(capture.changed.identity.sessionIdentity, {
      '11111111-2222-4333-8444-555555555555': false,
      '66666666-7777-4888-8999-aaaaaaaaaaaa': true,
    });
    assert.deepEqual(capture.added.identity.sessionIdentity, {
      '11111111-2222-4333-8444-555555555555': true,
      '66666666-7777-4888-8999-aaaaaaaaaaaa': true,
      'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff': false,
    });
    assert.deepEqual(capture.removed.identity.sessionIdentity, {
      '11111111-2222-4333-8444-555555555555': true,
      '66666666-7777-4888-8999-aaaaaaaaaaaa': false,
    });
  });

  test('direct text builder errors and post-failure visible mutation match parent', () => {
    assert.deepEqual(
      captureError(() => buildProjectQueryStore([{ id: '', logicalEvents: [], rawEvents: [] }])),
      {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: invalid or duplicate session ID ""',
      },
    );

    const duplicate = createProjectQueryStoreBuilder();
    duplicate.addSession({ id: 'duplicate', logicalEvents: [], rawEvents: [] });
    assert.deepEqual(
      captureError(() => duplicate.addSession({ id: 'duplicate', logicalEvents: [], rawEvents: [] })),
      {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: invalid or duplicate session ID "duplicate"',
      },
    );

    assert.deepEqual(
      captureError(() => buildProjectQueryStore([{ id: 'missing-arrays' }])),
      {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: session missing-arrays must expose complete event arrays while building',
      },
    );

    assert.deepEqual(
      captureError(() => buildProjectQueryStore([rowCapSession()])),
      {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: row count exceeds 5,000,000',
      },
    );

    const finished = createProjectQueryStoreBuilder();
    finished.finish();
    const finishedError = {
      code: FROZEN_CONTRACT_CODE,
      message: 'ProjectQueryStore contract violation: builder is already finished',
    };
    assert.deepEqual(
      captureError(() => finished.addSession({ id: 'after-finish', logicalEvents: [], rawEvents: [] })),
      finishedError,
    );
    assert.deepEqual(captureError(() => finished.finish()), finishedError);

    const accounted = buildProjectQueryStore([{
      id: 'accounted',
      logicalEvents: [],
      rawEvents: [],
    }]);
    accounted.accountedBytes += 1;
    assert.deepEqual(
      captureError(() => validateProjectQueryStore(accounted, ['accounted'])),
      {
        code: FROZEN_CONTRACT_CODE,
        message: 'ProjectQueryStore contract violation: accountedBytes does not equal encoded storage',
      },
    );

    assert.deepEqual(runPatchedGzipChild('gzip-error'), {
      gzipCalls: 1,
      error: { code: 'FROZEN_GZIP_FAILURE', message: 'frozen gzip failure' },
    });
    const lateFailure = captureLateFailure();
    assert.equal(
      sha256(Buffer.from(JSON.stringify(lateFailure), 'utf8')),
      FROZEN_PARENT_CAPTURE_SHA256.lateFailure,
    );
    assert.deepEqual(lateFailure.error, {
      code: FROZEN_CONTRACT_CODE,
      message: 'ProjectQueryStore contract violation: single protocol text row exceeds 4 MiB',
    });
    assert.deepEqual(lateFailure.sessionIds, ['valid-after-failure']);
    assert.equal(
      lateFailure.storeDigest,
      '544bb9b4b6a96f811b94e055d3736ca891d44ce5178645f71182983b6f105643',
    );
  });

  test('direct text commit validation callback and cancellation lifecycle remains exact', async () => {
    const session = cancellationFixtureSession();
    const store = buildProjectQueryStore([session]);
    const callbacks = [];
    assert.equal(await validateProjectQueryStoreForCommit(store, [session.id], {
      structurallyValidated: true,
      onChunk: (event) => callbacks.push(event),
    }), store);
    assert.deepEqual(callbacks, [
      {
        phase: 'stored_projection',
        sessionId: session.id,
        layer: 'main',
        chunkIndex: 0,
        rowCount: 512,
      },
      {
        phase: 'stored_projection',
        sessionId: session.id,
        layer: 'main',
        chunkIndex: 1,
        rowCount: 1,
      },
      {
        phase: 'stored_projection',
        sessionId: session.id,
        layer: 'protocol',
        chunkIndex: 2,
        rowCount: 1,
      },
      {
        phase: 'stored_projection',
        sessionId: session.id,
        layer: 'raw',
        chunkIndex: 3,
        rowCount: 1,
      },
    ]);

    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(
      validateProjectQueryStoreForCommit(store, [session.id], { signal: preAborted.signal }),
      (error) => error.name === 'AbortError' && error.message === 'This operation was aborted',
    );

    const queued = new AbortController();
    setImmediate(() => queued.abort());
    await assert.rejects(
      validateProjectQueryStoreForCommit(store, [session.id], { signal: queued.signal }),
      (error) => error.name === 'AbortError' && error.message === 'This operation was aborted',
    );

    const duringStoredProjection = new AbortController();
    let storedCallbacks = 0;
    await assert.rejects(
      validateProjectQueryStoreForCommit(store, [session.id], {
        structurallyValidated: true,
        signal: duringStoredProjection.signal,
        onChunk() {
          storedCallbacks += 1;
          duringStoredProjection.abort();
        },
      }),
      (error) => error.name === 'AbortError' && error.message === 'This operation was aborted',
    );
    assert.equal(storedCallbacks, 1);

    const scanController = new AbortController();
    let scanCallbacks = 0;
    await assert.rejects(
      scanProjectQueryShard(store, session.id, 'main', {
        includeText: true,
        signal: scanController.signal,
        onChunk() {
          scanCallbacks += 1;
          scanController.abort();
        },
      }, () => {}),
      (error) => error.name === 'AbortError' && error.message === 'This operation was aborted',
    );
    assert.equal(scanCallbacks, 1);

    const previewController = new AbortController();
    previewController.abort();
    await assert.rejects(
      readProjectQueryRowPreview(store, session.id, 'main', 0, {
        signal: previewController.signal,
      }),
      (error) => error.name === 'AbortError' && error.message === 'This operation was aborted',
    );
  });

  test('direct text gzip preview read preserves decoded text and callback shape', async () => {
    const preview = 'g'.repeat(FROZEN_GZIP_MIN_BYTES - 8);
    const session = textSession([{ preview, searchText: '' }], 'protocol', 'gzip-preview');
    const store = buildProjectQueryStore([session]);
    const callbacks = [];
    const decoded = await readProjectQueryRowPreview(store, session.id, 'protocol', 0, {
      onTextChunk: (event) => callbacks.push(event),
    });
    assert.equal(decoded, preview);
    assert.deepEqual(callbacks, [{
      sessionId: session.id,
      layer: 'protocol',
      rowStart: 0,
      rowCount: 1,
    }]);
  });
}

if (process.env.S5_DIRECT_TEXT_CAPTURE_M0 === '1') {
  captureM0().then(
    (capture) => {
      const output = process.env.S5_DIRECT_TEXT_CAPTURE_HASH_ONLY === '1'
        ? {
          captureSha256: sha256(Buffer.from(JSON.stringify(capture), 'utf8')),
          physicalSha256: sha256(Buffer.from(JSON.stringify(capture.physical), 'utf8')),
          adaptersSha256: sha256(Buffer.from(JSON.stringify(capture.adapters), 'utf8')),
          reuseSha256: sha256(Buffer.from(JSON.stringify(capture.reuse), 'utf8')),
          lateFailureSha256: sha256(Buffer.from(JSON.stringify(capture.lateFailure), 'utf8')),
          ...(process.env.S5_DIRECT_TEXT_INCLUDE_COMPLETE_INDEX === '1'
            ? {
              normalizedIndexDigests: Object.fromEntries(
                Object.entries(capture.adapters).map(([name, facts]) => [
                  name,
                  facts.normalizedIndexDigest,
                ]),
              ),
            }
            : {}),
        }
        : capture;
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    },
    (error) => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    },
  );
} else {
  registerTests();
}
