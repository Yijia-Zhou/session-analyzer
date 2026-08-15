'use strict';

const SOURCE_ADAPTER_DESCRIPTOR_KEYS = Object.freeze([
  'kind',
  'label',
  'homeOption',
  'homeLabel',
  'defaultHome',
  'query',
  'discoverConfiguredProjects',
  'discoverProjects',
  'buildIndex',
  'buildEventDetail',
  'readRawRecord',
  'readImagePreview',
  'resolveLegacyRaw',
  'readLegacyRaw',
]);

const REQUIRED_QUERY_OPERATIONS = Object.freeze([
  'fileSuggestions',
  'filterSessions',
  'filtersFromSearchParams',
  'getEvent',
  'getTimeline',
  'indexPresentation',
  'matchTerms',
]);

const REQUIRED_ADAPTER_OPERATIONS = Object.freeze([
  'defaultHome',
  'discoverConfiguredProjects',
  'discoverProjects',
  'buildIndex',
  'buildEventDetail',
  'readRawRecord',
]);

const OPTIONAL_ADAPTER_OPERATIONS = Object.freeze([
  'readImagePreview',
  'resolveLegacyRaw',
  'readLegacyRaw',
]);

const ALLOWED_DESCRIPTOR_KEYS = new Set(SOURCE_ADAPTER_DESCRIPTOR_KEYS);

function adapterContractError(message) {
  const error = new Error(message);
  error.code = 'SOURCE_ADAPTER_CONTRACT_VIOLATION';
  return error;
}

function assertPlainDataObject(value, owner) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw adapterContractError(`${owner} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw adapterContractError(`${owner} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      throw adapterContractError(`${owner} must not contain symbol properties`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value')) {
      throw adapterContractError(`${owner}.${key} must be a data property`);
    }
    if (!descriptor.enumerable) {
      throw adapterContractError(`${owner}.${key} must be enumerable`);
    }
  }
}

function requireNonEmptyString(value, owner) {
  if (typeof value !== 'string' || !value.trim()) {
    throw adapterContractError(`${owner} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw adapterContractError(`${owner} must not contain surrounding whitespace`);
  }
  return value;
}

function validateSourceKind(value) {
  const kind = requireNonEmptyString(value, 'adapter.kind');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(kind)) {
    throw adapterContractError('adapter.kind must use canonical lowercase kebab-case');
  }
  return kind;
}

function validateQuery(query, kind) {
  assertPlainDataObject(query, `adapter ${kind}.query`);
  for (const operation of REQUIRED_QUERY_OPERATIONS) {
    if (typeof query[operation] !== 'function') {
      throw adapterContractError(`adapter ${kind}.query.${operation} must be a function`);
    }
  }
}

function unsupportedImagePreview() {
  return Promise.resolve({
    statusCode: 404,
    error: 'Image previews are not available for this transcript source',
  });
}

function unsupportedLegacyRawResolver() {
  return null;
}

function unsupportedLegacyRawRead() {
  return Promise.resolve(null);
}

function defineSourceAdapter(descriptor) {
  assertPlainDataObject(descriptor, 'source adapter descriptor');
  for (const key of Object.keys(descriptor)) {
    if (!ALLOWED_DESCRIPTOR_KEYS.has(key)) {
      throw adapterContractError(`Unknown source adapter descriptor field: ${key}`);
    }
  }

  const kind = validateSourceKind(descriptor.kind);
  const label = requireNonEmptyString(descriptor.label, `adapter ${kind}.label`);
  const homeOption = requireNonEmptyString(descriptor.homeOption, `adapter ${kind}.homeOption`);
  const homeLabel = requireNonEmptyString(descriptor.homeLabel, `adapter ${kind}.homeLabel`);
  if (!/^[a-z][A-Za-z0-9]*$/.test(homeOption)) {
    throw adapterContractError(`adapter ${kind}.homeOption must be a lower camel-case identifier`);
  }
  validateQuery(descriptor.query, kind);
  for (const operation of REQUIRED_ADAPTER_OPERATIONS) {
    if (typeof descriptor[operation] !== 'function') {
      throw adapterContractError(`adapter ${kind}.${operation} must be a function`);
    }
  }
  for (const operation of OPTIONAL_ADAPTER_OPERATIONS) {
    if (descriptor[operation] !== undefined && typeof descriptor[operation] !== 'function') {
      throw adapterContractError(`adapter ${kind}.${operation} must be a function when provided`);
    }
  }
  const hasLegacyResolver = descriptor.resolveLegacyRaw !== undefined;
  const hasLegacyReader = descriptor.readLegacyRaw !== undefined;
  if (hasLegacyResolver !== hasLegacyReader) {
    throw adapterContractError(`adapter ${kind} must provide resolveLegacyRaw and readLegacyRaw together`);
  }

  return Object.freeze({
    kind,
    label,
    homeOption,
    homeLabel,
    defaultHome: descriptor.defaultHome,
    query: descriptor.query,
    discoverConfiguredProjects: descriptor.discoverConfiguredProjects,
    discoverProjects: descriptor.discoverProjects,
    buildIndex: descriptor.buildIndex,
    buildEventDetail: descriptor.buildEventDetail,
    readRawRecord: descriptor.readRawRecord,
    readImagePreview: descriptor.readImagePreview || unsupportedImagePreview,
    resolveLegacyRaw: descriptor.resolveLegacyRaw || unsupportedLegacyRawResolver,
    readLegacyRaw: descriptor.readLegacyRaw || unsupportedLegacyRawRead,
  });
}

function createSourceAdapterRegistry(descriptors) {
  if (!Array.isArray(descriptors) || !descriptors.length) {
    throw adapterContractError('Source adapter registry requires at least one descriptor');
  }
  const registry = new Map();
  for (const candidate of descriptors) {
    const descriptor = defineSourceAdapter(candidate);
    if (registry.has(descriptor.kind)) {
      throw adapterContractError(`Duplicate source adapter kind: ${descriptor.kind}`);
    }
    registry.set(descriptor.kind, descriptor);
  }
  return registry;
}

module.exports = {
  OPTIONAL_ADAPTER_OPERATIONS,
  REQUIRED_ADAPTER_OPERATIONS,
  REQUIRED_QUERY_OPERATIONS,
  SOURCE_ADAPTER_DESCRIPTOR_KEYS,
  createSourceAdapterRegistry,
  defineSourceAdapter,
  unsupportedImagePreview,
  unsupportedLegacyRawRead,
  unsupportedLegacyRawResolver,
};
