'use strict';

const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { gzipSync, gunzip, gunzipSync } = require('node:zlib');

const gunzipAsync = promisify(gunzip);

const PROJECT_QUERY_STORE_SCHEMA_VERSION = 2;
const PROJECT_QUERY_STORE_MAX_ROWS = 5_000_000;
const PROJECT_QUERY_STORE_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const PROJECT_QUERY_CHUNK_MAX_ROWS = 4_096;
const PROJECT_QUERY_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
const PROJECT_QUERY_GZIP_MIN_BYTES = 7 * 512 * 1024;
const PROJECT_QUERY_VERIFICATION_ROWS_PER_YIELD = 512;
const PROJECT_QUERY_LAYERS = Object.freeze(['main', 'protocol', 'raw']);
const EMPTY_STRING_ID = 0;
const validatedStores = new WeakMap();

function contractError(message) {
  const error = new Error(`ProjectQueryStore contract violation: ${message}`);
  error.code = 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION';
  return error;
}

function requireExactDataKeys(value, expectedKeys, owner) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(`${owner} must be an object`);
  }
  const expected = new Set(expectedKeys);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.size
      || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
    throw contractError(`${owner} has unknown or missing fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw contractError(`${owner}.${key} must be an enumerable data property`);
    }
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function eventIdFor(layer, event) {
  return layer === 'raw' ? asString(event?.rawId) : asString(event?.id);
}

function eventsForSessionLayer(session, layer) {
  return layer === 'raw'
    ? session.rawEvents
    : session.logicalEvents.filter((event) => event.layer === layer);
}

function eventCountForSessionLayer(session, layer) {
  if (layer === 'raw') return session.rawEvents.length;
  let count = 0;
  for (const event of session.logicalEvents) {
    if (event.layer === layer) count += 1;
  }
  return count;
}

function rowForEvent(session, layer, event, physicalLayerOrdinal, presentationForEvent) {
  const presentation = layer === 'main'
    ? presentationForEvent(session, event)
    : null;
  const declaredRequestNames = Array.isArray(presentation?.declaredRequestNames)
    ? [...new Set(presentation.declaredRequestNames.map(asString).filter(Boolean))]
    : [];
  const touchedFiles = Array.isArray(event.touchedFiles)
    ? event.touchedFiles.map(asString).filter(Boolean)
    : [];
  const filterFiles = [
    asString(event.source?.file),
    ...touchedFiles,
    ...(Array.isArray(event.rawRefs) ? event.rawRefs.map((reference) => asString(reference?.file)) : []),
  ].filter(Boolean);
  return {
    eventId: eventIdFor(layer, event),
    timestamp: asString(event.timestamp),
    physicalLayerOrdinal,
    kind: layer === 'raw' ? asString(event.payloadType || event.recordType) : asString(event.kind),
    subtype: layer === 'raw' ? asString(event.role) : asString(event.subtype),
    status: asString(event.status),
    toolName: asString(event.toolName),
    sourceLabel: layer === 'raw' ? '' : asString(event.label),
    recordType: layer === 'raw' ? asString(event.recordType) : '',
    payloadType: layer === 'raw' ? asString(event.payloadType) : asString(event.subtype),
    preview: asString(event.preview),
    searchText: asString(event.searchText),
    filterFiles: [...new Set(filterFiles)],
    suggestionFiles: [...new Set(touchedFiles)],
    scriptOperation: Boolean(presentation?.scriptOperation),
    declaredRequestNames,
    requestEvidence: asString(presentation?.requestEvidence),
  };
}

function rowsForSession(session, layer, presentationForEvent) {
  return eventsForSessionLayer(session, layer).map((event, physicalLayerOrdinal) => (
    rowForEvent(session, layer, event, physicalLayerOrdinal, presentationForEvent)
  ));
}

function createProjectionDigestWriter() {
  const hash = createHash('sha256');
  const write = (value) => {
    const text = typeof value === 'string' ? value : String(value);
    hash.update(`${Buffer.byteLength(text, 'utf8')}:`, 'utf8');
    hash.update(text, 'utf8');
  };
  const writeList = (values) => {
    write(values.length);
    for (const value of values) write(value);
  };
  const writeRow = (row) => {
    write(row.eventId);
    write(row.timestamp);
    write(row.physicalLayerOrdinal);
    write(row.kind);
    write(row.subtype);
    write(row.status);
    write(row.toolName);
    write(row.sourceLabel);
    write(row.recordType);
    write(row.payloadType);
    write(row.preview);
    write(row.searchText);
    writeList(row.filterFiles);
    writeList(row.suggestionFiles);
    write(row.scriptOperation ? '1' : '0');
    writeList(row.declaredRequestNames);
    write(row.requestEvidence);
  };
  write('project-query-projection-v1');
  return {
    writeLayer(layer, rowCount) {
      write(layer);
      write(rowCount);
    },
    writeRow,
    finish() {
      return hash.digest('base64url');
    },
  };
}

function projectQueryProjectionDigest(session, presentationForEvent = () => null) {
  const writer = createProjectionDigestWriter();
  for (const layer of PROJECT_QUERY_LAYERS) {
    const rows = rowsForSession(session, layer, presentationForEvent);
    writer.writeLayer(layer, rows.length);
    for (const row of rows) writer.writeRow(row);
  }
  return writer.finish();
}

async function projectQueryProjectionDigestAsync(
  session,
  presentationForEvent = () => null,
  options = {},
) {
  const { signal, onChunk } = options;
  const writer = createProjectionDigestWriter();
  let rowsSinceYield = 0;
  let chunkIndex = 0;
  const checkpoint = async (layer) => {
    throwIfAborted(signal);
    onChunk?.({ phase: 'materialized_projection', layer, chunkIndex, rowCount: rowsSinceYield });
    chunkIndex += 1;
    rowsSinceYield = 0;
    await yieldToEventLoop();
    throwIfAborted(signal);
  };
  for (const layer of PROJECT_QUERY_LAYERS) {
    writer.writeLayer(layer, eventCountForSessionLayer(session, layer));
    const events = layer === 'raw' ? session.rawEvents : session.logicalEvents;
    let physicalLayerOrdinal = 0;
    for (const event of events) {
      if (layer !== 'raw' && event.layer !== layer) continue;
      writer.writeRow(rowForEvent(
        session,
        layer,
        event,
        physicalLayerOrdinal,
        presentationForEvent,
      ));
      physicalLayerOrdinal += 1;
      rowsSinceYield += 1;
      if (rowsSinceYield >= PROJECT_QUERY_VERIFICATION_ROWS_PER_YIELD) {
        await checkpoint(layer);
      }
    }
    await checkpoint(layer);
  }
  return writer.finish();
}

function createStringInterner() {
  const values = [''];
  const ids = new Map([['', EMPTY_STRING_ID]]);
  return {
    intern(value) {
      const text = asString(value);
      const existing = ids.get(text);
      if (existing !== undefined) return existing;
      const id = values.length;
      values.push(text);
      ids.set(text, id);
      return id;
    },
    finish() {
      const encoded = values.map((value) => Buffer.from(value, 'utf8'));
      const offsets = new Uint32Array(values.length + 1);
      let byteLength = 0;
      for (let index = 0; index < encoded.length; index += 1) {
        offsets[index] = byteLength;
        byteLength += encoded[index].length;
        if (byteLength > 0xffff_ffff) throw contractError('shared dictionary exceeds 4 GiB');
      }
      offsets[encoded.length] = byteLength;
      return {
        utf8: Buffer.concat(encoded, byteLength),
        offsets,
      };
    },
  };
}

function uint32Column(rows, valueForRow) {
  return Uint32Array.from(rows, valueForRow);
}

function listColumn(rows, valuesForRow, intern) {
  const offsets = new Uint32Array(rows.length + 1);
  const values = [];
  for (let index = 0; index < rows.length; index += 1) {
    offsets[index] = values.length;
    for (const value of valuesForRow(rows[index])) values.push(intern(value));
  }
  offsets[rows.length] = values.length;
  return { offsets, values: Uint32Array.from(values) };
}

function encodeTextFrame(row) {
  const preview = Buffer.from(row.preview, 'utf8');
  const searchText = Buffer.from(row.searchText, 'utf8');
  const frame = Buffer.allocUnsafe(8 + preview.length + searchText.length);
  frame.writeUInt32LE(preview.length, 0);
  frame.writeUInt32LE(searchText.length, 4);
  preview.copy(frame, 8);
  searchText.copy(frame, 8 + preview.length);
  return frame;
}

function makeTextChunk(layer, frames, rowStart) {
  const rowOffsets = new Uint32Array(frames.length + 1);
  let uncompressedBytes = 0;
  for (let index = 0; index < frames.length; index += 1) {
    rowOffsets[index] = uncompressedBytes;
    uncompressedBytes += frames[index].length;
  }
  rowOffsets[frames.length] = uncompressedBytes;
  const plain = Buffer.concat(frames, uncompressedBytes);
  const codec = layer === 'main' || uncompressedBytes < PROJECT_QUERY_GZIP_MIN_BYTES
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

function buildTextChunks(rows, layer) {
  const chunks = [];
  let frames = [];
  let frameBytes = 0;
  let rowStart = 0;
  const flush = () => {
    if (!frames.length) return;
    chunks.push(makeTextChunk(layer, frames, rowStart));
    rowStart += frames.length;
    frames = [];
    frameBytes = 0;
  };
  for (const row of rows) {
    const frame = encodeTextFrame(row);
    if (frame.length > PROJECT_QUERY_CHUNK_MAX_BYTES) {
      throw contractError(`single ${layer} text row exceeds 4 MiB`);
    }
    if (frames.length >= PROJECT_QUERY_CHUNK_MAX_ROWS
        || frameBytes + frame.length > PROJECT_QUERY_CHUNK_MAX_BYTES) flush();
    frames.push(frame);
    frameBytes += frame.length;
  }
  flush();
  return chunks;
}

function buildLayerShard(rows, layer, interner) {
  const intern = (value) => interner.intern(value);
  const filterFiles = listColumn(rows, (row) => row.filterFiles, intern);
  const suggestionFiles = listColumn(rows, (row) => row.suggestionFiles, intern);
  const declaredRequests = listColumn(rows, (row) => row.declaredRequestNames, intern);
  return {
    layer,
    rowCount: rows.length,
    eventId: uint32Column(rows, (row) => intern(row.eventId)),
    timestamp: uint32Column(rows, (row) => intern(row.timestamp)),
    physicalLayerOrdinal: uint32Column(rows, (row) => row.physicalLayerOrdinal),
    kind: uint32Column(rows, (row) => intern(row.kind)),
    subtype: uint32Column(rows, (row) => intern(row.subtype)),
    status: uint32Column(rows, (row) => intern(row.status)),
    toolName: uint32Column(rows, (row) => intern(row.toolName)),
    sourceLabel: uint32Column(rows, (row) => intern(row.sourceLabel)),
    recordType: uint32Column(rows, (row) => intern(row.recordType)),
    payloadType: uint32Column(rows, (row) => intern(row.payloadType)),
    filterFileOffsets: filterFiles.offsets,
    filterFileValues: filterFiles.values,
    suggestionFileOffsets: suggestionFiles.offsets,
    suggestionFileValues: suggestionFiles.values,
    scriptOperation: Uint8Array.from(rows, (row) => Number(row.scriptOperation)),
    declaredRequestOffsets: declaredRequests.offsets,
    declaredRequestValues: declaredRequests.values,
    requestEvidence: uint32Column(rows, (row) => intern(row.requestEvidence)),
    textChunks: buildTextChunks(rows, layer),
  };
}

function bufferBytes(value) {
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

function shardAccountedBytes(shard) {
  let total = 0;
  for (const value of Object.values(shard)) total += bufferBytes(value);
  for (const chunk of shard.textChunks) {
    total += chunk.data.byteLength;
    total += chunk.rowOffsets.byteLength;
  }
  return total;
}

function storeAccountedBytes(store) {
  let total = store.dictionaries.utf8.byteLength + store.dictionaries.offsets.byteLength;
  for (const shards of store.shardsBySessionId.values()) {
    for (const layer of PROJECT_QUERY_LAYERS) total += shardAccountedBytes(shards[layer]);
  }
  return total;
}

function createProjectQueryStoreBuilder(options = {}) {
  const presentationForEvent = typeof options.presentationForEvent === 'function'
    ? options.presentationForEvent
    : () => null;
  const interner = createStringInterner();
  const shardsBySessionId = new Map();
  const sessionIds = [];
  let totalRows = 0;
  let finished = false;

  const addSession = (session) => {
    if (finished) throw contractError('builder is already finished');
    const sessionId = asString(session?.id);
    if (!sessionId || shardsBySessionId.has(sessionId)) {
      throw contractError(`invalid or duplicate session ID ${JSON.stringify(sessionId)}`);
    }
    if (!Array.isArray(session.rawEvents) || !Array.isArray(session.logicalEvents)) {
      throw contractError(`session ${sessionId} must expose complete event arrays while building`);
    }
    const shards = {};
    const projectionWriter = createProjectionDigestWriter();
    for (const layer of PROJECT_QUERY_LAYERS) {
      const rows = rowsForSession(session, layer, presentationForEvent);
      projectionWriter.writeLayer(layer, rows.length);
      for (const row of rows) projectionWriter.writeRow(row);
      totalRows += rows.length;
      if (totalRows > PROJECT_QUERY_STORE_MAX_ROWS) throw contractError('row count exceeds 5,000,000');
      shards[layer] = buildLayerShard(rows, layer, interner);
    }
    shards.projectionDigest = projectionWriter.finish();
    shardsBySessionId.set(sessionId, shards);
    sessionIds.push(sessionId);
    return shards.projectionDigest;
  };

  const finish = () => {
    if (finished) throw contractError('builder is already finished');
    finished = true;
    const store = {
      schemaVersion: PROJECT_QUERY_STORE_SCHEMA_VERSION,
      shardsBySessionId,
      dictionaries: interner.finish(),
      accountedBytes: 0,
    };
    store.accountedBytes = storeAccountedBytes(store);
    if (store.accountedBytes > PROJECT_QUERY_STORE_MAX_BYTES) throw contractError('encoded bytes exceed 8 GiB');
    validateProjectQueryStore(store, sessionIds, { verifyProjectionDigest: false });
    // The shared builder derives encoded rows and their digest from the same
    // closed row projection. Mark that construction result as query-ready;
    // adapter Index commit still calls the public validator and recomputes the
    // digest from encoded bytes before accepting an arbitrary built Index.
    validatedStores.set(store, {
      accountedBytes: store.accountedBytes,
      dictionaries: store.dictionaries,
      projectionDigestVerified: true,
      shardsBySessionId: store.shardsBySessionId,
    });
    return store;
  };

  return Object.freeze({ addSession, finish });
}

function buildProjectQueryStore(sessions, options = {}) {
  if (!Array.isArray(sessions)) throw contractError('sessions must be an array');
  const builder = createProjectQueryStoreBuilder(options);
  for (const session of sessions) builder.addSession(session);
  return builder.finish();
}

function requireUintColumn(value, length, owner) {
  if (!(value instanceof Uint32Array) || value.length !== length) {
    throw contractError(`${owner} must be a Uint32Array of length ${length}`);
  }
}

function requireListColumn(offsets, values, rowCount, owner) {
  requireUintColumn(offsets, rowCount + 1, `${owner}.offsets`);
  if (!(values instanceof Uint32Array)) throw contractError(`${owner}.values must be a Uint32Array`);
  if (offsets[0] !== 0 || offsets[rowCount] !== values.length) {
    throw contractError(`${owner} offsets do not close over values`);
  }
  for (let index = 1; index < offsets.length; index += 1) {
    if (offsets[index] < offsets[index - 1]) throw contractError(`${owner} offsets must increase`);
  }
}

function dictionarySize(store) {
  return store.dictionaries.offsets.length - 1;
}

function validateDictionaryIds(values, size, owner) {
  for (const value of values) {
    if (value >= size) throw contractError(`${owner} contains an out-of-range dictionary ID`);
  }
}

function validateLayerShard(store, shard, layer) {
  requireExactDataKeys(shard, [
    'layer', 'rowCount', 'eventId', 'timestamp', 'physicalLayerOrdinal',
    'kind', 'subtype', 'status', 'toolName', 'sourceLabel', 'recordType',
    'payloadType', 'filterFileOffsets', 'filterFileValues',
    'suggestionFileOffsets', 'suggestionFileValues', 'scriptOperation',
    'declaredRequestOffsets', 'declaredRequestValues', 'requestEvidence',
    'textChunks',
  ], `${layer} shard`);
  if (shard.layer !== layer) throw contractError(`${layer} shard layer mismatch`);
  if (!Number.isSafeInteger(shard.rowCount) || shard.rowCount < 0) throw contractError(`${layer} rowCount is invalid`);
  const rowCount = shard.rowCount;
  const dictionaryColumns = [
    'eventId', 'timestamp', 'kind', 'subtype', 'status', 'toolName',
    'sourceLabel', 'recordType', 'payloadType', 'requestEvidence',
  ];
  for (const name of dictionaryColumns) requireUintColumn(shard[name], rowCount, `${layer}.${name}`);
  requireUintColumn(shard.physicalLayerOrdinal, rowCount, `${layer}.physicalLayerOrdinal`);
  if (!(shard.scriptOperation instanceof Uint8Array) || shard.scriptOperation.length !== rowCount) {
    throw contractError(`${layer}.scriptOperation must be a Uint8Array of rowCount length`);
  }
  requireListColumn(shard.filterFileOffsets, shard.filterFileValues, rowCount, `${layer}.filterFiles`);
  requireListColumn(shard.suggestionFileOffsets, shard.suggestionFileValues, rowCount, `${layer}.suggestionFiles`);
  requireListColumn(shard.declaredRequestOffsets, shard.declaredRequestValues, rowCount, `${layer}.declaredRequests`);
  const size = dictionarySize(store);
  for (const name of dictionaryColumns) validateDictionaryIds(shard[name], size, `${layer}.${name}`);
  validateDictionaryIds(shard.filterFileValues, size, `${layer}.filterFiles`);
  validateDictionaryIds(shard.suggestionFileValues, size, `${layer}.suggestionFiles`);
  validateDictionaryIds(shard.declaredRequestValues, size, `${layer}.declaredRequests`);
  const ids = new Set();
  for (let index = 0; index < rowCount; index += 1) {
    if (shard.physicalLayerOrdinal[index] !== index) throw contractError(`${layer} physical ordinals must be contiguous`);
    if (shard.scriptOperation[index] > 1) throw contractError(`${layer} scriptOperation values must be boolean bytes`);
    const id = dictionaryString(store, shard.eventId[index]);
    if (!id || ids.has(id)) throw contractError(`${layer} event IDs must be non-empty and unique`);
    ids.add(id);
  }
  if (!Array.isArray(shard.textChunks)) throw contractError(`${layer}.textChunks must be an array`);
  let expectedRowStart = 0;
  for (const chunk of shard.textChunks) {
    requireExactDataKeys(chunk, [
      'rowStart', 'rowCount', 'uncompressedBytes', 'codec', 'data', 'rowOffsets',
    ], `${layer} text chunk`);
    if (chunk.rowStart !== expectedRowStart
        || !Number.isSafeInteger(chunk.rowCount)
        || chunk.rowCount < 1
        || chunk.rowCount > PROJECT_QUERY_CHUNK_MAX_ROWS) {
      throw contractError(`${layer} text chunk row bounds are invalid`);
    }
    if (!Number.isSafeInteger(chunk.uncompressedBytes)
        || chunk.uncompressedBytes < 0
        || chunk.uncompressedBytes > PROJECT_QUERY_CHUNK_MAX_BYTES) {
      throw contractError(`${layer} text chunk byte bounds are invalid`);
    }
    const expectedCodec = layer === 'main' || chunk.uncompressedBytes < PROJECT_QUERY_GZIP_MIN_BYTES
      ? 'identity'
      : 'gzip-1';
    if (chunk.codec !== expectedCodec) throw contractError(`${layer} text chunk codec is invalid`);
    if (!Buffer.isBuffer(chunk.data)) throw contractError(`${layer} text chunk data must be a Buffer`);
    if (chunk.codec === 'identity' && chunk.data.length !== chunk.uncompressedBytes) {
      throw contractError(`${layer} identity chunk byte length is invalid`);
    }
    requireUintColumn(chunk.rowOffsets, chunk.rowCount + 1, `${layer}.textChunk.rowOffsets`);
    if (chunk.rowOffsets[0] !== 0 || chunk.rowOffsets[chunk.rowCount] !== chunk.uncompressedBytes) {
      throw contractError(`${layer} text chunk offsets do not close over bytes`);
    }
    for (let index = 1; index < chunk.rowOffsets.length; index += 1) {
      if (chunk.rowOffsets[index] < chunk.rowOffsets[index - 1]) {
        throw contractError(`${layer} text chunk offsets must increase`);
      }
      if (chunk.rowOffsets[index] - chunk.rowOffsets[index - 1] < 8) {
        throw contractError(`${layer} text chunk frames must include both length fields`);
      }
    }
    expectedRowStart += chunk.rowCount;
  }
  if (expectedRowStart !== rowCount) throw contractError(`${layer} text chunks must cover every row`);
}

function projectionDigestFromStoredShards(store, shards) {
  const writer = createProjectionDigestWriter();
  for (const layer of PROJECT_QUERY_LAYERS) {
    const shard = shards[layer];
    writer.writeLayer(layer, shard.rowCount);
    for (const chunk of shard.textChunks) {
      let decoded;
      try {
        decoded = chunk.codec === 'identity' ? chunk.data : gunzipSync(chunk.data);
      } catch (error) {
        throw contractError(`${layer} text chunk cannot be decoded: ${error.message}`);
      }
      if (decoded.length !== chunk.uncompressedBytes) {
        throw contractError(`${layer} chunk inflated length mismatch`);
      }
      for (let localIndex = 0; localIndex < chunk.rowCount; localIndex += 1) {
        const rowIndex = chunk.rowStart + localIndex;
        const metadata = metadataRow(store, shard, rowIndex);
        const text = decodeTextFrame(
          decoded,
          chunk.rowOffsets[localIndex],
          chunk.rowOffsets[localIndex + 1],
        );
        writer.writeRow({
          eventId: metadata.eventId,
          timestamp: metadata.timestamp,
          physicalLayerOrdinal: metadata.physicalLayerOrdinal,
          kind: metadata.kind,
          subtype: metadata.subtype,
          status: metadata.status,
          toolName: metadata.toolName,
          sourceLabel: metadata.labelFact.sourceLabel,
          recordType: metadata.labelFact.recordType,
          payloadType: metadata.labelFact.payloadType,
          preview: text.preview,
          searchText: text.searchText,
          filterFiles: metadata.filterFiles,
          suggestionFiles: metadata.suggestionFiles,
          scriptOperation: metadata.presentation.scriptOperation,
          declaredRequestNames: metadata.presentation.declaredRequestNames,
          requestEvidence: metadata.presentation.requestEvidence,
        });
      }
      decoded = null;
    }
  }
  return writer.finish();
}

async function projectionDigestFromStoredShardsAsync(store, shards, options = {}) {
  const { signal, onChunk, sessionId = '' } = options;
  const writer = createProjectionDigestWriter();
  let chunkIndex = 0;
  for (const layer of PROJECT_QUERY_LAYERS) {
    const shard = shards[layer];
    writer.writeLayer(layer, shard.rowCount);
    for (const chunk of shard.textChunks) {
      throwIfAborted(signal);
      let decoded;
      try {
        decoded = chunk.codec === 'identity' ? chunk.data : await gunzipAsync(chunk.data);
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        throw contractError(`${layer} text chunk cannot be decoded: ${error.message}`);
      }
      throwIfAborted(signal);
      if (decoded.length !== chunk.uncompressedBytes) {
        throw contractError(`${layer} chunk inflated length mismatch`);
      }
      let rowsSinceYield = 0;
      const checkpoint = async () => {
        throwIfAborted(signal);
        onChunk?.({
          phase: 'stored_projection',
          sessionId,
          layer,
          chunkIndex,
          rowCount: rowsSinceYield,
        });
        chunkIndex += 1;
        rowsSinceYield = 0;
        await yieldToEventLoop();
        throwIfAborted(signal);
      };
      for (let localIndex = 0; localIndex < chunk.rowCount; localIndex += 1) {
        const rowIndex = chunk.rowStart + localIndex;
        const metadata = metadataRow(store, shard, rowIndex);
        const text = decodeTextFrame(
          decoded,
          chunk.rowOffsets[localIndex],
          chunk.rowOffsets[localIndex + 1],
        );
        writer.writeRow({
          eventId: metadata.eventId,
          timestamp: metadata.timestamp,
          physicalLayerOrdinal: metadata.physicalLayerOrdinal,
          kind: metadata.kind,
          subtype: metadata.subtype,
          status: metadata.status,
          toolName: metadata.toolName,
          sourceLabel: metadata.labelFact.sourceLabel,
          recordType: metadata.labelFact.recordType,
          payloadType: metadata.labelFact.payloadType,
          preview: text.preview,
          searchText: text.searchText,
          filterFiles: metadata.filterFiles,
          suggestionFiles: metadata.suggestionFiles,
          scriptOperation: metadata.presentation.scriptOperation,
          declaredRequestNames: metadata.presentation.declaredRequestNames,
          requestEvidence: metadata.presentation.requestEvidence,
        });
        rowsSinceYield += 1;
        if (rowsSinceYield >= PROJECT_QUERY_VERIFICATION_ROWS_PER_YIELD) {
          await checkpoint();
        }
      }
      if (rowsSinceYield > 0) await checkpoint();
      decoded = null;
    }
  }
  return writer.finish();
}

function currentValidationForStore(store) {
  const prior = store && typeof store === 'object' ? validatedStores.get(store) : null;
  if (!prior
      || store.schemaVersion !== PROJECT_QUERY_STORE_SCHEMA_VERSION
      || store.shardsBySessionId !== prior.shardsBySessionId
      || store.dictionaries !== prior.dictionaries
      || store.accountedBytes !== prior.accountedBytes) {
    return null;
  }
  return prior;
}

function validateExpectedSessionIds(store, expectedSessionIds) {
  if (!expectedSessionIds) return;
  const expected = new Set(expectedSessionIds);
  if (expected.size !== store.shardsBySessionId.size
      || [...expected].some((id) => !store.shardsBySessionId.has(id))) {
    throw contractError('session shard ownership does not match the Index');
  }
}

function validateProjectQueryStore(store, expectedSessionIds = null, options = {}) {
  const verifyProjectionDigest = options.verifyProjectionDigest !== false;
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw contractError('store must be an object');
  requireExactDataKeys(store, [
    'schemaVersion', 'shardsBySessionId', 'dictionaries', 'accountedBytes',
  ], 'store');
  if (store.schemaVersion !== PROJECT_QUERY_STORE_SCHEMA_VERSION) {
    throw contractError(`schemaVersion must be ${PROJECT_QUERY_STORE_SCHEMA_VERSION}`);
  }
  if (!(store.shardsBySessionId instanceof Map)) throw contractError('shardsBySessionId must be a Map');
  requireExactDataKeys(store.dictionaries, ['utf8', 'offsets'], 'dictionaries');
  if (!Buffer.isBuffer(store.dictionaries.utf8)) {
    throw contractError('dictionary UTF-8 data must be a Buffer');
  }
  if (!(store.dictionaries.offsets instanceof Uint32Array)
      || store.dictionaries.offsets.length < 2
      || store.dictionaries.offsets[0] !== 0
      || store.dictionaries.offsets.at(-1) !== store.dictionaries.utf8.length) {
    throw contractError('dictionary offsets are invalid');
  }
  for (let index = 1; index < store.dictionaries.offsets.length; index += 1) {
    if (store.dictionaries.offsets[index] < store.dictionaries.offsets[index - 1]) {
      throw contractError('dictionary offsets must increase');
    }
  }
  const dictionaryValues = new Set();
  for (let index = 0; index < store.dictionaries.offsets.length - 1; index += 1) {
    const start = store.dictionaries.offsets[index];
    const end = store.dictionaries.offsets[index + 1];
    const bytes = store.dictionaries.utf8.subarray(start, end);
    const value = bytes.toString('utf8');
    if (!Buffer.from(value, 'utf8').equals(bytes)) throw contractError('dictionary contains invalid UTF-8');
    if (dictionaryValues.has(value)) throw contractError('dictionary strings must be unique');
    dictionaryValues.add(value);
  }
  if (!dictionaryValues.has('') || dictionaryString(store, EMPTY_STRING_ID) !== '') {
    throw contractError('dictionary ID zero must be the empty string');
  }
  let totalRows = 0;
  for (const [sessionId, shards] of store.shardsBySessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw contractError('session shard keys must be non-empty strings');
    requireExactDataKeys(shards, [...PROJECT_QUERY_LAYERS, 'projectionDigest'], `session ${sessionId} shards`);
    if (typeof shards.projectionDigest !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/u.test(shards.projectionDigest)) {
      throw contractError(`session ${sessionId} projection digest is invalid`);
    }
    for (const layer of PROJECT_QUERY_LAYERS) {
      validateLayerShard(store, shards[layer], layer);
      totalRows += shards[layer].rowCount;
    }
    if (verifyProjectionDigest
        && projectionDigestFromStoredShards(store, shards) !== shards.projectionDigest) {
      throw contractError(`session ${sessionId} projection digest does not match encoded rows`);
    }
  }
  if (totalRows > PROJECT_QUERY_STORE_MAX_ROWS) throw contractError('row count exceeds 5,000,000');
  validateExpectedSessionIds(store, expectedSessionIds);
  const accountedBytes = storeAccountedBytes(store);
  if (!Number.isSafeInteger(store.accountedBytes)
      || store.accountedBytes !== accountedBytes
      || accountedBytes > PROJECT_QUERY_STORE_MAX_BYTES) {
    throw contractError('accountedBytes does not equal encoded storage');
  }
  validatedStores.set(store, {
    accountedBytes: store.accountedBytes,
    dictionaries: store.dictionaries,
    projectionDigestVerified: verifyProjectionDigest,
    shardsBySessionId: store.shardsBySessionId,
  });
  return store;
}

async function validateProjectQueryStoreForCommit(store, expectedSessionIds = null, options = {}) {
  const { signal, onChunk, structurallyValidated = false } = options;
  throwIfAborted(signal);
  if (!structurallyValidated || !currentValidationForStore(store)) {
    validateProjectQueryStore(store, expectedSessionIds, { verifyProjectionDigest: false });
  } else {
    validateExpectedSessionIds(store, expectedSessionIds);
  }
  // Structural validation above is synchronous. Always yield before digest
  // admission so cancellation queued during that work becomes observable.
  await yieldToEventLoop();
  throwIfAborted(signal);
  for (const [sessionId, shards] of store.shardsBySessionId) {
    const digest = await projectionDigestFromStoredShardsAsync(store, shards, {
      signal,
      onChunk,
      sessionId,
    });
    if (digest !== shards.projectionDigest) {
      throw contractError(`session ${sessionId} projection digest does not match encoded rows`);
    }
  }
  throwIfAborted(signal);
  validatedStores.set(store, {
    accountedBytes: store.accountedBytes,
    dictionaries: store.dictionaries,
    projectionDigestVerified: true,
    shardsBySessionId: store.shardsBySessionId,
  });
  return store;
}

function requireValidatedProjectQueryStore(store, expectedSessionIds = null) {
  const prior = currentValidationForStore(store);
  if (!prior || prior.projectionDigestVerified !== true) {
    return validateProjectQueryStore(store, expectedSessionIds);
  }
  validateExpectedSessionIds(store, expectedSessionIds);
  return store;
}

function dictionaryString(store, id) {
  const offsets = store.dictionaries.offsets;
  if (!Number.isSafeInteger(id) || id < 0 || id >= offsets.length - 1) {
    throw contractError('dictionary ID is out of range');
  }
  return store.dictionaries.utf8.toString('utf8', offsets[id], offsets[id + 1]);
}

function dictionaryList(store, offsets, values, rowIndex) {
  const result = [];
  for (let index = offsets[rowIndex]; index < offsets[rowIndex + 1]; index += 1) {
    result.push(dictionaryString(store, values[index]));
  }
  return result;
}

function metadataRow(store, shard, rowIndex) {
  return {
    eventId: dictionaryString(store, shard.eventId[rowIndex]),
    timestamp: dictionaryString(store, shard.timestamp[rowIndex]),
    physicalLayerOrdinal: shard.physicalLayerOrdinal[rowIndex],
    kind: dictionaryString(store, shard.kind[rowIndex]),
    subtype: dictionaryString(store, shard.subtype[rowIndex]),
    status: dictionaryString(store, shard.status[rowIndex]),
    toolName: dictionaryString(store, shard.toolName[rowIndex]),
    labelFact: {
      sourceLabel: dictionaryString(store, shard.sourceLabel[rowIndex]),
      recordType: dictionaryString(store, shard.recordType[rowIndex]),
      payloadType: dictionaryString(store, shard.payloadType[rowIndex]),
    },
    filterFiles: dictionaryList(store, shard.filterFileOffsets, shard.filterFileValues, rowIndex),
    suggestionFiles: dictionaryList(store, shard.suggestionFileOffsets, shard.suggestionFileValues, rowIndex),
    presentation: {
      scriptOperation: Boolean(shard.scriptOperation[rowIndex]),
      declaredRequestNames: dictionaryList(
        store,
        shard.declaredRequestOffsets,
        shard.declaredRequestValues,
        rowIndex,
      ),
      requestEvidence: dictionaryString(store, shard.requestEvidence[rowIndex]),
    },
  };
}

function decodeTextFrame(buffer, start, end) {
  if (end - start < 8) throw contractError('text frame is truncated');
  const previewLength = buffer.readUInt32LE(start);
  const searchLength = buffer.readUInt32LE(start + 4);
  const previewStart = start + 8;
  const searchStart = previewStart + previewLength;
  if (searchStart + searchLength !== end) throw contractError('text frame lengths are invalid');
  return {
    preview: buffer.toString('utf8', previewStart, searchStart),
    searchText: buffer.toString('utf8', searchStart, end),
  };
}

function decodePreviewFrame(buffer, start, end) {
  if (end - start < 8) throw contractError('text frame is truncated');
  const previewLength = buffer.readUInt32LE(start);
  const searchLength = buffer.readUInt32LE(start + 4);
  const previewStart = start + 8;
  const searchStart = previewStart + previewLength;
  if (searchStart + searchLength !== end) throw contractError('text frame lengths are invalid');
  return buffer.toString('utf8', previewStart, searchStart);
}

async function scanProjectQueryShard(store, sessionId, layer, options, visit) {
  requireValidatedProjectQueryStore(store);
  if (!PROJECT_QUERY_LAYERS.includes(layer)) throw contractError(`unsupported layer ${layer}`);
  const shard = store.shardsBySessionId.get(sessionId)?.[layer];
  if (!shard) return false;
  const includeText = options?.includeText === true;
  const signal = options?.signal;
  throwIfAborted(signal);
  for (const chunk of shard.textChunks) {
    throwIfAborted(signal);
    let decoded = null;
    if (includeText) {
      decoded = chunk.codec === 'identity' ? chunk.data : await gunzipAsync(chunk.data);
      throwIfAborted(signal);
      if (decoded.length !== chunk.uncompressedBytes) throw contractError(`${layer} chunk inflated length mismatch`);
      options?.onTextChunk?.({
        sessionId,
        layer,
        rowStart: chunk.rowStart,
        rowCount: chunk.rowCount,
      });
    }
    for (let localIndex = 0; localIndex < chunk.rowCount; localIndex += 1) {
      if ((localIndex & 0xfff) === 0) throwIfAborted(signal);
      const rowIndex = chunk.rowStart + localIndex;
      const row = metadataRow(store, shard, rowIndex);
      if (includeText) {
        Object.assign(row, decodeTextFrame(
          decoded,
          chunk.rowOffsets[localIndex],
          chunk.rowOffsets[localIndex + 1],
        ));
      }
      visit(row, rowIndex);
    }
    decoded = null;
    options?.onChunk?.({ sessionId, layer, rowStart: chunk.rowStart, rowCount: chunk.rowCount });
    await yieldToEventLoop();
    throwIfAborted(signal);
  }
  return true;
}

function projectQueryProjectionDigestForSession(store, sessionId, options = {}) {
  if (options.requireVerified === false) {
    if (!currentValidationForStore(store)) {
      validateProjectQueryStore(store, null, { verifyProjectionDigest: false });
    }
  } else {
    requireValidatedProjectQueryStore(store);
  }
  const digest = store.shardsBySessionId.get(sessionId)?.projectionDigest;
  if (!digest) throw contractError(`missing projection digest for session ${sessionId}`);
  return digest;
}

async function readProjectQueryRowPreview(store, sessionId, layer, rowIndex, options = {}) {
  requireValidatedProjectQueryStore(store);
  if (!PROJECT_QUERY_LAYERS.includes(layer)) throw contractError(`unsupported layer ${layer}`);
  const shard = store.shardsBySessionId.get(sessionId)?.[layer];
  if (!shard || !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= shard.rowCount) {
    throw contractError(`row ${rowIndex} is outside ${sessionId}/${layer}`);
  }
  const signal = options.signal;
  throwIfAborted(signal);
  const chunk = shard.textChunks.find((candidate) => (
    rowIndex >= candidate.rowStart && rowIndex < candidate.rowStart + candidate.rowCount
  ));
  if (!chunk) throw contractError(`row ${rowIndex} has no text chunk`);
  const decoded = chunk.codec === 'identity' ? chunk.data : await gunzipAsync(chunk.data);
  throwIfAborted(signal);
  if (decoded.length !== chunk.uncompressedBytes) throw contractError(`${layer} chunk inflated length mismatch`);
  options.onTextChunk?.({
    sessionId,
    layer,
    rowStart: chunk.rowStart,
    rowCount: chunk.rowCount,
  });
  const localIndex = rowIndex - chunk.rowStart;
  return decodePreviewFrame(
    decoded,
    chunk.rowOffsets[localIndex],
    chunk.rowOffsets[localIndex + 1],
  );
}

module.exports = {
  PROJECT_QUERY_CHUNK_MAX_BYTES,
  PROJECT_QUERY_CHUNK_MAX_ROWS,
  PROJECT_QUERY_GZIP_MIN_BYTES,
  PROJECT_QUERY_LAYERS,
  PROJECT_QUERY_STORE_SCHEMA_VERSION,
  buildProjectQueryStore,
  createProjectQueryStoreBuilder,
  dictionaryString,
  projectQueryProjectionDigest,
  projectQueryProjectionDigestAsync,
  projectQueryProjectionDigestForSession,
  readProjectQueryRowPreview,
  requireValidatedProjectQueryStore,
  scanProjectQueryShard,
  validateProjectQueryStore,
  validateProjectQueryStoreForCommit,
};
