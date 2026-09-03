'use strict';

const CACHE_DISCONTINUITY_STATE = 'cache_discontinuity';
const NO_PREVIOUS_OBSERVATION_STATE = 'no_previous_observation';

const COMPARISON_STATE_LABELS = Object.freeze({
  no_previous_observation: 'No previous observation',
  unknown_or_non_monotonic_timestamp: 'Timestamp unavailable or non-monotonic',
  model_change: 'Model changed; comparison not made',
  compaction_boundary: 'Compaction boundary; comparison not made',
  comparable: 'Comparable; no discontinuity inferred',
  cache_discontinuity: 'Cache discontinuity',
});

const CACHE_DISCONTINUITY_INFERENCE_NOTICE = 'This cache discontinuity is inferred from adjacent token accounting; the transcript does not provide explicit cache-expiry evidence.';

function cacheDiscontinuityLinks(session) {
  return session?.presentationIndexes?.cacheDiscontinuityLinks || null;
}

function cachePresentationFactsForEvent(session, event) {
  if (!event || event.layer === 'raw') return null;
  const links = cacheDiscontinuityLinks(session);
  if (event.layer === 'main') {
    const protocolEventIds = links?.protocolEventIdsByMainEventId?.get(event.id);
    if (!Array.isArray(protocolEventIds) || protocolEventIds.length === 0) return null;
    return {
      cacheDiscontinuityLink: {
        protocolEventId: protocolEventIds[0],
        count: protocolEventIds.length,
      },
    };
  }

  const observation = event.cacheObservation;
  if (event.layer !== 'protocol' || event.subtype !== 'token_count' || !observation) return null;
  const discontinuity = observation.comparison.state === CACHE_DISCONTINUITY_STATE
    ? {
      elapsedMs: observation.comparison.elapsedMs,
      previousCachedInputTokens: observation.comparison.previousCachedInputTokens,
    }
    : null;
  return {
    cacheUsage: {
      inputTokens: observation.inputTokens,
      cachedInputTokens: observation.cachedInputTokens,
      reuseBasisPoints: observation.reuseBasisPoints,
      outputTokens: observation.outputTokens,
      discontinuity,
      mainContextEventId: links?.mainEventIdByProtocolEventId?.get(event.id) || null,
    },
  };
}

function mergePresentationFacts(sharedFacts, adapterFacts) {
  if (!sharedFacts) return adapterFacts || null;
  if (!adapterFacts) return sharedFacts;
  for (const key of Object.keys(sharedFacts)) {
    if (Object.hasOwn(adapterFacts, key)) {
      throw new TypeError(`Duplicate presentation fact ${key}`);
    }
  }
  return { ...adapterFacts, ...sharedFacts };
}

function numberFormatter(locale) {
  return new Intl.NumberFormat(locale || 'en', { maximumFractionDigits: 0 });
}

function formatInteger(value, locale) {
  return numberFormatter(locale).format(value);
}

function formatBasisPoints(value) {
  if (!Number.isSafeInteger(value)) return '—';
  const magnitude = Math.abs(value);
  const formatted = magnitude % 100 === 0
    ? String(magnitude / 100)
    : (magnitude / 100).toFixed(magnitude % 10 === 0 ? 1 : 2);
  return `${value < 0 ? '−' : ''}${formatted}%`;
}

function formatSignedInteger(value, locale) {
  if (!Number.isSafeInteger(value)) return '—';
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${formatInteger(Math.abs(value), locale)}`;
}

function formatSignedDelta(tokens, basisPoints, locale) {
  const tokenText = formatSignedInteger(tokens, locale);
  return Number.isSafeInteger(basisPoints)
    ? `${tokenText} (${basisPoints > 0 ? '+' : ''}${formatBasisPoints(basisPoints)})`
    : tokenText;
}

function formatDuration(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '';
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) {
    const seconds = milliseconds / 1_000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  }
  if (milliseconds < 3_600_000) {
    const minutes = milliseconds / 60_000;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
  }
  const hours = milliseconds / 3_600_000;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

function tokenUsageItems(observation, locale) {
  const items = [
    {
      key: 'inputTokens',
      field: 'input_tokens',
      label: 'Input',
      value: observation.inputTokens,
      formatted: formatInteger(observation.inputTokens, locale),
      primary: true,
    },
    {
      key: 'cachedInputTokens',
      field: 'cached_input_tokens',
      label: 'Cached input',
      value: observation.cachedInputTokens,
      formatted: formatInteger(observation.cachedInputTokens, locale),
      primary: false,
    },
  ];
  if (Number.isSafeInteger(observation.reuseBasisPoints)) {
    items.push({
      key: 'reuseBasisPoints',
      field: 'reuse_basis_points',
      label: 'Cache reuse',
      value: observation.reuseBasisPoints,
      formatted: formatBasisPoints(observation.reuseBasisPoints),
      primary: false,
    });
  }
  if (Number.isSafeInteger(observation.outputTokens)) {
    items.push({
      key: 'outputTokens',
      field: 'output_tokens',
      label: 'Output',
      value: observation.outputTokens,
      formatted: formatInteger(observation.outputTokens, locale),
      primary: false,
    });
  }
  return items;
}

function transition(previous, current, formatter) {
  return `${formatter(previous)} → ${formatter(current)}`;
}

function comparisonEntries(observation, locale) {
  const comparison = observation.comparison;
  if (!comparison?.previousEventId) return [];
  const entries = [];
  const integer = (value) => formatInteger(value, locale);
  if (Number.isSafeInteger(comparison.elapsedMs)) {
    entries.push({ key: 'Elapsed', value: formatDuration(comparison.elapsedMs) });
  }
  entries.push(
    {
      key: 'Input tokens',
      value: transition(comparison.previousInputTokens, observation.inputTokens, integer),
    },
    {
      key: 'Input-token delta',
      value: formatSignedDelta(
        comparison.inputDeltaTokens,
        comparison.inputDeltaBasisPoints,
        locale,
      ),
    },
    {
      key: 'Cached input',
      value: transition(
        comparison.previousCachedInputTokens,
        observation.cachedInputTokens,
        integer,
      ),
    },
    {
      key: 'Cache-read delta',
      value: formatSignedInteger(comparison.cachedInputDeltaTokens, locale),
    },
    {
      key: 'Cache reuse',
      value: transition(
        comparison.previousReuseBasisPoints,
        observation.reuseBasisPoints,
        formatBasisPoints,
      ),
    },
    {
      key: 'Comparison state',
      value: COMPARISON_STATE_LABELS[comparison.state] || comparison.state,
    },
  );
  return entries;
}

function cacheObservationDetailSections(observation, options = {}) {
  if (!observation) return { timelineSections: [], inspectorSections: [] };
  const locale = options.locale || 'en';
  const timelineSections = [{
    purpose: 'content',
    type: 'token_usage',
    title: 'Token usage',
    items: tokenUsageItems(observation, locale),
  }];
  const inspectorSections = [];
  if (observation.comparison?.state !== NO_PREVIOUS_OBSERVATION_STATE) {
    const entries = comparisonEntries(observation, locale);
    if (entries.length) {
      inspectorSections.push({
        purpose: 'context',
        type: 'kv',
        title: 'Comparison Context',
        entries,
      });
    }
  }
  if (observation.comparison?.state === CACHE_DISCONTINUITY_STATE) {
    inspectorSections.push({
      purpose: 'context',
      type: 'notice',
      title: 'Inference notice',
      text: CACHE_DISCONTINUITY_INFERENCE_NOTICE,
      level: 'info',
    });
  }
  return { timelineSections, inspectorSections };
}

module.exports = {
  CACHE_DISCONTINUITY_INFERENCE_NOTICE,
  COMPARISON_STATE_LABELS,
  cacheObservationDetailSections,
  cachePresentationFactsForEvent,
  formatBasisPoints,
  formatDuration,
  formatSignedDelta,
  mergePresentationFacts,
};
