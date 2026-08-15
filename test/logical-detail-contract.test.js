'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DETAIL_METADATA_FACTS,
  DETAIL_PURPOSES,
  DETAIL_RESPONSIBILITIES,
  DETAIL_RENDERER_TYPES,
  sanitizeStructuredLogicalDetailDto,
  validateLogicalDetailEnvelope,
  validateLogicalDetailSection,
  validateStructuredLogicalDetailDto,
} = require('../src/shared/logical-detail-contract');
const { CANONICAL_SCHEMA_VERSION } = require('../src/shared/canonical-schema');

function logicalEvent() {
  return {
    id: 'event-1',
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    sourceKind: 'fixture-source',
    kind: 'other_tool_call',
    subtype: 'fixture',
    layer: 'main',
    sourceLocator: { storage: 'fixture', cursor: 'event-1' },
    rawRefs: [{ rawId: 'raw-1', sourceKind: 'fixture-source' }],
  };
}

function detailDto(overrides = {}) {
  const event = logicalEvent();
  return {
    id: event.id,
    schemaVersion: event.schemaVersion,
    sourceKind: event.sourceKind,
    kind: event.kind,
    subtype: event.subtype,
    layer: event.layer,
    title: 'Fixture event',
    sourceLocator: event.sourceLocator,
    meta: { status: 'completed' },
    rawRefs: event.rawRefs,
    timelineSections: [{
      purpose: 'request',
      type: 'code',
      title: 'Command',
      code: 'echo ok',
      language: 'shell',
      role: 'command',
    }],
    inspectorSections: [{
      purpose: 'result',
      type: 'notice',
      title: 'Result',
      text: 'ok',
      level: 'info',
    }],
    ...overrides,
  };
}

test('logical detail contract exposes a closed source-neutral vocabulary', () => {
  assert.deepEqual(DETAIL_PURPOSES, [
    'content',
    'request',
    'result',
    'context',
    'traceability',
    'fallback',
  ]);
  assert.equal(DETAIL_RENDERER_TYPES.includes('code_mode_tool_projection'), true);
  assert.deepEqual(DETAIL_RESPONSIBILITIES, {
    PRIMARY: 'primary',
    SUPPLEMENTAL: 'supplemental',
  });
  assert.deepEqual(DETAIL_METADATA_FACTS, [
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
  assert.equal(Object.isFrozen(DETAIL_PURPOSES), true);
  assert.equal(Object.isFrozen(DETAIL_RENDERER_TYPES), true);
  assert.equal(Object.isFrozen(DETAIL_RESPONSIBILITIES), true);
  assert.equal(Object.isFrozen(DETAIL_METADATA_FACTS), true);
});

test('responsibility containers reject primary traceability/fallback and non-fallback inline JSON', () => {
  const validFallback = detailDto({
    inspectorSections: [{
      purpose: 'fallback',
      type: 'raw_json',
      title: 'Unmodeled fields',
      value: { future: true },
      expanded: false,
    }],
  });
  assert.equal(validateStructuredLogicalDetailDto(validFallback), validFallback);

  const invalidDetails = [
    {
      detail: detailDto({
        timelineSections: [{ purpose: 'traceability', type: 'notice', text: 'projection evidence' }],
      }),
      pattern: /traceability must be Supplemental Detail/,
    },
    {
      detail: detailDto({
        timelineSections: [{ purpose: 'fallback', type: 'notice', text: 'unknown' }],
      }),
      pattern: /fallback must be Supplemental Detail/,
    },
    {
      detail: detailDto({
        timelineSections: [{ purpose: 'request', type: 'raw_json', value: { command: 'pwd' } }],
      }),
      pattern: /raw_json must be Supplemental Detail/,
    },
    {
      detail: detailDto({
        inspectorSections: [{ purpose: 'result', type: 'raw_json', value: { exitCode: 0 } }],
      }),
      pattern: /raw_json purpose must be fallback/,
    },
    {
      detail: detailDto({
        inspectorSections: [{ purpose: 'fallback', type: 'raw_json', value: {}, expanded: true }],
      }),
      pattern: /raw_json must be collapsed by default/,
    },
  ];

  for (const { detail, pattern } of invalidDetails) {
    assert.throws(
      () => validateStructuredLogicalDetailDto(detail),
      (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
        && pattern.test(error.message),
    );
  }
});

test('logical detail validates purpose independently from renderer type and title', () => {
  const requestPatch = {
    purpose: 'request',
    type: 'diff',
    title: 'Observed output',
    text: '-old\n+new',
  };
  const resultPatch = { ...requestPatch, purpose: 'result', title: 'Requested input' };

  assert.equal(validateLogicalDetailSection(requestPatch), requestPatch);
  assert.equal(validateLogicalDetailSection(resultPatch), resultPatch);
});

test('KV metadata facts use a closed semantic vocabulary', () => {
  const section = {
    purpose: 'context',
    type: 'kv',
    entries: [{ key: 'durationMs', value: '250', fact: 'duration' }],
  };
  assert.equal(validateLogicalDetailSection(section), section);
  assert.throws(
    () => validateLogicalDetailSection({
      ...section,
      entries: [{ key: 'durationMs', value: '250', fact: 'timeout' }],
    }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /unknown metadata fact timeout/.test(error.message),
  );
});

test('logical detail rejects missing or unknown purposes, renderers, and malformed shapes', () => {
  assert.throws(
    () => validateLogicalDetailSection({ type: 'notice', text: 'missing' }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /unknown purpose/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({ purpose: 'request', type: 'future_renderer', value: {} }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /unknown renderer type/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({ purpose: 'result', type: 'terminal', text: 42 }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /section\.text: must be a string/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({ purpose: 'fallback', type: 'notice', text: 'x', payload: {} }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /unknown field payload/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({
      purpose: 'request',
      type: 'web_request',
      groups: [{ kind: 'search_query', title: 'Search', items: [{ primary: 'query', entries: [], raw: {} }] }],
      options: [],
    }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /unknown field raw/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({
      purpose: 'context',
      type: 'token_usage',
      items: [{ key: 'total', field: 'total_tokens', label: 'Total', value: '42', formatted: '42', primary: true }],
    }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /items\[0\]\.value: must be a finite number/.test(error.message),
  );
});

test('atomic Code Mode composites require purposes on renderer-local child sections', () => {
  const composite = {
    purpose: 'content',
    type: 'code_mode_tool_projection',
    title: 'Shell command',
    toolName: 'shell_command',
    requestEvidence: 'declared_source',
    resultAssociation: 'bounded',
    requestSections: [{ purpose: 'request', type: 'code', code: 'pwd' }],
    resultSections: [{ purpose: 'result', type: 'terminal', text: 'G:\\repo' }],
    resultObserved: true,
    sourceOrder: 0,
  };

  assert.equal(validateLogicalDetailSection(composite), composite);
  assert.throws(
    () => validateLogicalDetailSection({ ...composite, purpose: 'result' }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /composite purpose must be content/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({
      ...composite,
      requestSections: [{ purpose: 'fallback', type: 'code', code: 'pwd' }],
    }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /request child purpose must be request/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailSection({
      ...composite,
      resultSections: [{ purpose: 'content', type: 'terminal', text: 'G:\\repo' }],
    }),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /result child purpose must be result/.test(error.message),
  );
  composite.resultSections[0] = { type: 'terminal', text: 'G:\\repo' };
  assert.throws(
    () => validateLogicalDetailSection(composite),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /unknown purpose/.test(error.message),
  );
});

test('logical detail rejects accessors, cycles, and over-budget containers before sanitization', () => {
  const accessor = { purpose: 'fallback', type: 'raw_json', value: {} };
  Object.defineProperty(accessor.value, 'secret', { enumerable: true, get() { return 'x'; } });
  assert.throws(
    () => validateLogicalDetailSection(accessor),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /must be a data property/.test(error.message),
  );

  const cyclic = { purpose: 'fallback', type: 'raw_json', value: {} };
  cyclic.value.self = cyclic.value;
  assert.throws(
    () => validateLogicalDetailSection(cyclic),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /contains a cycle/.test(error.message),
  );

  assert.throws(
    () => validateLogicalDetailSection(
      { purpose: 'fallback', type: 'raw_json', value: [1, 2] },
      { maxArrayItems: 1 },
    ),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /exceeds maximum array length/.test(error.message),
  );

  const hidden = detailDto();
  Object.defineProperty(hidden.meta, 'hidden', { value: 'must not disappear' });
  assert.throws(
    () => sanitizeStructuredLogicalDetailDto(hidden),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /must be enumerable/.test(error.message),
  );

  const decoratedArray = detailDto();
  decoratedArray.timelineSections.extra = 'must not disappear';
  assert.throws(
    () => sanitizeStructuredLogicalDetailDto(decoratedArray),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /not a canonical array index/.test(error.message),
  );
});

test('logical detail envelope equality is exact for identity, locator, and ordered Raw References', () => {
  const event = logicalEvent();
  const detail = detailDto();
  assert.equal(validateLogicalDetailEnvelope(detail, event), detail);

  assert.throws(
    () => validateLogicalDetailEnvelope({ ...detail, rawRefs: [...detail.rawRefs].reverse().concat({ rawId: 'raw-2' }) }, event),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /detail.rawRefs/.test(error.message),
  );
  assert.throws(
    () => validateLogicalDetailEnvelope({ ...detail, sourceLocator: { ...detail.sourceLocator, cursor: 'other' } }, event),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /detail.sourceLocator/.test(error.message),
  );

  const hiddenLocator = { ...detail.sourceLocator };
  Object.defineProperty(hiddenLocator, 'hidden', { value: 'drift' });
  assert.throws(
    () => validateLogicalDetailEnvelope({ ...detail, sourceLocator: hiddenLocator }, event),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /detail.sourceLocator/.test(error.message),
  );

  const hiddenRawRefs = detail.rawRefs.map((reference) => ({ ...reference }));
  Object.defineProperty(hiddenRawRefs[0], 'hidden', { value: 'drift' });
  assert.throws(
    () => validateLogicalDetailEnvelope({ ...detail, rawRefs: hiddenRawRefs }, event),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /detail.rawRefs/.test(error.message),
  );

  let getterCalls = 0;
  const accessorLocator = { storage: 'fixture' };
  Object.defineProperty(accessorLocator, 'cursor', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'event-1';
    },
  });
  assert.throws(
    () => validateLogicalDetailEnvelope({ ...detail, sourceLocator: accessorLocator }, event),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /only data properties/.test(error.message),
  );
  assert.equal(getterCalls, 0);

  const nextVersionEvent = { ...event, schemaVersion: CANONICAL_SCHEMA_VERSION + 1 };
  const nextVersionDetail = { ...detail, schemaVersion: nextVersionEvent.schemaVersion };
  assert.equal(validateLogicalDetailEnvelope(nextVersionDetail, nextVersionEvent), nextVersionDetail);
  assert.throws(
    () => validateLogicalDetailEnvelope(detail, nextVersionEvent),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /detail\.schemaVersion/.test(error.message),
  );
});

test('type-aware sanitizer preserves semantic and evidence shapes', () => {
  const detail = detailDto({
    title: 'data:text/plain;base64,AAAA',
    inspectorSections: [{
      purpose: 'fallback',
      type: 'raw_json',
      title: 'Fallback',
      value: { payload: 'data:image/png;base64,AAAA' },
    }],
  });
  const sanitized = sanitizeStructuredLogicalDetailDto(detail, { maxStringChars: 100 });

  assert.equal(sanitized.id, detail.id);
  assert.equal(sanitized.sourceLocator, detail.sourceLocator);
  assert.equal(sanitized.rawRefs, detail.rawRefs);
  assert.equal(sanitized.timelineSections[0].purpose, 'request');
  assert.equal(sanitized.timelineSections[0].type, 'code');
  assert.match(sanitized.title, /embedded data URL omitted/);
  assert.match(sanitized.inspectorSections[0].value.payload, /embedded data URL omitted/);
  assert.equal(validateStructuredLogicalDetailDto(sanitized), sanitized);
});
