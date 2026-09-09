'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CACHE_DISCONTINUITY_INFERENCE_NOTICE,
  cacheObservationDetailSections,
  cachePresentationFactsForEvent,
  formatBasisPoints,
  formatSignedDelta,
  mergePresentationFacts,
} = require('../src/cache-observation-presentation');
const { createEmptyMaterializedPresentationIndexes } = require('../src/canonical-contract');

function cacheObservation(state = 'cache_discontinuity', fields = {}) {
  const field = (name, fallback) => Object.hasOwn(fields, name) ? fields[name] : fallback;
  return {
    schemaVersion: 1,
    inputTokens: field('inputTokens', 12_288),
    cachedInputTokens: field('cachedInputTokens', 0),
    uncachedInputTokens: field('uncachedInputTokens', 12_288),
    outputTokens: field('outputTokens', 589),
    totalTokens: field('totalTokens', null),
    reuseBasisPoints: field('reuseBasisPoints', 0),
    comparison: {
      state,
      reasonCodes: fields.reasonCodes || [],
      previousEventId: fields.previousEventId === undefined ? 'protocol-previous' : fields.previousEventId,
      elapsedMs: fields.elapsedMs === undefined ? 14_000 : fields.elapsedMs,
      previousInputTokens: fields.previousInputTokens === undefined ? 16_384 : fields.previousInputTokens,
      inputDeltaTokens: fields.inputDeltaTokens === undefined ? -4_096 : fields.inputDeltaTokens,
      inputDeltaBasisPoints: fields.inputDeltaBasisPoints === undefined ? -2_500 : fields.inputDeltaBasisPoints,
      previousCachedInputTokens: fields.previousCachedInputTokens === undefined ? 16_384 : fields.previousCachedInputTokens,
      cachedInputDeltaTokens: fields.cachedInputDeltaTokens === undefined ? -16_384 : fields.cachedInputDeltaTokens,
      previousReuseBasisPoints: fields.previousReuseBasisPoints === undefined ? 10_000 : fields.previousReuseBasisPoints,
    },
  };
}

test('Session presentation facts stay bounded, source-neutral, and bidirectional', () => {
  const indexes = createEmptyMaterializedPresentationIndexes();
  indexes.cacheDiscontinuityLinks.protocolEventIdsByMainEventId.set('main-anchor', [
    'protocol-current',
    'protocol-later',
  ]);
  indexes.cacheDiscontinuityLinks.mainEventIdByProtocolEventId.set('protocol-current', 'main-anchor');
  indexes.cacheDiscontinuityLinks.mainEventIdByProtocolEventId.set('protocol-later', 'main-anchor');
  const session = { presentationIndexes: indexes };
  const observation = cacheObservation();

  assert.deepEqual(cachePresentationFactsForEvent(session, {
    id: 'main-anchor',
    layer: 'main',
  }), {
    cacheDiscontinuityLink: {
      protocolEventId: 'protocol-current',
      count: 2,
    },
  });
  assert.deepEqual(cachePresentationFactsForEvent(session, {
    id: 'protocol-current',
    layer: 'protocol',
    subtype: 'token_count',
    cacheObservation: observation,
  }), {
    cacheUsage: {
      inputTokens: 12_288,
      cachedInputTokens: 0,
      reuseBasisPoints: 0,
      outputTokens: 589,
      discontinuity: {
        elapsedMs: 14_000,
        previousCachedInputTokens: 16_384,
      },
      mainContextEventId: 'main-anchor',
    },
  });
  const serialized = JSON.stringify(cachePresentationFactsForEvent(session, {
    id: 'protocol-current',
    layer: 'protocol',
    subtype: 'token_count',
    cacheObservation: observation,
  }));
  assert.equal(serialized.includes('reasonCodes'), false);
  assert.equal(serialized.includes('previousInputTokens'), false);
  assert.equal(serialized.includes('cacheObservation'), false);
  assert.equal(cachePresentationFactsForEvent(session, { id: 'raw', layer: 'raw' }), null);
});

test('ordinary cache usage remains quiet and merges with adapter presentation facts', () => {
  const session = { presentationIndexes: createEmptyMaterializedPresentationIndexes() };
  const facts = cachePresentationFactsForEvent(session, {
    id: 'ordinary',
    layer: 'protocol',
    subtype: 'token_count',
    cacheObservation: cacheObservation('comparable'),
  });
  assert.equal(facts.cacheUsage.discontinuity, null);
  assert.equal(facts.cacheUsage.mainContextEventId, null);
  assert.deepEqual(mergePresentationFacts(
    { cacheDiscontinuityLink: { protocolEventId: 'protocol', count: 1 } },
    { codeModeDeclaredRequests: { toolNames: ['shell_command'], requestEvidence: 'declared_source' } },
  ), {
    codeModeDeclaredRequests: { toolNames: ['shell_command'], requestEvidence: 'declared_source' },
    cacheDiscontinuityLink: { protocolEventId: 'protocol', count: 1 },
  });
  assert.throws(
    () => mergePresentationFacts({ cacheUsage: {} }, { cacheUsage: {} }),
    /Duplicate presentation fact cacheUsage/,
  );
});

test('detail sections render canonical usage without Raw accounting reclassification', () => {
  const noPrevious = cacheObservation('no_previous_observation', {
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: null,
    reuseBasisPoints: null,
    previousEventId: null,
    elapsedMs: null,
    previousInputTokens: null,
    inputDeltaTokens: null,
    inputDeltaBasisPoints: null,
    previousCachedInputTokens: null,
    cachedInputDeltaTokens: null,
    previousReuseBasisPoints: null,
  });
  const detail = cacheObservationDetailSections(noPrevious, { locale: 'en' });
  assert.deepEqual(detail.timelineSections.map((section) => section.type), ['token_usage']);
  assert.deepEqual(detail.timelineSections[0].items.map((item) => [item.label, item.formatted]), [
    ['Input', '0'],
    ['Cached input', '0'],
  ]);
  assert.deepEqual(detail.inspectorSections, []);
});

test('all comparable pairs expose complete Comparison Context and only discontinuities get notice', () => {
  for (const state of [
    'unknown_or_non_monotonic_timestamp',
    'model_change',
    'compaction_boundary',
    'comparable',
    'cache_discontinuity',
  ]) {
    const detail = cacheObservationDetailSections(cacheObservation(state), { locale: 'en' });
    const comparison = detail.inspectorSections.find((section) => section.title === 'Comparison Context');
    assert.ok(comparison, state);
    assert.deepEqual(comparison.entries.map((entry) => entry.key), [
      'Elapsed',
      'Input tokens',
      'Input-token delta',
      'Cached input',
      'Cache-read delta',
      'Cache reuse',
      'Comparison state',
    ]);
    const notice = detail.inspectorSections.find((section) => section.type === 'notice');
    assert.equal(Boolean(notice), state === 'cache_discontinuity', state);
    if (notice) assert.equal(notice.text, CACHE_DISCONTINUITY_INFERENCE_NOTICE);
  }

  const withoutElapsed = cacheObservationDetailSections(cacheObservation(
    'unknown_or_non_monotonic_timestamp',
    { elapsedMs: null },
  ));
  assert.equal(withoutElapsed.inspectorSections[0].entries.some((entry) => entry.key === 'Elapsed'), false);
});

test('detail number formatting preserves exact basis-point semantics and signed truncation results', () => {
  assert.equal(formatBasisPoints(9_430), '94.3%');
  assert.equal(formatBasisPoints(9_433), '94.33%');
  assert.equal(formatBasisPoints(null), '—');
  assert.equal(formatSignedDelta(1_000, 625, 'en'), '+1,000 (+6.25%)');
  assert.equal(formatSignedDelta(-1_000, -625, 'en'), '−1,000 (−6.25%)');
});
