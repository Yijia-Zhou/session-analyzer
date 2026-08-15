'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSourceAdapterRegistry,
  defineSourceAdapter,
  SESSION_LIFECYCLE,
  unsupportedImagePreview,
  unsupportedLegacyRawRead,
  unsupportedLegacyRawResolver,
} = require('../src/source-adapter-contract');

function queryContract() {
  return {
    fileSuggestions() {},
    filterSessions() {},
    filtersFromSearchParams() {},
    getEvent() {},
    getTimeline() {},
    indexPresentation() {},
    matchTerms() {},
  };
}

function descriptor(overrides = {}) {
  return {
    kind: 'fixture-source',
    label: 'Fixture Source',
    homeOption: 'fixtureHome',
    homeLabel: 'Fixture home',
    sessionLifecycle: SESSION_LIFECYCLE.RESIDENT_COMPLETE,
    defaultHome() { return 'fixture'; },
    query: queryContract(),
    discoverConfiguredProjects() {},
    discoverProjects() {},
    buildIndex() {},
    async materializeSession({ indexedSession }) { return indexedSession; },
    buildEventDetail() {},
    readRawRecord() {},
    ...overrides,
  };
}

test('source adapter descriptor fills only the bounded shared unsupported operations', async () => {
  const adapter = defineSourceAdapter(descriptor());

  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(adapter.readImagePreview, unsupportedImagePreview);
  assert.equal(adapter.resolveLegacyRaw, unsupportedLegacyRawResolver);
  assert.equal(adapter.readLegacyRaw, unsupportedLegacyRawRead);
  assert.deepEqual(await adapter.readImagePreview(), {
    statusCode: 404,
    error: 'Image previews are not available for this transcript source',
  });
  assert.equal(adapter.resolveLegacyRaw(), null);
  assert.equal(await adapter.readLegacyRaw(), null);
});

test('source adapter descriptor accepts explicit paired optional capabilities', () => {
  const resolveLegacyRaw = () => ({ rawId: 'raw-1' });
  const readLegacyRaw = async () => ({ rawId: 'raw-1' });
  const readImagePreview = async () => ({ statusCode: 200 });
  const adapter = defineSourceAdapter(descriptor({ resolveLegacyRaw, readLegacyRaw, readImagePreview }));

  assert.equal(adapter.resolveLegacyRaw, resolveLegacyRaw);
  assert.equal(adapter.readLegacyRaw, readLegacyRaw);
  assert.equal(adapter.readImagePreview, readImagePreview);
});

test('source adapter descriptor discriminates resident and indexed materialization modes', () => {
  const resident = defineSourceAdapter(descriptor());
  assert.equal(resident.sessionLifecycle, SESSION_LIFECYCLE.RESIDENT_COMPLETE);
  assert.deepEqual(resident.materializedPrivateFields, []);

  const strict = defineSourceAdapter(descriptor({
    sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    validateMaterializationDescriptor() {},
    validateLegacyRawOwnerIndex() {},
    validateMaterializedPrivateState() {},
    materializedPrivateFields: ['_fixtureIndex'],
  }));
  assert.equal(strict.sessionLifecycle, SESSION_LIFECYCLE.INDEXED_MATERIALIZED);
  assert.deepEqual(strict.materializedPrivateFields, ['_fixtureIndex']);
  assert.equal(Object.isFrozen(strict.materializedPrivateFields), true);
});

test('source adapter descriptor rejects unknown fields and missing operations', () => {
  assert.throws(
    () => defineSourceAdapter(descriptor({ capabilities: {} })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /Unknown source adapter descriptor field: capabilities/.test(error.message),
  );
  assert.throws(
    () => defineSourceAdapter(descriptor({ buildEventDetail: undefined })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /buildEventDetail must be a function/.test(error.message),
  );
  assert.throws(
    () => defineSourceAdapter(descriptor({ materializeSession: undefined })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /materializeSession must be a function/.test(error.message),
  );
  assert.throws(
    () => defineSourceAdapter(descriptor({ sessionLifecycle: 'future-mode' })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /sessionLifecycle must be/.test(error.message),
  );
  assert.throws(
    () => defineSourceAdapter(descriptor({ query: { ...queryContract(), getTimeline: null } })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /query.getTimeline must be a function/.test(error.message),
  );
  const hidden = descriptor();
  Object.defineProperty(hidden, 'hiddenCapability', { value: () => {} });
  assert.throws(
    () => defineSourceAdapter(hidden),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /must be enumerable/.test(error.message),
  );
  const symbolKeyed = descriptor();
  symbolKeyed[Symbol('capability')] = () => {};
  assert.throws(
    () => defineSourceAdapter(symbolKeyed),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /must not contain symbol properties/.test(error.message),
  );
});

test('indexed materialization mode requires its closed validation hooks', () => {
  assert.throws(
    () => defineSourceAdapter(descriptor({
      sessionLifecycle: SESSION_LIFECYCLE.INDEXED_MATERIALIZED,
    })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /validateMaterializationDescriptor must be a function/.test(error.message),
  );
  assert.throws(
    () => defineSourceAdapter(descriptor({
      materializedPrivateFields: [],
    })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /only valid in indexed-materialized-v1/.test(error.message),
  );
});

test('source adapter descriptor requires canonical identity and paired legacy operations', () => {
  assert.throws(
    () => defineSourceAdapter(descriptor({ kind: ' Fixture_Source ' })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /surrounding whitespace/.test(error.message),
  );
  assert.throws(
    () => defineSourceAdapter(descriptor({ resolveLegacyRaw() { return null; } })),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /provide resolveLegacyRaw and readLegacyRaw together/.test(error.message),
  );
});

test('static source adapter registry rejects duplicate canonical kinds', () => {
  assert.throws(
    () => createSourceAdapterRegistry([descriptor(), descriptor()]),
    (error) => error.code === 'SOURCE_ADAPTER_CONTRACT_VIOLATION'
      && /Duplicate source adapter kind: fixture-source/.test(error.message),
  );
});
