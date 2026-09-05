'use strict';

const i18n = require('./shared/i18n');
const {
  DATA_URL_MARKER,
  sanitizeLogicalDetailValue,
} = require('./shared/logical-detail-sanitizer');
const {
  fsPathApi,
  fsPathFlavor,
  isPathInsideOrSame,
  resolveFsPath,
} = require('./shared/fs-path');
const {
  validateCanonicalIndexedSessionShape,
  validateCanonicalLogicalEventShape,
  validateCanonicalRawEventShape,
  validateCanonicalSessionShape,
} = require('./canonical-contract');
const {
  readProjectQueryRowPreview,
  scanProjectQueryShard,
  requireValidatedProjectQueryStore,
} = require('./project-query-store');
const {
  cachePresentationFactsForEvent,
  mergePresentationFacts,
} = require('./cache-observation-presentation');

const PROJECT_QUERY_SCAN_CONCURRENCY = 8;

async function mapProjectQuerySessions(sessions, signal, visit) {
  const results = new Array(sessions.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < sessions.length) {
      signal?.throwIfAborted?.();
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await visit(sessions[index], index);
    }
  }
  const workerCount = Math.min(PROJECT_QUERY_SCAN_CONCURRENCY, sessions.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function defaultNormalizeSearchPath(input) {
  return String(input || '').replace(/\\/g, '/').toLowerCase();
}

function defaultDisplayProjectFile(file, repoRoot) {
  const text = String(file || '').trim();
  if (!text) return '';
  const pathApi = fsPathApi(text);
  if (pathApi.isAbsolute(text)
      && repoRoot
      && fsPathFlavor(text) === fsPathFlavor(repoRoot)
      && isPathInsideOrSame(text, repoRoot)) {
    return pathApi.relative(resolveFsPath(repoRoot), resolveFsPath(text)).replace(/\\/g, '/');
  }
  return text.replace(/\\/g, '/').replace(/^\.\//, '');
}

function defaultDerivedSessionKind(session) {
  if (session?.primarySessionMetaKind) return session.primarySessionMetaKind;
  if (/\breview\b/i.test(session?.agentNickname || '')) return 'review';
  if (session?.parentSessionId) return 'subagent';
  return '';
}

function defaultLocalizedLogicalLabel(logical, locale = i18n.DEFAULT_LOCALE) {
  if (!logical) return '';
  const label = sanitizeLogicalDetailValue(logical.label, { marker: DATA_URL_MARKER });
  const translated = i18n.lookupKnownLabel(label, locale);
  if (translated) return translated;
  if (label) return label;
  if (logical.layer === 'protocol') return i18n.eventKindLabel(logical.subtype || logical.kind, locale);
  return '';
}

function defaultRawRecordLabel(raw, locale = i18n.DEFAULT_LOCALE) {
  return i18n.rawRecordLabel(raw?.payloadType || raw?.recordType || '', locale);
}

function defaultSanitizeLogicalEnvelopeValue(value) {
  return sanitizeLogicalDetailValue(value, { marker: DATA_URL_MARKER });
}

function defaultSanitizeLogicalEventDto(dto) {
  const { id, source, rawRefs, ...rest } = dto;
  return {
    id,
    ...defaultSanitizeLogicalEnvelopeValue(rest),
    source,
    rawRefs,
  };
}

function sourceLocatorForRaw(raw) {
  return raw?.sourceLocator?.type ? raw.sourceLocator : null;
}

function defaultRawRef(raw) {
  const sourceLocator = sourceLocatorForRaw(raw);
  return {
    file: typeof raw?.source?.file === 'string' ? raw.source.file : sourceLocator?.file || '',
    line: Number.isSafeInteger(raw?.source?.line) ? raw.source.line : sourceLocator?.line ?? null,
    rawId: typeof raw?.rawId === 'string' ? raw.rawId : '',
    sourceLocator: sourceLocator ? { ...sourceLocator } : null,
    sourceRecordType: typeof raw?.recordType === 'string' ? raw.recordType : '',
    sourceEventType: typeof raw?.payloadType === 'string' ? raw.payloadType : '',
  };
}

function defaultEventKindCatalog(sessions, options = {}) {
  const locale = i18n.resolveLocale(options.locale);
  const counts = { main: new Map(), protocol: new Map(), raw: new Map() };
  const add = (layer, value) => {
    const key = String(value || '').trim();
    if (!key) return;
    counts[layer].set(key, (counts[layer].get(key) || 0) + 1);
  };
  for (const session of sessions || []) {
    for (const event of session.logicalEvents || []) {
      if (event.layer === 'protocol') {
        add('protocol', event.subtype || event.kind);
        continue;
      }
      add('main', event.kind);
    }
    for (const raw of session.rawEvents || []) add('raw', raw.payloadType || raw.recordType);
  }
  const eventLabel = options.eventKindLabel || ((value, currentLocale) => i18n.eventKindLabel(value, currentLocale));
  const rawLabel = options.rawRecordValueLabel || ((value, currentLocale) => i18n.rawRecordLabel(value, currentLocale));
  const optionsFromCounts = (map, labelFn) => [...map.entries()]
    .sort((left, right) => labelFn(left[0], locale).localeCompare(labelFn(right[0], locale)) || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({
      value,
      label: labelFn(value, locale),
      count,
    }));
  return {
    main: optionsFromCounts(counts.main, eventLabel),
    protocol: optionsFromCounts(counts.protocol, eventLabel),
    raw: optionsFromCounts(counts.raw, rawLabel),
  };
}

function createSessionQuery(options = {}) {
  const {
    schemaVersion = 1,
    defaultLocale = i18n.DEFAULT_LOCALE,
    derivedSessionKind = defaultDerivedSessionKind,
    displayProjectFile = defaultDisplayProjectFile,
    eventKindCatalog = defaultEventKindCatalog,
    localizedLogicalLabel = defaultLocalizedLogicalLabel,
    normalizeSearchPath = defaultNormalizeSearchPath,
    rawRecordLabel = defaultRawRecordLabel,
    rawRef = defaultRawRef,
    resolveLocale = i18n.resolveLocale,
    sanitizeLogicalEnvelopeValue = defaultSanitizeLogicalEnvelopeValue,
    sanitizeLogicalEventDto = defaultSanitizeLogicalEventDto,
    presentation = {},
  } = options;

  const {
    normalizeFilters: normalizePresentationFilters = (filters) => filters,
    matchesEvent: presentationMatchesEvent = () => true,
    hasActiveFilter: presentationHasActiveFilter = () => false,
    contextMap: presentationContextMap = () => null,
    factsForEvent: presentationFactsForEvent = () => null,
    projectRowFacts: presentationProjectRowFacts = () => null,
    matchesProjectRow: presentationMatchesProjectRow = () => true,
    facets: presentationFacets = () => [],
    indexPresentation = () => ({}),
  } = presentation;

  function normalizeFilters(filters = {}) {
    const source = filters && typeof filters === 'object' && !Array.isArray(filters)
      ? { ...filters }
      : {};
    const requestParams = source.requestParams;
    delete source.requestParams;
    const normalized = normalizePresentationFilters(source, requestParams);
    return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? normalized
      : source;
  }

  function requestValue(searchParams, name) {
    return typeof searchParams?.get === 'function' ? searchParams.get(name) || '' : '';
  }

  function requestNumber(searchParams, name, fallback, min, max) {
    const value = Number(requestValue(searchParams, name));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  function filtersFromSearchParams(searchParams, optionsFromRequest = {}) {
    return normalizeFilters({
      requestParams: searchParams,
      q: requestValue(searchParams, 'q'),
      from: requestValue(searchParams, 'from'),
      to: requestValue(searchParams, 'to'),
      layer: requestValue(searchParams, 'layer'),
      kind: requestValue(searchParams, 'kind'),
      status: requestValue(searchParams, 'status'),
      tool: requestValue(searchParams, 'tool'),
      file: requestValue(searchParams, 'file'),
      sort: requestValue(searchParams, 'sort') || 'updated-desc',
      offset: optionsFromRequest.offset ?? requestNumber(searchParams, 'offset', 0, 0, 1_000_000),
      limit: optionsFromRequest.limit ?? requestNumber(searchParams, 'limit', 150, 1, 500),
      locale: optionsFromRequest.locale ?? requestValue(searchParams, 'locale'),
    });
  }

  function searchPhraseRegex(q, flags = '') {
    const phrase = String(q || '').trim();
    if (!phrase) return null;
    const pattern = phrase
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    return new RegExp(pattern, flags.includes('i') ? flags : `${flags}i`);
  }

  function matchTerms(text, q) {
    const regex = searchPhraseRegex(q);
    return regex ? regex.test(String(text || '')) : true;
  }

  function countSearchMatches(text, q) {
    const regex = searchPhraseRegex(q, 'g');
    return regex ? [...String(text || '').matchAll(regex)].length : 0;
  }

  function eventSearchMatchCount(event, q) {
    return Math.max(countSearchMatches(event.preview, q), countSearchMatches(event.searchText, q));
  }

  function eventHasSearchHit(event, q) {
    const regex = searchPhraseRegex(q);
    if (!regex) return false;
    return regex.test(String(event.preview || ''))
      || regex.test(String(event.searchText || ''));
  }

  function makeSnippet(text, q) {
    const regex = searchPhraseRegex(q);
    if (!regex) return '';
    const source = String(text || '');
    const match = regex.exec(source);
    if (!match) return '';
    const first = match.index;
    const start = Math.max(0, first - 80);
    const end = Math.min(source.length, first + 180);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < source.length ? '...' : '';
    return `${prefix}${source.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
  }

  function eventSearchSnippet(event, q) {
    return makeSnippet(event.preview, q) || makeSnippet(event.searchText, q);
  }

  function eventMatches(event, filters, session) {
    if (filters.layer && event.layer !== filters.layer) return false;
    if (!presentationMatchesEvent(event, filters, session)) return false;
    if (filters.kind && event.kind !== filters.kind && event.subtype !== filters.kind) return false;
    if (filters.status && event.status !== filters.status) return false;
    if (filters.tool && !String(event.toolName || '').toLowerCase().includes(filters.tool.toLowerCase())) return false;
    if (filters.file) {
      const needle = normalizeSearchPath(filters.file);
      const sourceMatch = normalizeSearchPath(event.source?.file).includes(needle);
      const touchedMatch = (event.touchedFiles || []).some((file) => normalizeSearchPath(file).includes(needle));
      const rawMatch = (event.rawRefs || []).some((ref) => normalizeSearchPath(ref.file).includes(needle));
      if (!sourceMatch && !touchedMatch && !rawMatch) return false;
    }
    if (filters.q && !eventHasSearchHit(event, filters.q)) return false;
    return true;
  }

  function projectRowMatches(row, filters) {
    if (!presentationMatchesProjectRow(row.presentation, filters)) return false;
    if (filters.kind && row.kind !== filters.kind && row.subtype !== filters.kind) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.tool && !row.toolName.toLowerCase().includes(filters.tool.toLowerCase())) return false;
    if (filters.file) {
      const needle = normalizeSearchPath(filters.file);
      if (!row.filterFiles.some((file) => normalizeSearchPath(file).includes(needle))) return false;
    }
    return true;
  }

  function sessionSummary(session, index) {
    const projected = Boolean(index?.projectQueryStore);
    const residentComplete = !projected
      && Array.isArray(session?.rawEvents)
      && Array.isArray(session?.logicalEvents);
    let sessionSourceKind;
    if (projected) {
      if (typeof session?.id !== 'string' || !session.id
          || typeof session.sourceKind !== 'string' || !session.sourceKind
          || session.sourceKind !== index.sourceKind
          || !session.counts || typeof session.counts !== 'object'
          || !Number.isSafeInteger(session.rawEventCount) || session.rawEventCount < 0
          || !Number.isSafeInteger(session.logicalEventCount) || session.logicalEventCount < 0
          || !session.summary || typeof session.summary !== 'object') {
        const error = new Error(`Project query Session projection is invalid for ${session?.id || '<unknown>'}`);
        error.code = 'PROJECT_QUERY_STORE_CONTRACT_VIOLATION';
        throw error;
      }
      sessionSourceKind = session.sourceKind;
    } else {
      sessionSourceKind = residentComplete
        ? validateCanonicalSessionShape(session, index?.sourceKind)
        : validateCanonicalIndexedSessionShape(session, index?.sourceKind);
    }
    const derivedKind = derivedSessionKind(session);
    const parentSession = session.parentSessionId ? index?.sessionsById?.get(session.parentSessionId) : null;
    const forkedFromSession = session.forkedFromSessionId ? index?.sessionsById?.get(session.forkedFromSessionId) : null;
    const forkDetails = session.forkStorageMode ? {
      forkStorageMode: session.forkStorageMode,
      forkedAt: session.forkedAt || '',
      forkPointUuid: session.forkPointUuid || '',
      forkContinuationState: session.forkContinuationState || '',
      forkEvidence: session.forkEvidence ? sanitizeLogicalEnvelopeValue(session.forkEvidence) : null,
      inheritedContext: session.inheritedContext ? sanitizeLogicalEnvelopeValue(session.inheritedContext) : null,
    } : {};
    return {
      id: session.id,
      sourceKind: sessionSourceKind,
      sourceSessionId: session.sourceSessionId || session.id,
      sourceDerivedId: session.sourceDerivedId || '',
      sourceClientVersion: session.sourceClientVersion || '',
      projectAssociation: session.projectAssociation || '',
      title: sanitizeLogicalEnvelopeValue(session.title),
      sourceFile: session.sourceFile,
      bytes: session.bytes,
      lineCount: session.lineCount,
      cwdSet: [...(session.cwdSet || [])],
      parentSessionId: session.parentSessionId,
      parentSessionInferred: Boolean(session.parentSessionInferred),
      parentSessionTitle: sanitizeLogicalEnvelopeValue(parentSession?.title || ''),
      forkedFromSessionId: session.forkedFromSessionId,
      forkedFromSessionTitle: sanitizeLogicalEnvelopeValue(forkedFromSession?.title || ''),
      ...forkDetails,
      supersededBySessionId: session.supersededBySessionId || '',
      supersededAt: session.supersededAt || '',
      supersededReason: session.supersededReason || '',
      agentNickname: sanitizeLogicalEnvelopeValue(session.agentNickname),
      isDerivedSession: Boolean(derivedKind),
      derivedKind,
      derivedRunId: session.derivedRunId || '',
      derivedRelationship: session.derivedRelationship ? sanitizeLogicalEnvelopeValue(session.derivedRelationship) : null,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      counts: session.counts,
      topTools: projected || !residentComplete
        ? session.summary.topTools
        : (session.analysis?.toolUsage || []).slice(0, 5),
      failedCommands: projected || !residentComplete
        ? session.summary.failedCommandCount
        : (session.analysis?.failedCommands || []).length,
      patchedFiles: projected || !residentComplete
        ? session.summary.patchedFiles
        : (session.analysis?.patchedFiles || []).slice(0, 5),
      protocolCount: projected || !residentComplete
        ? session.summary.protocolCount
        : (session.analysis?.protocolStats || []).reduce((sum, item) => sum + item.count, 0),
      rawEventCount: projected || !residentComplete ? session.rawEventCount : session.rawEvents.length,
    };
  }

  function projectSessionMetadata(session) {
    validateCanonicalSessionShape(session, session?.sourceKind);
    return {
      rawEventCount: session.rawEvents.length,
      logicalEventCount: session.logicalEvents.length,
      summary: {
        topTools: sanitizeLogicalEnvelopeValue((session.analysis?.toolUsage || []).slice(0, 5)),
        failedCommandCount: (session.analysis?.failedCommands || []).length,
        patchedFiles: sanitizeLogicalEnvelopeValue((session.analysis?.patchedFiles || []).slice(0, 5)),
        protocolCount: (session.analysis?.protocolStats || []).reduce((sum, item) => sum + item.count, 0),
      },
    };
  }

  function rawEventDto(raw, q, locale = defaultLocale, session = null, expectedSourceKind = '') {
    const rawSourceKind = validateCanonicalRawEventShape(raw, expectedSourceKind);
    const hasSearchHit = q ? eventHasSearchHit(raw, q) : false;
    const forkSegment = presentation.rawForkSegment?.(session, raw.rawId) || '';
    const searchText = String(raw.searchText || '');
    return {
      id: raw.rawId,
      schemaVersion,
      sourceKind: rawSourceKind,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      recordType: raw.recordType,
      payloadType: raw.payloadType,
      sourceRecordType: raw.recordType || '',
      sourceEventType: raw.payloadType || '',
      kind: raw.payloadType || raw.recordType,
      subtype: raw.role || '',
      layer: 'raw',
      role: raw.role,
      label: rawRecordLabel(raw, locale),
      preview: raw.preview,
      severity: raw.payloadType === 'error' ? 'error' : 'normal',
      status: raw.status,
      toolName: raw.toolName,
      hasLongOutput: searchText.length > 1600,
      hasSearchHit,
      touchedFiles: raw.touchedFiles || [],
      outputStats: { exitCode: raw.exitCode, durationMs: raw.durationMs },
      source: raw.source,
      sourceLocator: sourceLocatorForRaw(raw),
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
      searchText,
      snippet: hasSearchHit ? eventSearchSnippet(raw, q) : '',
      ...(forkSegment ? { forkSegment } : {}),
      ...(forkSegment === 'inherited_context' && session?.forkedFromSessionId
        ? { inheritedFromSessionId: session.forkedFromSessionId }
        : {}),
    };
  }

  function logicalEventDto(
    event,
    q,
    locale = defaultLocale,
    presentationContexts,
    presentationFacts,
    expectedSourceKind = '',
  ) {
    const eventSourceKind = validateCanonicalLogicalEventShape(event, expectedSourceKind);
    const hasSearchHit = q ? eventHasSearchHit(event, q) : false;
    const presentationContext = presentationContexts?.get(event.id);
    return sanitizeLogicalEventDto({
      id: event.id,
      schemaVersion: event.schemaVersion,
      sourceKind: eventSourceKind,
      timestamp: event.timestamp,
      turnId: event.turnId,
      recordType: '',
      payloadType: event.subtype,
      kind: event.kind,
      subtype: event.subtype,
      layer: event.layer,
      role: event.role,
      label: localizedLogicalLabel(event, locale),
      preview: event.preview,
      severity: event.severity,
      status: event.status,
      toolName: event.toolName,
      hasLongOutput: event.hasLongOutput,
      hasReadableReasoning: event.hasReadableReasoning,
      hasSearchHit,
      tags: event.tags || [],
      touchedFiles: event.touchedFiles,
      outputStats: event.outputStats,
      tokenUsage: event.tokenUsage,
      usageLimits: event.usageLimits,
      ...(event.provenance ? { provenance: event.provenance } : {}),
      source: event.source,
      sourceLocator: event.sourceLocator,
      rawRefs: event.rawRefs,
      channels: event.channels,
      snippet: hasSearchHit ? eventSearchSnippet(event, q) : '',
      ...(presentationContext ? { presentationContext } : {}),
      ...(presentationFacts ? { presentationFacts } : {}),
    });
  }

  function sourceEventsForLayer(index, session, layer, locale, q = '') {
    const sessionSourceKind = validateCanonicalSessionShape(session, index?.sourceKind);
    if (layer === 'raw') {
      return session.rawEvents.map((raw) => rawEventDto(raw, q, locale, session, sessionSourceKind));
    }
    return session.logicalEvents
      .map((event) => {
        validateCanonicalLogicalEventShape(event, sessionSourceKind);
        return event;
      })
      .filter((event) => event.layer === layer);
  }

  function hasActiveProjectExpression(filters) {
    return Boolean(
      String(filters.q || '').trim()
      || String(filters.file || '').trim()
      || String(filters.kind || '').trim()
      || String(filters.status || '').trim()
      || presentationHasActiveFilter(filters),
    );
  }

  function sessionWithinDateRange(session, filters) {
    const activityAt = String(session.updatedAt || session.startedAt || '');
    if (filters.from && activityAt < `${filters.from}T00:00:00.000Z`) return false;
    if (filters.to && activityAt > `${filters.to}T23:59:59.999Z`) return false;
    return true;
  }

  function compareLatestMatch(a, b) {
    const timestampOrder = String(b.latest.event.timestamp || '').localeCompare(String(a.latest.event.timestamp || ''));
    if (timestampOrder) return timestampOrder;
    const timelineOrder = b.latest.timelineIndex - a.latest.timelineIndex;
    if (timelineOrder) return timelineOrder;
    return String(a.session.id).localeCompare(String(b.session.id));
  }

  function latestMatchedEvent(matches) {
    return matches.reduce((latest, candidate) => {
      if (!latest) return candidate;
      const timestampOrder = String(candidate.event.timestamp || '').localeCompare(String(latest.event.timestamp || ''));
      if (timestampOrder > 0 || (timestampOrder === 0 && candidate.timelineIndex > latest.timelineIndex)) return candidate;
      return latest;
    }, null);
  }

  function projectSearchResult(index, filters, locale) {
    const layer = filters.layer || 'main';
    const results = [];
    let matchingEventTotal = 0;
    for (const session of index.sessions || []) {
      if (!sessionWithinDateRange(session, filters)) continue;
      const sourceEvents = sourceEventsForLayer(index, session, layer, locale);
      const structuralFilters = { ...filters, q: '', layer };
      const structurallyMatched = sourceEvents.filter((event) => eventMatches(event, structuralFilters, session));
      const matches = structurallyMatched
        .map((event, timelineIndex) => ({ event, timelineIndex }))
        .filter(({ event }) => !filters.q || eventHasSearchHit(event, filters.q));
      if (!matches.length) continue;
      const latest = latestMatchedEvent(matches);
      matchingEventTotal += matches.length;
      results.push({ session, matches, latest });
    }
    results.sort(compareLatestMatch);
    return {
      total: results.length,
      matchingEventTotal,
      sessions: results.map(({ session, matches, latest }) => {
        const event = latest.event;
        const label = layer === 'raw' ? event.label : localizedLogicalLabel(event, locale);
        const snippet = filters.q ? eventSearchSnippet(event, filters.q) : event.preview;
        return {
          ...sessionSummary(session, index),
          searchMatch: {
            eventCount: matches.length,
            latestEvent: {
              id: event.id || event.rawId,
              timestamp: event.timestamp,
              label: sanitizeLogicalEnvelopeValue(label),
              snippet: sanitizeLogicalEnvelopeValue(snippet),
              timelineIndex: latest.timelineIndex,
            },
          },
        };
      }),
    };
  }

  function projectRowLabel(row, layer, locale) {
    if (layer === 'raw') {
      return rawRecordLabel({
        payloadType: row.labelFact.payloadType,
        recordType: row.labelFact.recordType,
      }, locale);
    }
    return localizedLogicalLabel({
      label: row.labelFact.sourceLabel,
      layer,
      kind: row.kind,
      subtype: row.subtype,
    }, locale);
  }

  async function packedProjectSearchResult(index, filters, locale, queryOptions = {}) {
    const store = requireValidatedProjectQueryStore(
      index.projectQueryStore,
      (index.sessions || []).map((session) => session.id),
    );
    const layer = filters.layer || 'main';
    const hasTextQuery = Boolean(String(filters.q || '').trim());
    const eligibleSessions = (index.sessions || []).filter((session) => sessionWithinDateRange(session, filters));
    const scanned = await mapProjectQuerySessions(eligibleSessions, queryOptions.signal, async (session) => {
      let structuralOrdinal = 0;
      let eventCount = 0;
      let latest = null;
      await scanProjectQueryShard(store, session.id, layer, {
        includeText: hasTextQuery,
        signal: queryOptions.signal,
        onChunk: queryOptions.onChunk,
        onTextChunk: queryOptions.onTextChunk,
      }, (row, rowIndex) => {
        if (!projectRowMatches(row, filters)) return;
        const timelineIndex = structuralOrdinal;
        structuralOrdinal += 1;
        if (hasTextQuery && !eventHasSearchHit(row, filters.q)) return;
        eventCount += 1;
        const candidate = { row, rowIndex, timelineIndex };
        if (!latest
            || String(row.timestamp).localeCompare(String(latest.row.timestamp)) > 0
            || (row.timestamp === latest.row.timestamp && timelineIndex > latest.timelineIndex)) {
          latest = candidate;
        }
      });
      if (latest && !hasTextQuery) {
        latest.row.preview = await readProjectQueryRowPreview(
          store,
          session.id,
          layer,
          latest.rowIndex,
          {
            signal: queryOptions.signal,
            onTextChunk: queryOptions.onTextChunk,
          },
        );
      }
      return latest ? { session, eventCount, latest } : null;
    });
    const results = scanned.filter(Boolean);
    const matchingEventTotal = results.reduce((sum, result) => sum + result.eventCount, 0);
    results.sort((left, right) => {
      const timestampOrder = String(right.latest.row.timestamp).localeCompare(String(left.latest.row.timestamp));
      if (timestampOrder) return timestampOrder;
      const timelineOrder = right.latest.timelineIndex - left.latest.timelineIndex;
      if (timelineOrder) return timelineOrder;
      return String(left.session.id).localeCompare(String(right.session.id));
    });
    return {
      total: results.length,
      matchingEventTotal,
      sessions: results.map(({ session, eventCount, latest }) => ({
        ...sessionSummary(session, index),
        searchMatch: {
          eventCount,
          latestEvent: {
            id: latest.row.eventId,
            timestamp: latest.row.timestamp,
            label: sanitizeLogicalEnvelopeValue(projectRowLabel(latest.row, layer, locale)),
            snippet: sanitizeLogicalEnvelopeValue(
              filters.q ? eventSearchSnippet(latest.row, filters.q) : latest.row.preview,
            ),
            timelineIndex: latest.timelineIndex,
          },
        },
      })),
    };
  }

  function ordinarySessionResult(index, filters, locale) {
    let sessions = (index.sessions || []).filter((session) => {
      if (!sessionWithinDateRange(session, filters)) return false;
      if (filters.kind || filters.status || filters.tool || filters.file || presentationHasActiveFilter(filters)) {
        const layer = filters.layer || 'main';
        const haystack = sourceEventsForLayer(index, session, layer, locale);
        return haystack.some((event) => eventMatches(event, { ...filters, layer }, session));
      }
      return true;
    });

    if (filters.sort === 'started-asc') {
      sessions = sessions.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    } else if (filters.sort === 'events-desc') {
      sessions = sessions.sort((a, b) => (b.logicalEvents || []).length - (a.logicalEvents || []).length);
    } else if (filters.sort === 'failures-desc') {
      sessions = sessions.sort((a, b) => b.counts.failedCommands - a.counts.failedCommands);
    } else {
      sessions = sessions.sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
    }

    return {
      total: sessions.length,
      sessions: sessions.map((session) => sessionSummary(session, index)),
    };
  }

  async function packedOrdinarySessionResult(index, filters, locale, queryOptions = {}) {
    const store = requireValidatedProjectQueryStore(
      index.projectQueryStore,
      (index.sessions || []).map((session) => session.id),
    );
    const eligibleSessions = (index.sessions || []).filter((session) => sessionWithinDateRange(session, filters));
    let sessions = eligibleSessions;
    if (filters.tool) {
      const matches = await mapProjectQuerySessions(eligibleSessions, queryOptions.signal, async (session) => {
        let matched = false;
        await scanProjectQueryShard(store, session.id, filters.layer || 'main', {
          includeText: false,
          signal: queryOptions.signal,
          onChunk: queryOptions.onChunk,
        }, (row) => {
          if (!matched && projectRowMatches(row, filters)) matched = true;
        });
        return matched;
      });
      sessions = eligibleSessions.filter((session, index) => matches[index]);
    }
    if (filters.sort === 'started-asc') {
      sessions.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    } else if (filters.sort === 'events-desc') {
      sessions.sort((a, b) => (
        (b.logicalEventCount ?? b.logicalEvents?.length ?? 0)
        - (a.logicalEventCount ?? a.logicalEvents?.length ?? 0)
      ));
    } else if (filters.sort === 'failures-desc') {
      sessions.sort((a, b) => b.counts.failedCommands - a.counts.failedCommands);
    } else {
      sessions.sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)));
    }
    return {
      total: sessions.length,
      sessions: sessions.map((session) => sessionSummary(session, index)),
    };
  }

  function filterSessions(index, filters = {}, queryOptions = {}) {
    filters = normalizeFilters(filters);
    const locale = resolveLocale(filters.locale);
    if (index?.projectQueryStore) {
      if (hasActiveProjectExpression(filters)) {
        return packedProjectSearchResult(index, filters, locale, queryOptions);
      }
      return packedOrdinarySessionResult(index, filters, locale, queryOptions);
    }
    if (hasActiveProjectExpression(filters)) return projectSearchResult(index, filters, locale);
    return ordinarySessionResult(index, filters, locale);
  }

  function residentFileSuggestions(index, options = {}) {
    const normalizedOptions = typeof options === 'number' ? { limit: options } : options;
    const layer = normalizedOptions.layer || 'main';
    const limit = normalizedOptions.limit ?? 80;
    const sessions = normalizedOptions.sessionId
      ? [index.sessionsById.get(normalizedOptions.sessionId)].filter(Boolean)
      : index.sessions || [];
    const counts = new Map();
    for (const session of sessions) {
      const sessionSourceKind = validateCanonicalSessionShape(session, index?.sourceKind);
      const events = layer === 'raw'
        ? session.rawEvents.map((raw) => {
          validateCanonicalRawEventShape(raw, sessionSourceKind);
          return raw;
        })
        : session.logicalEvents
          .map((event) => {
            validateCanonicalLogicalEventShape(event, sessionSourceKind);
            return event;
          })
          .filter((event) => event.layer === layer);
      for (const event of events) {
        const eventFiles = new Map();
        for (const file of event.touchedFiles || []) {
          const display = displayProjectFile(file, index.repoRoot);
          const key = normalizeSearchPath(display);
          if (display && key && !eventFiles.has(key)) eventFiles.set(key, display);
        }
        for (const [key, file] of eventFiles) {
          const current = counts.get(key) || { file, count: 0 };
          current.count += 1;
          counts.set(key, current);
        }
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
      .slice(0, limit);
  }

  async function projectFileSuggestions(index, options = {}, queryOptions = {}) {
    if (!index?.projectQueryStore) return residentFileSuggestions(index, options);
    const normalizedOptions = typeof options === 'number' ? { limit: options } : options;
    if (normalizedOptions.sessionId) {
      const error = new Error('Session-scoped suggestions require an explicit Materialized Session');
      error.code = 'MATERIALIZED_SESSION_REQUIRED';
      throw error;
    }
    const store = requireValidatedProjectQueryStore(
      index.projectQueryStore,
      (index.sessions || []).map((session) => session.id),
    );
    const layer = normalizedOptions.layer || 'main';
    const limit = normalizedOptions.limit ?? 80;
    const counts = new Map();
    const sessionCounts = await mapProjectQuerySessions(index.sessions || [], queryOptions.signal, async (session) => {
      const localCounts = new Map();
      await scanProjectQueryShard(store, session.id, layer, {
        includeText: false,
        signal: queryOptions.signal,
        onChunk: queryOptions.onChunk,
      }, (row) => {
        const eventFiles = new Map();
        for (const file of row.suggestionFiles) {
          const display = displayProjectFile(file, index.repoRoot);
          const key = normalizeSearchPath(display);
          if (display && key && !eventFiles.has(key)) eventFiles.set(key, display);
        }
        for (const [key, file] of eventFiles) {
          const current = localCounts.get(key) || { file, count: 0 };
          current.count += 1;
          localCounts.set(key, current);
        }
      });
      return localCounts;
    });
    for (const localCounts of sessionCounts) {
      for (const [key, item] of localCounts) {
        const current = counts.get(key) || { file: item.file, count: 0 };
        current.count += item.count;
        counts.set(key, current);
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
      .slice(0, limit);
  }

  function sessionFileSuggestions(index, materializedSession, options = {}) {
    if (!materializedSession || typeof materializedSession !== 'object') {
      const error = new Error('Session-scoped suggestions require an explicit Materialized Session');
      error.code = 'MATERIALIZED_SESSION_REQUIRED';
      throw error;
    }
    return residentFileSuggestions({
      ...index,
      sessions: [materializedSession],
      sessionsById: new Map([[materializedSession.id, materializedSession]]),
    }, { ...options, sessionId: materializedSession.id });
  }

  function fileSuggestions(index, options = {}, queryOptions = {}) {
    if (index?.projectQueryStore) return projectFileSuggestions(index, options, queryOptions);
    return residentFileSuggestions(index, options);
  }

  function materializedSessionInput(index, value) {
    if (value && typeof value === 'object') return value;
    if (!index?.projectQueryStore) return index.sessionsById.get(value);
    const error = new Error('Event-level queries require an explicit Materialized Session');
    error.code = 'MATERIALIZED_SESSION_REQUIRED';
    throw error;
  }

  function sessionPresentationFactsForEvent(session, event) {
    return mergePresentationFacts(
      cachePresentationFactsForEvent(session, event),
      presentationFactsForEvent(session, event.id),
    );
  }

  function getTimeline(index, materializedSession, filters) {
    filters = normalizeFilters(filters);
    const locale = resolveLocale(filters.locale);
    const session = materializedSessionInput(index, materializedSession);
    if (!session) return null;
    const layer = filters.layer || 'main';
    const sourceEvents = sourceEventsForLayer(index, session, layer, locale, layer === 'raw' ? filters.q : '');
    const structuralFilters = { ...filters, q: '', layer };
    const matched = sourceEvents.filter((event) => eventMatches(event, structuralFilters, session));
    const searchMatchCount = filters.q
      ? matched.reduce((sum, event) => sum + eventSearchMatchCount(event, filters.q), 0)
      : 0;
    const searchEventCount = filters.q
      ? matched.reduce((sum, event) => sum + (eventHasSearchHit(event, filters.q) ? 1 : 0), 0)
      : 0;
    const page = matched.slice(filters.offset, filters.offset + filters.limit);
    const presentationContexts = layer === 'main' && page.length
      ? presentationContextMap(session.logicalEvents)
      : null;
    return {
      session: sessionSummary(session, index),
      total: matched.length,
      searchMatchCount,
      searchEventCount,
      offset: filters.offset,
      limit: filters.limit,
      layer,
      eventKinds: eventKindCatalog([session], { locale }),
      facets: layer === 'main' ? presentationFacets([session], { locale, filters }) : [],
      events: layer === 'raw' ? page : page.map((event) => logicalEventDto(
        event,
        filters.q,
        locale,
        presentationContexts,
        sessionPresentationFactsForEvent(session, event),
        session.sourceKind,
      )),
    };
  }

  function getEvent(index, materializedSession, eventId, options = {}) {
    const locale = resolveLocale(options.locale);
    const session = materializedSessionInput(index, materializedSession);
    if (!session) return null;
    const layer = options.layer || 'main';
    const sourceEvents = sourceEventsForLayer(index, session, layer, locale);
    const event = sourceEvents.find((candidate) => (candidate.id || candidate.rawId) === eventId);
    if (!event) return null;
    if (layer === 'raw') return event;
    const presentationContexts = layer === 'main'
      ? presentationContextMap(session.logicalEvents)
      : null;
    return logicalEventDto(
      event,
      '',
      locale,
      presentationContexts,
      sessionPresentationFactsForEvent(session, event),
      session.sourceKind,
    );
  }

  return {
    filtersFromSearchParams,
    fileSuggestions,
    filterSessions,
    getEvent,
    getTimeline,
    indexPresentation,
    matchTerms,
    projectFileSuggestions,
    projectQueryPresentation: presentationProjectRowFacts,
    projectSessionMetadata,
    sessionFileSuggestions,
  };
}

module.exports = {
  createSessionQuery,
  defaultDisplayProjectFile,
  defaultEventKindCatalog,
  defaultRawRef,
};
