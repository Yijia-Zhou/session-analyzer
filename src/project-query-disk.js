'use strict';

// Private, disposable query storage. Paths never come from a transcript or API.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const { StringDecoder } = require('node:string_decoder');
const { createHash } = require('node:crypto');
const { forEachJsonChunk } = require('./plain-value-stream');
const { AsyncLocalStorage } = require('node:async_hooks');
const buildScope = new AsyncLocalStorage();
const states = new WeakMap();
const live = new Set();
const TEXT_BYTES = 256 * 1024;
const PAGE_ROWS = 512;
const PAGE_BYTES = 1024 * 1024;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function close(state) {
  if (state.cleaned) return;
  state.closed = true;
  try {
    if (!state.fdClosed) { fs.closeSync(state.fd); state.fdClosed = true; }
    fs.rmSync(state.directory, { recursive: true, force: true });
    state.cleaned = true;
    live.delete(state);
  } catch (error) {
    // Cleanup must not replace a committed Index or mask the original failure.
    // Keep the resource registered for bounded retries and process-exit cleanup.
    state.cleanupAttempts = (state.cleanupAttempts || 0) + 1;
    if (state.cleanupAttempts === 1) process.emitWarning(`Temporary query storage cleanup failed (${error.code || error.name}); retrying`, { code: 'PROJECT_QUERY_STORAGE_CLEANUP_FAILED' });
    if (state.cleanupAttempts <= 3) setTimeout(() => close(state), 100 * state.cleanupAttempts).unref();
  }
}
const registry = new FinalizationRegistry((state) => { try { close(state); } catch {} });
process.once('exit', () => { for (const state of live) { try { close(state); } catch {} } });

function capacityError(error) {
  if (!['ENOSPC', 'EDQUOT', 'ENOMEM', 'EMFILE', 'ENFILE', 'EFBIG'].includes(error.code)) return error;
  const result = new Error(`Query storage resource exhausted (${error.code}); the previous Index remains valid. Free local resources and rebuild.`, { cause: error });
  result.code = 'PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED';
  return result;
}
function stateFor(store) {
  const state = states.get(store);
  if (!state || state.closed) throw new Error('Query storage is closed or unrecognized');
  return state;
}
function read(state, offset, length) {
  const buffer = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const count = fs.readSync(state.fd, buffer, done, length - done, offset + done);
    if (!count) throw new Error('Query storage is truncated');
    done += count;
  }
  return buffer;
}
function* textParts(state, reference) {
  const decoder = new StringDecoder('utf8');
  for (let done = 0; done < reference.bytes; done += TEXT_BYTES) {
    yield decoder.write(read(state, reference.start + done, Math.min(TEXT_BYTES, reference.bytes - done)));
  }
  const tail = decoder.end();
  if (tail) yield tail;
}
function textValue(state, reference) {
  return { byteLength: reference.bytes, parts: () => textParts(state, reference) };
}
function readPage(state, page) {
  const buffer = read(state, page.start, page.bytes);
  if (createHash('sha256').update(buffer).digest('hex') !== page.digest) throw new Error('Query metadata page checksum mismatch');
  const rows = v8.deserialize(buffer);
  if (!Array.isArray(rows) || rows.length !== page.rowCount) throw new Error('Query metadata row count mismatch');
  for (const row of rows) {
    for (const ref of [row.preview, row.searchText]) {
      if (!Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.bytes)
          || ref.start < 0 || ref.bytes < 0 || ref.start + ref.bytes > state.bytes) throw new Error('Query text range is invalid');
    }
  }
  return rows;
}

function createDiskBuilder(helpers, options = {}) {
  let directory;
  let fd;
  try {
    directory = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), 'session-analyzer-query-'));
    fs.chmodSync(directory, 0o700);
    fd = fs.openSync(path.join(directory, 'rows.bin'), 'wx+', 0o600);
  } catch (error) {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    throw capacityError(error);
  }
  const state = { directory, fd, bytes: 0, closed: false };
  live.add(state);
  const store = { schemaVersion: 3, shardsBySessionId: new Map(), accountedBytes: 0 };
  states.set(store, state);
  buildScope.getStore()?.add(store);
  registry.register(store, state, store);
  let finished = false;
  const abort = () => { if (!finished) close(state); };
  options.signal?.addEventListener('abort', abort, { once: true });
  function checkpoint() { options.signal?.throwIfAborted(); stateFor(store); }
  function write(buffer) {
    checkpoint();
    const start = state.bytes;
    let done = 0;
    while (done < buffer.length) {
      const count = fs.writeSync(state.fd, buffer, done, buffer.length - done, state.bytes);
      if (!count) throw new Error('Query storage write made no progress');
      done += count;
      state.bytes += count;
    }
    return { start, bytes: buffer.length };
  }
  function* writeText(text) {
    const start = state.bytes;
    // Encode bounded UTF-16 slices, keeping surrogate pairs together.
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 65536);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      write(Buffer.from(text.slice(offset, end), 'utf8'));
      offset = end;
      if (text.length >= 65536) yield;
    }
    return { start, bytes: state.bytes - start };
  }
  function* addRows(sessionId, layers) {
    checkpoint();
    if (finished || !sessionId || store.shardsBySessionId.has(sessionId)) throw helpers.contractError('invalid or duplicate disk session');
    const shards = {};
    const digest = helpers.createProjectionDigestWriter();
    for (const layer of helpers.layers) {
      const { count, rows } = layers(layer);
      digest.writeLayer(layer, count);
      const shard = { rowCount: count, pages: [] };
      shards[layer] = shard;
      let pageRows = [];
      let pageWeight = 0;
      let ordinal = 0;
      const ids = new Set();
      const flush = () => {
        if (!pageRows.length) return;
        const bytes = v8.serialize(pageRows);
        shard.pages.push({ ...write(bytes), rowStart: ordinal - pageRows.length, rowCount: pageRows.length,
          digest: createHash('sha256').update(bytes).digest('hex') });
        pageRows = [];
        pageWeight = 0;
      };
      for (const row of rows) {
        checkpoint();
        if (row.physicalLayerOrdinal !== ordinal || !row.eventId || ids.has(row.eventId)) throw helpers.contractError('disk row identity or ordinal invalid');
        ids.add(row.eventId);
        yield* digest.writeRowSteps(row);
        const preview = yield* writeText(row.preview);
        const searchText = yield* writeText(row.searchText);
        const stored = { ...row, preview, searchText };
        pageWeight += v8.serialize(stored).length;
        pageRows.push(stored);
        ordinal += 1;
        if (pageRows.length >= PAGE_ROWS || pageWeight >= PAGE_BYTES) { flush(); yield; }
      }
      flush();
      if (ordinal !== count) throw helpers.contractError('disk row count mismatch');
    }
    shards.projectionDigest = digest.finish();
    store.shardsBySessionId.set(sessionId, shards);
    store.accountedBytes = state.bytes;
    return shards.projectionDigest;
  }
  function run(iterator) {
    try { let step; do { step = iterator.next(); } while (!step.done); return step.value; }
    catch (error) { close(state); throw capacityError(error); }
  }
  async function runAsync(iterator) {
    try {
      let steps = 0;
      for (;;) {
        const step = iterator.next();
        if (step.done) return step.value;
        // Yield after at most 1 MiB encoded text or four metadata pages.
        if (++steps % 4 === 0) { await tick(); checkpoint(); }
      }
    } catch (error) { close(state); throw capacityError(error); }
  }
  return {
    addRows: (id, layers) => run(addRows(id, layers)),
    addRowsAsync: (id, layers) => runAsync(addRows(id, layers)),
    finish() {
      try {
        checkpoint();
        fs.fsyncSync(state.fd);
        finished = true;
        options.signal?.removeEventListener('abort', abort);
        state.shards = store.shardsBySessionId;
        state.manifest = manifestDigest(store);
        return store;
      } catch (error) { close(state); throw capacityError(error); }
    },
    dispose() { close(state); },
  };
}

function manifestDigest(store) {
  const hash = createHash('sha256');
  // v8.serialize is appropriate for private page payloads, but not canonical:
  // equal values can encode differently after V8 changes internal layouts.
  for (const entry of store.shardsBySessionId) forEachJsonChunk(entry, (chunk) => hash.update(chunk, 'utf8'));
  return hash.digest('hex');
}
function validateDiskStore(store, expected, helpers, verify = true) {
  const state = stateFor(store);
  helpers.requireExactDataKeys(store, ['schemaVersion', 'shardsBySessionId', 'accountedBytes'], 'disk store');
  for (const [sessionId, shards] of store.shardsBySessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw helpers.contractError('disk session identity is invalid');
    helpers.requireExactDataKeys(shards, [...helpers.layers, 'projectionDigest'], 'disk session');
    if (typeof shards.projectionDigest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(shards.projectionDigest)) throw helpers.contractError('disk projection digest is invalid');
    for (const layer of helpers.layers) {
      const shard = shards[layer];
      helpers.requireExactDataKeys(shard, ['rowCount', 'pages'], 'disk shard');
      if (!Number.isSafeInteger(shard.rowCount) || shard.rowCount < 0 || !Array.isArray(shard.pages)) throw helpers.contractError('disk shard row bounds are invalid');
      const pageKeys = Reflect.ownKeys(shard.pages);
      if (pageKeys.length !== shard.pages.length + 1
          || pageKeys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) throw helpers.contractError('disk pages have unknown or missing fields');
      let ordinal = 0;
      for (let i = 0; i < shard.pages.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(shard.pages, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw helpers.contractError('disk pages must contain data properties');
        const page = descriptor.value;
        helpers.requireExactDataKeys(page, ['start', 'bytes', 'rowStart', 'rowCount', 'digest'], 'disk page');
        if (!Number.isSafeInteger(page.start) || page.start < 0 || !Number.isSafeInteger(page.bytes) || page.bytes < 1
            || page.start + page.bytes > state.bytes || page.rowStart !== ordinal
            || !Number.isSafeInteger(page.rowCount) || page.rowCount < 1 || page.rowCount > PAGE_ROWS
            || typeof page.digest !== 'string' || !/^[a-f0-9]{64}$/.test(page.digest)) throw helpers.contractError('disk page bounds or checksum are invalid');
        ordinal += page.rowCount;
      }
      if (ordinal !== shard.rowCount) throw helpers.contractError('disk pages must cover every row');
    }
  }
  if (store.schemaVersion !== 3 || store.shardsBySessionId !== state.shards
      || store.accountedBytes !== state.bytes || fs.fstatSync(state.fd).size !== state.bytes
      || manifestDigest(store) !== state.manifest) throw helpers.contractError('disk store manifest or bytes changed');
  if (expected && (new Set(expected).size !== store.shardsBySessionId.size || expected.some((id) => !store.shardsBySessionId.has(id)))) {
    throw helpers.contractError('session shard ownership does not match the Index');
  }
  if (verify) for (const [id] of store.shardsBySessionId) {
    const writer = helpers.createProjectionDigestWriter();
    for (const layer of helpers.layers) {
      const shard = store.shardsBySessionId.get(id)[layer];
      writer.writeLayer(layer, shard.rowCount);
      for (const page of shard.pages) for (const row of readPage(state, page)) {
        writer.writeRow({ ...row, preview: textValue(state, row.preview), searchText: textValue(state, row.searchText) });
      }
    }
    if (writer.finish() !== store.shardsBySessionId.get(id).projectionDigest) throw helpers.contractError('disk projection digest mismatch');
  }
  return store;
}
function requireDiskStore(store, expected, helpers) {
  const state = stateFor(store);
  // The builder/commit validator admitted the immutable projection. Match the
  // packed-store validation cache: do not rehash a whole project per shard.
  if (store.schemaVersion !== 3 || store.shardsBySessionId !== state.shards
      || store.accountedBytes !== state.bytes) throw helpers.contractError('disk store identity or bytes changed');
  if (expected && (new Set(expected).size !== store.shardsBySessionId.size || expected.some((id) => !store.shardsBySessionId.has(id)))) {
    throw helpers.contractError('session shard ownership does not match the Index');
  }
  return store;
}
async function validateDiskStoreForCommit(store, expected, helpers, options = {}) {
  options.signal?.throwIfAborted();
  validateDiskStore(store, expected, helpers, false);
  const state = stateFor(store);
  for (const [sessionId, shards] of store.shardsBySessionId) {
    const writer = helpers.createProjectionDigestWriter();
    for (const layer of helpers.layers) {
      writer.writeLayer(layer, shards[layer].rowCount);
      for (const page of shards[layer].pages) {
        for (const row of readPage(state, page)) {
          await writer.writeRowAsync({ ...row, preview: textValue(state, row.preview), searchText: textValue(state, row.searchText) }, options.signal);
        }
        options.onChunk?.({ phase: 'stored_projection', sessionId, layer, rowCount: page.rowCount });
        await tick();
        options.signal?.throwIfAborted();
      }
    }
    if (writer.finish() !== shards.projectionDigest) throw helpers.contractError('disk projection digest mismatch');
  }
  return store;
}

function metadata(row) {
  const { sourceLabel, recordType, payloadType, scriptOperation, declaredRequestNames, requestEvidence,
    preview, searchText, ...rest } = row;
  return { ...rest, labelFact: { sourceLabel, recordType, payloadType },
    presentation: { scriptOperation, declaredRequestNames, requestEvidence } };
}
async function scanDiskShard(store, sessionId, layer, options, visit) {
  const state = stateFor(store);
  const shard = store.shardsBySessionId.get(sessionId)?.[layer];
  if (!shard) return false;
  for (const page of shard.pages) {
    options?.signal?.throwIfAborted();
    const rows = readPage(state, page);
    for (let i = 0; i < rows.length; i += 1) {
      const stored = rows[i];
      const row = metadata(stored);
      if (options?.includeText) {
        if (options.searchTextParts) {
          row.searchMatch = await options.searchTextParts(textParts(state, stored.preview), textParts(state, stored.searchText), options.signal);
        } else {
          // Internal compatibility scan: text remains lazy, never one giant join.
          row.preview = textValue(state, stored.preview);
          row.searchText = textValue(state, stored.searchText);
        }
      }
      visit(row, page.rowStart + i);
    }
    const info = { sessionId, layer, rowStart: page.rowStart, rowCount: page.rowCount };
    if (options?.includeText) options.onTextChunk?.(info);
    options?.onChunk?.(info);
    await tick();
    options?.signal?.throwIfAborted();
  }
  return true;
}
async function readDiskPreview(store, id, layer, ordinal, options = {}) {
  const state = stateFor(store);
  const shard = store.shardsBySessionId.get(id)?.[layer];
  const page = shard?.pages.find((p) => ordinal >= p.rowStart && ordinal < p.rowStart + p.rowCount);
  if (!page) throw new Error('Query row is outside the shard');
  options.signal?.throwIfAborted();
  const ref = readPage(state, page)[ordinal - page.rowStart].preview;
  // Preview is a display field. Return a bounded preview without reading search text.
  let result = '';
  for (const part of textParts(state, ref)) { result += part.slice(0, 2000 - result.length); if (result.length >= 2000) break; }
  options.onTextChunk?.({ sessionId: id, layer, rowStart: page.rowStart, rowCount: page.rowCount });
  return result;
}
function disposeDiskStore(store) {
  const state = states.get(store);
  if (state) { registry.unregister(store); close(state); }
}
module.exports = { createDiskBuilder, isDiskStore: (store) => states.has(store), validateDiskStore,
  requireDiskStore,
  validateDiskStoreForCommit, scanDiskShard, readDiskPreview, disposeDiskStore, TEXT_BYTES, PAGE_ROWS,
  async withQueryStoreBuildScope(operation) {
    const owned = new Set();
    let result;
    try { result = await buildScope.run(owned, operation); return result; }
    finally { for (const store of owned) if (store !== result?.projectQueryStore) disposeDiskStore(store); }
  },
};
