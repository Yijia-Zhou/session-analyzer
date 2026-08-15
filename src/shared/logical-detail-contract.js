'use strict';

const {
  DATA_URL_MARKER,
  LARGE_VALUE_MARKER,
  redactEmbeddedDataUrls,
} = require('./logical-detail-sanitizer');
const {
  DETAIL_PURPOSE_ORDER,
  DETAIL_PURPOSES,
} = require('./detail-purpose');
const { CANONICAL_SCHEMA_VERSION } = require('./canonical-schema');
const {
  CODE_MODE_DETAIL_RENDERER_TYPES,
  CODE_MODE_DETAIL_SECTION_KEYS,
  validateCodeModeDetailSection,
} = require('./code-mode-detail-contract');

const DETAIL_RESPONSIBILITIES = Object.freeze({
  PRIMARY: 'primary',
  SUPPLEMENTAL: 'supplemental',
});

const DETAIL_METADATA_FACTS = Object.freeze([
  'time',
  'tool',
  'provider',
  'model',
  'effort',
  'attributionSkill',
  'exitCode',
  'duration',
  'recordType',
  'channel',
  'touchedFile',
]);

const DETAIL_RENDERER_TYPES = Object.freeze([
  'markdown',
  'code',
  'terminal',
  'json',
  'diff',
  'patch',
  'kv',
  'token_usage',
  'usage_limits',
  'user_input',
  'plan_update',
  'web_request',
  'collaboration',
  'image_preview',
  'notice',
  'raw_json',
  'event_refs',
  ...CODE_MODE_DETAIL_RENDERER_TYPES,
]);

const PURPOSE_SET = new Set(DETAIL_PURPOSES);
const RENDERER_TYPE_SET = new Set(DETAIL_RENDERER_TYPES);
const METADATA_FACT_SET = new Set(DETAIL_METADATA_FACTS);
const COMMON_SECTION_KEYS = ['purpose', 'type', 'title', 'hideTitle'];
const SECTION_KEYS_BY_TYPE = Object.freeze({
  markdown: ['html', 'role'],
  code: ['code', 'language', 'role'],
  terminal: ['text', 'stream', 'language'],
  json: ['value'],
  diff: ['text'],
  patch: ['files', 'lineNumbers'],
  kv: ['entries'],
  token_usage: ['items'],
  usage_limits: ['items'],
  user_input: ['questions'],
  plan_update: ['explanationHtml', 'steps'],
  web_request: ['groups', 'options'],
  collaboration: ['action', 'targets', 'fields', 'statuses', 'timedOut', 'messageHtml', 'resultHtml'],
  image_preview: ['images', 'notice'],
  notice: ['text', 'level'],
  raw_json: ['value', 'expanded'],
  event_refs: ['items'],
  ...CODE_MODE_DETAIL_SECTION_KEYS,
});

const DETAIL_DTO_KEYS = new Set([
  'id',
  'schemaVersion',
  'sourceKind',
  'kind',
  'subtype',
  'layer',
  'title',
  'sourceLocator',
  'meta',
  'rawRefs',
  'timelineSections',
  'inspectorSections',
  'presentation',
]);

const DEFAULT_STRUCTURE_LIMITS = Object.freeze({
  maxDepth: 40,
  maxNodes: 20_000,
  maxArrayItems: 5_000,
  maxObjectEntries: 2_000,
});

const DEFAULT_SANITIZER_LIMITS = Object.freeze({
  maxStringChars: 100_000,
  maxTotalStringChars: 500_000,
});

function detailContractError(message, path = 'detail') {
  const error = new Error(`${path}: ${message}`);
  error.code = 'LOGICAL_DETAIL_CONTRACT_VIOLATION';
  error.path = path;
  return error;
}

function assertDataContainer(value, path) {
  if (!value || typeof value !== 'object') throw detailContractError('must be an object or array', path);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw detailContractError('must be a plain array', path);
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw detailContractError('must be a plain object', path);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw detailContractError('symbol properties are not supported', path);
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw detailContractError(`property ${key} must be a data property`, path);
    }
    if (!descriptor.enumerable) {
      throw detailContractError(`property ${key} must be enumerable`, path);
    }
    if (Array.isArray(value)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        throw detailContractError(`property ${key} is not a canonical array index`, path);
      }
    }
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw detailContractError(`array index ${index} must be present`, path);
    }
  }
}

function validateBoundedStructure(value, options = {}) {
  const limits = { ...DEFAULT_STRUCTURE_LIMITS, ...options };
  const ancestors = new WeakSet();
  let nodes = 0;

  function visit(item, path, depth) {
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
      throw detailContractError(`unsupported value type ${typeof item}`, path);
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw detailContractError('must be a finite number', path);
    }
    if (!item || typeof item !== 'object') return;
    if (depth > limits.maxDepth) throw detailContractError('exceeds maximum nesting depth', path);
    nodes += 1;
    if (nodes > limits.maxNodes) throw detailContractError('exceeds maximum node count', path);
    assertDataContainer(item, path);
    if (ancestors.has(item)) throw detailContractError('contains a cycle', path);
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (item.length > limits.maxArrayItems) throw detailContractError('exceeds maximum array length', path);
      for (let index = 0; index < item.length; index += 1) visit(item[index], `${path}[${index}]`, depth + 1);
    } else {
      const entries = Object.entries(item);
      if (entries.length > limits.maxObjectEntries) throw detailContractError('exceeds maximum object size', path);
      for (const [key, child] of entries) visit(child, `${path}.${key}`, depth + 1);
    }
    ancestors.delete(item);
  }

  visit(value, options.path || 'detail', 0);
  return value;
}

function assertAllowedKeys(value, allowedKeys, path) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw detailContractError(`unknown field ${key}`, path);
  }
}

function assertString(value, path, { nonEmpty = false, optional = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string') throw detailContractError('must be a string', path);
  if (nonEmpty && !value) throw detailContractError('must be non-empty', path);
}

function assertBoolean(value, path, { optional = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value !== 'boolean') throw detailContractError('must be a boolean', path);
}

function assertFiniteNumber(value, path, { optional = false, nullable = false } = {}) {
  if (optional && value === undefined) return;
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw detailContractError('must be a finite number', path);
}

function assertArray(value, path) {
  if (!Array.isArray(value)) throw detailContractError('must be an array', path);
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw detailContractError('must be a plain object', path);
}

function validateStringArray(values, path) {
  assertArray(values, path);
  values.forEach((value, index) => assertString(value, `${path}[${index}]`));
}

function validateEntries(entries, path) {
  assertArray(entries, path);
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    assertRecord(entry, entryPath);
    assertAllowedKeys(entry, ['key', 'value', 'fact'], entryPath);
    assertString(entry.key, `${entryPath}.key`);
    assertString(entry.value, `${entryPath}.value`);
    assertString(entry.fact, `${entryPath}.fact`, { optional: true });
    if (entry.fact !== undefined && !METADATA_FACT_SET.has(entry.fact)) {
      throw detailContractError(`unknown metadata fact ${entry.fact}`, `${entryPath}.fact`);
    }
  });
}

function assertStringOrFiniteNumber(value, path, { optional = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value === 'string') return;
  assertFiniteNumber(value, path);
}

function validateTokenUsageItems(items, path) {
  assertArray(items, path);
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    assertRecord(item, itemPath);
    assertAllowedKeys(item, ['key', 'field', 'label', 'value', 'formatted', 'primary'], itemPath);
    assertString(item.key, `${itemPath}.key`);
    assertString(item.field, `${itemPath}.field`);
    assertString(item.label, `${itemPath}.label`);
    assertFiniteNumber(item.value, `${itemPath}.value`);
    assertString(item.formatted, `${itemPath}.formatted`);
    assertBoolean(item.primary, `${itemPath}.primary`);
  });
}

function validateUsageLimitItems(items, path) {
  assertArray(items, path);
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    assertRecord(item, itemPath);
    assertAllowedKeys(item, ['key', 'kind', 'label', 'remaining', 'reset', 'resetRaw'], itemPath);
    assertString(item.key, `${itemPath}.key`);
    assertString(item.kind, `${itemPath}.kind`);
    assertString(item.label, `${itemPath}.label`);
    assertString(item.remaining, `${itemPath}.remaining`);
    assertString(item.reset, `${itemPath}.reset`);
    assertStringOrFiniteNumber(item.resetRaw, `${itemPath}.resetRaw`);
  });
}

function validateEventRefItems(items, path) {
  assertArray(items, path);
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    assertRecord(item, itemPath);
    assertAllowedKeys(item, ['id', 'label', 'kind', 'status'], itemPath);
    assertString(item.id, `${itemPath}.id`, { nonEmpty: true });
    assertString(item.label, `${itemPath}.label`);
    assertString(item.kind, `${itemPath}.kind`);
    assertString(item.status, `${itemPath}.status`);
  });
}

function validateUserInputQuestions(questions, path) {
  assertArray(questions, path);
  questions.forEach((question, index) => {
    const questionPath = `${path}[${index}]`;
    assertRecord(question, questionPath);
    assertAllowedKeys(question, ['id', 'title', 'prompt', 'options', 'answers'], questionPath);
    assertString(question.id, `${questionPath}.id`);
    assertString(question.title, `${questionPath}.title`);
    assertString(question.prompt, `${questionPath}.prompt`);
    assertArray(question.options, `${questionPath}.options`);
    question.options.forEach((option, optionIndex) => {
      const optionPath = `${questionPath}.options[${optionIndex}]`;
      assertRecord(option, optionPath);
      assertAllowedKeys(option, ['label', 'description', 'selected'], optionPath);
      assertString(option.label, `${optionPath}.label`);
      assertString(option.description, `${optionPath}.description`);
      assertBoolean(option.selected, `${optionPath}.selected`);
    });
    validateStringArray(question.answers, `${questionPath}.answers`);
  });
}

function validatePlanSteps(steps, path) {
  assertArray(steps, path);
  steps.forEach((step, index) => {
    const stepPath = `${path}[${index}]`;
    assertRecord(step, stepPath);
    assertAllowedKeys(step, ['step', 'status'], stepPath);
    assertString(step.step, `${stepPath}.step`);
    assertString(step.status, `${stepPath}.status`);
  });
}

function validateWebGroups(groups, path) {
  assertArray(groups, path);
  groups.forEach((group, index) => {
    const groupPath = `${path}[${index}]`;
    assertRecord(group, groupPath);
    assertAllowedKeys(group, ['kind', 'title', 'items'], groupPath);
    assertString(group.kind, `${groupPath}.kind`);
    assertString(group.title, `${groupPath}.title`);
    assertArray(group.items, `${groupPath}.items`);
    group.items.forEach((item, itemIndex) => {
      const itemPath = `${groupPath}.items[${itemIndex}]`;
      assertRecord(item, itemPath);
      assertAllowedKeys(item, ['primary', 'entries'], itemPath);
      assertString(item.primary, `${itemPath}.primary`);
      validateEntries(item.entries, `${itemPath}.entries`);
    });
  });
}

function validateCollaborationStatuses(statuses, path) {
  assertArray(statuses, path);
  statuses.forEach((status, index) => {
    const statusPath = `${path}[${index}]`;
    assertRecord(status, statusPath);
    assertAllowedKeys(status, ['label', 'labelKind', 'status'], statusPath);
    assertString(status.label, `${statusPath}.label`);
    assertString(status.labelKind, `${statusPath}.labelKind`, { optional: true });
    assertString(status.status, `${statusPath}.status`);
  });
}

function validateImagePreviewItems(images, path) {
  assertArray(images, path);
  images.forEach((image, index) => {
    const imagePath = `${path}[${index}]`;
    assertRecord(image, imagePath);
    assertAllowedKeys(image, ['previewId', 'src', 'mimeType', 'estimatedBytes', 'detail', 'alt'], imagePath);
    assertString(image.previewId, `${imagePath}.previewId`, { nonEmpty: true });
    assertString(image.src, `${imagePath}.src`, { nonEmpty: true });
    assertString(image.mimeType, `${imagePath}.mimeType`);
    assertFiniteNumber(image.estimatedBytes, `${imagePath}.estimatedBytes`);
    assertString(image.detail, `${imagePath}.detail`);
    assertString(image.alt, `${imagePath}.alt`);
  });
}

function validatePatchFiles(files, path) {
  assertArray(files, path);
  files.forEach((file, fileIndex) => {
    const filePath = `${path}[${fileIndex}]`;
    assertRecord(file, filePath);
    assertAllowedKeys(file, ['path', 'changeType', 'additions', 'deletions', 'lineNumbers', 'hunks'], filePath);
    assertString(file.path, `${filePath}.path`);
    assertString(file.changeType, `${filePath}.changeType`, { optional: true });
    assertFiniteNumber(file.additions, `${filePath}.additions`, { optional: true });
    assertFiniteNumber(file.deletions, `${filePath}.deletions`, { optional: true });
    assertBoolean(file.lineNumbers, `${filePath}.lineNumbers`, { optional: true });
    assertArray(file.hunks, `${filePath}.hunks`);
    file.hunks.forEach((hunk, hunkIndex) => {
      const hunkPath = `${filePath}.hunks[${hunkIndex}]`;
      assertRecord(hunk, hunkPath);
      assertAllowedKeys(hunk, ['header', 'lineNumbers', 'lines'], hunkPath);
      assertString(hunk.header, `${hunkPath}.header`, { optional: true });
      assertBoolean(hunk.lineNumbers, `${hunkPath}.lineNumbers`, { optional: true });
      assertArray(hunk.lines, `${hunkPath}.lines`);
      hunk.lines.forEach((line, lineIndex) => {
        const linePath = `${hunkPath}.lines[${lineIndex}]`;
        assertRecord(line, linePath);
        assertAllowedKeys(line, ['kind', 'content', 'oldLine', 'newLine', 'lineNumberReliable'], linePath);
        assertString(line.kind, `${linePath}.kind`);
        assertString(line.content, `${linePath}.content`);
        assertFiniteNumber(line.oldLine, `${linePath}.oldLine`, { optional: true, nullable: true });
        assertFiniteNumber(line.newLine, `${linePath}.newLine`, { optional: true, nullable: true });
        assertBoolean(line.lineNumberReliable, `${linePath}.lineNumberReliable`, { optional: true });
      });
    });
  });
}

function validateLogicalDetailSectionShape(section, path) {
  assertRecord(section, path);
  if (!PURPOSE_SET.has(section.purpose)) throw detailContractError(`unknown purpose ${String(section.purpose)}`, `${path}.purpose`);
  if (!RENDERER_TYPE_SET.has(section.type)) throw detailContractError(`unknown renderer type ${String(section.type)}`, `${path}.type`);
  assertAllowedKeys(section, [...COMMON_SECTION_KEYS, ...SECTION_KEYS_BY_TYPE[section.type]], path);
  assertString(section.title, `${path}.title`, { optional: true });
  assertBoolean(section.hideTitle, `${path}.hideTitle`, { optional: true });

  if (validateCodeModeDetailSection(section, path, {
    assertAllowedKeys,
    assertArray,
    assertBoolean,
    assertFiniteNumber,
    assertRecord,
    assertString,
    commonSectionKeys: COMMON_SECTION_KEYS,
    detailContractError,
    validateEntries,
    validateSection: validateLogicalDetailSectionShape,
  })) return;

  switch (section.type) {
    case 'markdown':
      assertString(section.html, `${path}.html`);
      assertString(section.role, `${path}.role`, { optional: true });
      break;
    case 'code':
      assertString(section.code, `${path}.code`);
      assertString(section.language, `${path}.language`, { optional: true });
      assertString(section.role, `${path}.role`, { optional: true });
      break;
    case 'terminal':
      assertString(section.text, `${path}.text`);
      assertString(section.stream, `${path}.stream`, { optional: true });
      assertString(section.language, `${path}.language`, { optional: true });
      break;
    case 'json':
      if (!Object.hasOwn(section, 'value')) throw detailContractError('requires value', path);
      break;
    case 'raw_json':
      if (!Object.hasOwn(section, 'value')) throw detailContractError('requires value', path);
      assertBoolean(section.expanded, `${path}.expanded`, { optional: true });
      break;
    case 'diff':
      assertString(section.text, `${path}.text`);
      break;
    case 'patch':
      validatePatchFiles(section.files, `${path}.files`);
      assertBoolean(section.lineNumbers, `${path}.lineNumbers`, { optional: true });
      break;
    case 'kv':
      validateEntries(section.entries, `${path}.entries`);
      break;
    case 'token_usage':
      validateTokenUsageItems(section.items, `${path}.items`);
      break;
    case 'usage_limits':
      validateUsageLimitItems(section.items, `${path}.items`);
      break;
    case 'event_refs':
      validateEventRefItems(section.items, `${path}.items`);
      break;
    case 'user_input':
      validateUserInputQuestions(section.questions, `${path}.questions`);
      break;
    case 'plan_update':
      assertString(section.explanationHtml, `${path}.explanationHtml`, { optional: true });
      validatePlanSteps(section.steps, `${path}.steps`);
      break;
    case 'web_request':
      validateWebGroups(section.groups, `${path}.groups`);
      validateEntries(section.options, `${path}.options`);
      break;
    case 'collaboration':
      assertString(section.action, `${path}.action`, { optional: true });
      validateStringArray(section.targets, `${path}.targets`);
      validateEntries(section.fields, `${path}.fields`);
      validateCollaborationStatuses(section.statuses, `${path}.statuses`);
      assertBoolean(section.timedOut, `${path}.timedOut`, { optional: true });
      assertString(section.messageHtml, `${path}.messageHtml`, { optional: true });
      assertString(section.resultHtml, `${path}.resultHtml`, { optional: true });
      break;
    case 'image_preview':
      validateImagePreviewItems(section.images, `${path}.images`);
      assertString(section.notice, `${path}.notice`, { optional: true });
      break;
    case 'notice':
      assertString(section.text, `${path}.text`);
      assertString(section.level, `${path}.level`, { optional: true });
      break;
    default:
      throw detailContractError('unsupported renderer type', path);
  }
}

function validateLogicalDetailSection(section, options = {}) {
  const path = options.path || 'section';
  validateBoundedStructure(section, { ...options, path });
  validateLogicalDetailSectionShape(section, path);
  return section;
}

function validateResponsibilitySection(section, responsibility, path) {
  validateLogicalDetailSectionShape(section, path);
  if (responsibility === DETAIL_RESPONSIBILITIES.PRIMARY
    && (section.purpose === 'traceability' || section.purpose === 'fallback')) {
    throw detailContractError(
      `${section.purpose} must be Supplemental Detail`,
      `${path}.purpose`,
    );
  }
  if (section.type === 'raw_json') {
    if (responsibility !== DETAIL_RESPONSIBILITIES.SUPPLEMENTAL) {
      throw detailContractError('raw_json must be Supplemental Detail', `${path}.type`);
    }
    if (section.purpose !== 'fallback') {
      throw detailContractError('raw_json purpose must be fallback', `${path}.purpose`);
    }
    if (section.expanded === true) {
      throw detailContractError('raw_json must be collapsed by default', `${path}.expanded`);
    }
  }
}

function validateStructuredLogicalDetailDto(dto, options = {}) {
  const path = options.path || 'detail';
  validateBoundedStructure(dto, { ...options, path });
  assertRecord(dto, path);
  assertAllowedKeys(dto, DETAIL_DTO_KEYS, path);
  assertString(dto.id, `${path}.id`, { nonEmpty: true });
  assertFiniteNumber(dto.schemaVersion, `${path}.schemaVersion`);
  assertString(dto.sourceKind, `${path}.sourceKind`, { nonEmpty: true });
  assertString(dto.kind, `${path}.kind`, { nonEmpty: true });
  assertString(dto.subtype, `${path}.subtype`, { optional: true });
  if (!['main', 'protocol'].includes(dto.layer)) throw detailContractError('must be main or protocol', `${path}.layer`);
  assertString(dto.title, `${path}.title`, { optional: true });
  if (dto.sourceLocator !== null && dto.sourceLocator !== undefined) assertRecord(dto.sourceLocator, `${path}.sourceLocator`);
  assertRecord(dto.meta, `${path}.meta`);
  assertArray(dto.rawRefs, `${path}.rawRefs`);
  assertArray(dto.timelineSections, `${path}.timelineSections`);
  assertArray(dto.inspectorSections, `${path}.inspectorSections`);
  dto.timelineSections.forEach((section, index) => validateResponsibilitySection(
    section,
    DETAIL_RESPONSIBILITIES.PRIMARY,
    `${path}.timelineSections[${index}]`,
  ));
  dto.inspectorSections.forEach((section, index) => validateResponsibilitySection(
    section,
    DETAIL_RESPONSIBILITIES.SUPPLEMENTAL,
    `${path}.inspectorSections[${index}]`,
  ));
  if (dto.presentation !== undefined) assertRecord(dto.presentation, `${path}.presentation`);
  return dto;
}

function validateLogicalDetailEnvelope(dto, event, options = {}) {
  const expected = {
    id: event?.id,
    schemaVersion: options.schemaVersion ?? event?.schemaVersion ?? CANONICAL_SCHEMA_VERSION,
    sourceKind: event?.sourceKind,
    kind: event?.kind,
    subtype: event?.subtype,
    layer: options.layer ?? event?.layer,
    sourceLocator: event?.sourceLocator,
    rawRefs: event?.rawRefs,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const descriptor = dto && typeof dto === 'object'
      ? Object.getOwnPropertyDescriptor(dto, field)
      : null;
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw detailContractError(`must exactly match the selected Logical Event for ${field}`, `detail.${field}`);
    }
    assertExactDataValue(descriptor.value, expectedValue, `detail.${field}`);
  }
  return dto;
}

function assertExactDataValue(actual, expected, path, compared = new WeakMap()) {
  if (Object.is(actual, expected)) return;
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') {
    throw detailContractError('must exactly match the selected Logical Event', path);
  }
  if (Array.isArray(actual) !== Array.isArray(expected)
    || Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) {
    throw detailContractError('must exactly match the selected Logical Event', path);
  }
  const priorExpected = compared.get(actual);
  if (priorExpected !== undefined) {
    if (priorExpected !== expected) throw detailContractError('must exactly match the selected Logical Event', path);
    return;
  }
  compared.set(actual, expected);

  const actualKeys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(expected);
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key) => !expectedKeys.some((expectedKey) => expectedKey === key))) {
    throw detailContractError('must exactly match the selected Logical Event', path);
  }
  for (const key of actualKeys) {
    const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key);
    const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key);
    const keyPath = typeof key === 'symbol' ? `${path}.[${String(key)}]` : `${path}.${key}`;
    if (!actualDescriptor || !expectedDescriptor
      || !Object.hasOwn(actualDescriptor, 'value')
      || !Object.hasOwn(expectedDescriptor, 'value')) {
      throw detailContractError('must contain only data properties', keyPath);
    }
    assertExactDataValue(actualDescriptor.value, expectedDescriptor.value, keyPath, compared);
  }
}

function stringLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function createSanitizerState(options) {
  const limits = { ...DEFAULT_SANITIZER_LIMITS, ...options };
  return {
    maxStringChars: stringLimit(limits.maxStringChars),
    remainingStringChars: stringLimit(limits.maxTotalStringChars),
    marker: options.largeValueMarker || LARGE_VALUE_MARKER,
    dataUrlMarker: options.dataUrlMarker || DATA_URL_MARKER,
  };
}

function sanitizeLeafString(value, state) {
  const redacted = redactEmbeddedDataUrls(value, state.dataUrlMarker);
  const available = Math.min(
    state.maxStringChars ?? Number.POSITIVE_INFINITY,
    state.remainingStringChars ?? Number.POSITIVE_INFINITY,
  );
  if (redacted.length <= available) {
    if (state.remainingStringChars != null) state.remainingStringChars -= redacted.length;
    return redacted;
  }
  const prefix = available > 0 ? redacted.slice(0, available).trimEnd() : '';
  if (state.remainingStringChars != null) state.remainingStringChars = Math.max(0, state.remainingStringChars - available);
  return prefix ? `${prefix}\n${state.marker}` : state.marker;
}

function sanitizeTypedValue(value, state, key = '') {
  if (typeof value === 'string') {
    if (key === 'purpose' || key === 'type') return value;
    return sanitizeLeafString(value, state);
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeTypedValue(item, state));
  const output = {};
  for (const [childKey, child] of Object.entries(value)) {
    Object.defineProperty(output, childKey, {
      value: sanitizeTypedValue(child, state, childKey),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function sanitizeStructuredLogicalDetailDto(dto, options = {}) {
  validateStructuredLogicalDetailDto(dto, options);
  const state = createSanitizerState(options);
  const sanitized = {
    id: dto.id,
    schemaVersion: dto.schemaVersion,
    sourceKind: dto.sourceKind,
    kind: dto.kind,
    subtype: dto.subtype,
    layer: dto.layer,
    title: dto.title === undefined ? undefined : sanitizeLeafString(dto.title, state),
    sourceLocator: dto.sourceLocator,
    meta: sanitizeTypedValue(dto.meta, state),
    rawRefs: dto.rawRefs,
    timelineSections: dto.timelineSections.map((section) => sanitizeTypedValue(section, state)),
    inspectorSections: dto.inspectorSections.map((section) => sanitizeTypedValue(section, state)),
    ...(dto.presentation === undefined ? {} : { presentation: sanitizeTypedValue(dto.presentation, state) }),
  };
  validateStructuredLogicalDetailDto(sanitized, options);
  return sanitized;
}

module.exports = {
  DEFAULT_SANITIZER_LIMITS,
  DEFAULT_STRUCTURE_LIMITS,
  DETAIL_PURPOSE_ORDER,
  DETAIL_PURPOSES,
  DETAIL_METADATA_FACTS,
  DETAIL_RESPONSIBILITIES,
  DETAIL_RENDERER_TYPES,
  sanitizeStructuredLogicalDetailDto,
  validateBoundedStructure,
  validateLogicalDetailEnvelope,
  validateLogicalDetailSection,
  validateStructuredLogicalDetailDto,
};
