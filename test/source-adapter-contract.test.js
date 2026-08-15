'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSourceAdapterRegistry,
  defineSourceAdapter,
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
    defaultHome() { return 'fixture'; },
    query: queryContract(),
    discoverConfiguredProjects() {},
    discoverProjects() {},
    buildIndex() {},
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
