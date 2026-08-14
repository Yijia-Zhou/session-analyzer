'use strict';

// Compatibility factory for existing Codex-internal tests and callers. The
// query implementation lives in the source-neutral session-query module.
const { createSessionQuery } = require('./session-query');

function createCodexSearch(deps = {}) {
  const query = createSessionQuery({
    schemaVersion: deps.canonicalSchemaVersion,
    defaultLocale: deps.defaultLocale,
    derivedSessionKind: deps.derivedSessionKind,
    displayProjectFile: deps.displayProjectFile,
    eventKindCatalog: deps.eventKindCatalog,
    localizedLogicalLabel: deps.localizedLogicalLabel,
    normalizeSearchPath: deps.normalizeSearchPath,
    rawRecordLabel: deps.rawRecordLabel,
    rawRef: deps.rawRef,
    resolveLocale: deps.resolveLocale,
    sanitizeLogicalEnvelopeValue: deps.sanitizeLogicalEnvelopeValue,
    sanitizeLogicalEventDto: deps.sanitizeLogicalEventDto,
    presentation: {
      normalizeFilters(filters, requestParams) {
        const normalized = { ...filters };
        const sourcePresentation = { ...(normalized.sourcePresentation || {}) };
        const fromRequest = typeof requestParams?.get === 'function';
        const requestValue = fromRequest ? requestParams.get('codeModeRequest') : normalized.codeModeRequest;
        const codeModeRequest = deps.normalizeCodeModeRequest?.(requestValue) || '';
        if (Object.hasOwn(normalized, 'codeModeRequest')) delete normalized.codeModeRequest;
        if (deps.codeModeScriptOperationKind && normalized.kind === deps.codeModeScriptOperationKind) {
          normalized.kind = '';
          sourcePresentation.scriptOperation = true;
        }
        if (codeModeRequest) {
          sourcePresentation.request = codeModeRequest;
        } else if (!fromRequest && String(requestValue || '').trim()) {
          sourcePresentation.requestSpecified = true;
        }
        normalized.sourcePresentation = sourcePresentation;
        return normalized;
      },
      matchesEvent(event, filters, session) {
        const sourcePresentation = filters.sourcePresentation || {};
        if (sourcePresentation.scriptOperation
            && !deps.isCodeModeScriptOperation?.(event, session?.presentationIndexes)) {
          return false;
        }
        if (sourcePresentation.requestSpecified
            || (sourcePresentation.request
              && !deps.codeModeRequestMatches?.(event, session, sourcePresentation.request))) {
          return false;
        }
        return true;
      },
      hasActiveFilter(filters) {
        const sourcePresentation = filters.sourcePresentation || {};
        return Boolean(
          sourcePresentation.scriptOperation
          || sourcePresentation.request
          || sourcePresentation.requestSpecified,
        );
      },
      contextMap: deps.codeModePresentationContextMap,
      factsForEvent: deps.codeModePresentationFactsForEvent,
      facets(sessions, options = {}) {
        const label = (value) => deps.codeModeRequestLabel?.(value, options.locale) || value;
        return deps.codeModeRequestCatalog?.(sessions, { label }) || [];
      },
      indexPresentation(index, options = {}) {
        const label = (value) => deps.codeModeRequestLabel?.(value, options.locale) || value;
        const items = Array.isArray(index?.codeModeRequests)
          ? index.codeModeRequests
          : (deps.codeModeRequestCatalog?.(index?.sessions, { label }) || []);
        return {
          codeModeRequests: items.map((item) => ({
            ...item,
            label: label(item.value),
          })),
        };
      },
      rawForkSegment: deps.rawForkSegment,
    },
  });

  return {
    ...query,
    getTimeline(...args) {
      const result = query.getTimeline(...args);
      if (!result) return result;
      const { facets = [], ...rest } = result;
      return { ...rest, codeModeRequests: facets };
    },
  };
}

module.exports = {
  createCodexSearch,
};
