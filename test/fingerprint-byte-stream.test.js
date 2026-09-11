'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const vm = require('node:vm');

const LARGE_CHUNK_BYTES = 256 * 1024;
const PROFILE_ROLE = 'private_capture/materialized_session';

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing function start marker: ${startMarker}`);
  assert.ok(end > start, `missing function end marker: ${endMarker}`);
  return source.slice(start, end);
}

function makeRecordingHashFactory() {
  const records = [];
  const recordingCreateHash = (algorithm, options) => {
    const delegate = createHash(algorithm, options);
    const record = {
      algorithm,
      updates: [],
      digest: undefined,
    };
    records.push(record);
    const recordingHash = {
      update(data, inputEncoding) {
        const bytes = typeof data === 'string'
          ? Buffer.from(data, inputEncoding)
          : Buffer.from(data);
        record.updates.push(Buffer.from(bytes));
        if (inputEncoding === undefined) delegate.update(data);
        else delegate.update(data, inputEncoding);
        return recordingHash;
      },
      digest(outputEncoding) {
        record.digest = delegate.digest(outputEncoding);
        return record.digest;
      },
    };
    return recordingHash;
  };
  return { records, recordingCreateHash };
}

function loadFingerprintFunctions(records) {
  const filename = require.resolve('../src/source-adapters');
  const source = fs.readFileSync(filename, 'utf8');
  const syncFunction = extractFunction(
    source,
    'function graphFingerprint(',
    '\nfunction captureGraphFingerprint',
  );
  const asyncFunction = extractFunction(
    source,
    'async function graphFingerprintAsync(',
    '\nasync function captureGraphFingerprintAsync',
  );
  const context = {
    Buffer,
    createHash: records.recordingCreateHash,
    performance,
    setImmediate,
  };
  for (const name of [
    'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error',
    'Function', 'Map', 'Number', 'Object', 'Promise', 'Reflect', 'RegExp',
    'Set', 'String', 'Symbol', 'Uint8Array', 'WeakMap', 'WeakSet',
  ]) {
    context[name] = globalThis[name];
  }
  vm.runInNewContext([
    syncFunction,
    asyncFunction,
    // The production helper has no effect for a missing signal. The fixture
    // deliberately exercises that path while preserving the async yield.
    'function throwIfAborted(signal) { if (signal?.aborted) throw new Error(\'aborted\'); }',
    'globalThis.graphFingerprint = graphFingerprint;',
    'globalThis.graphFingerprintAsync = graphFingerprintAsync;',
  ].join('\n'), context, { filename });
  return context;
}

function makeFixture() {
  const text = 'unicode-😀\u0000-lone-\uD800-\uDC00-終';
  const localSymbol = Symbol(`local-${text}`);
  const globalSymbol = Symbol.for(`global-${text}`);
  const customFunction = function FingerprintFixtureFunction(value) {
    return value;
  };
  const getter = function fingerprintGetter() {
    return 'getter must not run';
  };
  const setter = function fingerprintSetter(value) {
    void value;
  };
  const prototypeObject = {
    constructor: customFunction,
    marker: text,
  };
  const root = Object.create(prototypeObject);
  const shared = {
    text,
    nullByte: `NUL\u0000${text}`,
  };
  const nullPrototype = Object.create(null);
  const date = new Date(Date.UTC(2024, 1, 29, 12, 34, 56, 789));
  const regexp = new RegExp(`pattern-${text}`, 'gu');
  regexp.lastIndex = 17;
  const map = new Map();
  const set = new Set();
  const buffer = new ArrayBuffer(2 * LARGE_CHUNK_BYTES + 29);
  const bufferBytes = new Uint8Array(buffer);
  for (let index = 0; index < bufferBytes.length; index += 1) {
    bufferBytes[index] = (index * 31 + 17) & 0xff;
  }
  const largeView = new DataView(buffer, 13, LARGE_CHUNK_BYTES + 37);
  const smallView = new Uint8Array(buffer, 3, 7);

  shared.self = shared;
  shared.root = root;
  nullPrototype.hidden = localSymbol;
  date.note = text;
  regexp.note = text;
  customFunction.extra = shared;
  getter.extra = customFunction;
  setter.extra = shared;

  map.set(text, shared);
  map.set(localSymbol, root);
  map.set(shared, date);
  map[globalSymbol] = text;
  set.add(shared);
  set.add(localSymbol);
  set.add(root);
  set.add(regexp);
  set[localSymbol] = shared;

  root.name = text;
  root.shared = shared;
  root.sharedAgain = shared;
  root.self = root;
  root.nullPrototype = nullPrototype;
  root.date = date;
  root.regexp = regexp;
  root.map = map;
  root.set = set;
  root.buffer = buffer;
  root.largeView = largeView;
  root.smallView = smallView;
  root.customFunction = customFunction;
  root.prototypeObject = prototypeObject;
  root.undefinedValue = undefined;
  root.nanValue = Number.NaN;
  root.negativeZero = -0;
  root.bigintValue = 12345678901234567890n;
  root.booleanValue = true;
  root[localSymbol] = globalSymbol;
  root[globalSymbol] = localSymbol;
  Object.defineProperty(root, 'hidden', {
    configurable: false,
    enumerable: false,
    value: shared,
    writable: false,
  });
  Object.defineProperty(root, 'accessor', {
    configurable: true,
    enumerable: true,
    get: getter,
    set: setter,
  });

  const identityObjects = [
    root, shared, nullPrototype, prototypeObject, customFunction, getter, setter,
    date, regexp, map, set, buffer, largeView, smallView,
    customFunction.prototype, getter.prototype, setter.prototype,
    Object.getPrototypeOf(root), Object.getPrototypeOf(shared),
    Object.getPrototypeOf(customFunction), Object.getPrototypeOf(getter),
    Object.getPrototypeOf(setter), Object.getPrototypeOf(date),
    Object.getPrototypeOf(regexp), Object.getPrototypeOf(map),
    Object.getPrototypeOf(set), Object.getPrototypeOf(buffer),
    Object.getPrototypeOf(largeView), Object.getPrototypeOf(smallView),
  ];
  const uniqueObjects = [...new Set(identityObjects)];
  const identitySymbols = [localSymbol, globalSymbol];

  return {
    root,
    buffer,
    largeView,
    smallView,
    identityObjects: uniqueObjects,
    identitySymbols,
  };
}

function freshIdentityState() {
  return {
    objectIds: new WeakMap(),
    symbolIds: new Map(),
    nextObjectId: 0,
    nextSymbolId: 0,
  };
}

function identitySnapshot(state, fixture) {
  return {
    nextObjectId: state.nextObjectId,
    nextSymbolId: state.nextSymbolId,
    objectIds: fixture.identityObjects.map((value) => state.objectIds.get(value)),
    symbolIds: fixture.identitySymbols.map((value) => state.symbolIds.get(value)),
  };
}

function concatenatedUpdates(record) {
  return Buffer.concat(record.updates);
}

test('async graph fingerprints preserve the exact sync hash byte stream and identity ids', async () => {
  const records = makeRecordingHashFactory();
  const functions = loadFingerprintFunctions(records);
  const fixture = makeFixture();

  const syncState = freshIdentityState();
  const syncDigest = functions.graphFingerprint(fixture.root, syncState);
  const syncRecord = records.records.at(-1);
  const syncBytes = concatenatedUpdates(syncRecord);

  const asyncDisabledState = freshIdentityState();
  const asyncDisabledDigest = await functions.graphFingerprintAsync(
    fixture.root,
    asyncDisabledState,
    {},
  );
  const asyncDisabledRecord = records.records.at(-1);
  const asyncDisabledBytes = concatenatedUpdates(asyncDisabledRecord);

  const profiles = [];
  const asyncEnabledState = freshIdentityState();
  const asyncEnabledDigest = await functions.graphFingerprintAsync(
    fixture.root,
    asyncEnabledState,
    {
      onFingerprintProfile: (summary) => profiles.push(summary),
      profileRole: PROFILE_ROLE,
    },
  );
  const asyncEnabledRecord = records.records.at(-1);
  const asyncEnabledBytes = concatenatedUpdates(asyncEnabledRecord);

  assert.equal(records.records.length, 3);
  for (const record of records.records) {
    assert.equal(record.algorithm, 'sha256');
    assert.equal(record.digest.length, 64);
    assert.equal(record.digest, createHash('sha256').update(concatenatedUpdates(record)).digest('hex'));
  }
  assert.equal(syncDigest, asyncDisabledDigest);
  assert.equal(syncDigest, asyncEnabledDigest);
  assert.ok(syncBytes.equals(asyncDisabledBytes));
  assert.ok(syncBytes.equals(asyncEnabledBytes));
  assert.equal(asyncDisabledDigest, asyncEnabledDigest);
  assert.ok(asyncDisabledBytes.equals(asyncEnabledBytes));
  assert.equal(syncDigest, createHash('sha256').update(syncBytes).digest('hex'));
  assert.deepEqual(
    identitySnapshot(syncState, fixture),
    identitySnapshot(asyncDisabledState, fixture),
  );
  assert.deepEqual(
    identitySnapshot(syncState, fixture),
    identitySnapshot(asyncEnabledState, fixture),
  );
  assert.deepEqual(
    identitySnapshot(asyncDisabledState, fixture),
    identitySnapshot(asyncEnabledState, fixture),
  );
  assert.ok(identitySnapshot(syncState, fixture).objectIds.every(Number.isSafeInteger));
  assert.ok(identitySnapshot(syncState, fixture).symbolIds.every(Number.isSafeInteger));

  assert.equal(profiles.length, 1);
  const [profile] = profiles;
  assert.equal(profile.role, PROFILE_ROLE);
  assert.equal(profile.hashInputBytes, asyncEnabledBytes.length);
  assert.equal(profile.hashUpdateCallCount, asyncEnabledRecord.updates.length);
  assert.equal(
    profile.binaryHashBytes,
    fixture.buffer.byteLength + fixture.largeView.byteLength + fixture.smallView.byteLength,
  );
  assert.equal(profile.hashInputBytes, profile.textPrefixBytes + profile.textValueUtf8Bytes + profile.binaryHashBytes);
  assert.equal(profile.hashUpdateCallCount, 2 * profile.writeTokenCount + profile.byteTaskCount);
  assert.ok(asyncEnabledRecord.updates.length > 0);
  assert.ok(asyncEnabledRecord.updates.some((chunk) => chunk.length === LARGE_CHUNK_BYTES));
});
