'use strict';

function createCodexSearch(deps) {
  const {
    canonicalSchemaVersion,
    codeModePresentationFactsForEvent,
    codeModePresentationContextMap,
    codeModeRequestCatalog,
    codeModeRequestLabel,
    codexSourceKind,
    codexSourceLocator,
    defaultLocale,
    derivedSessionKind,
    displayProjectFile,
    eventKindCatalog,
    localizedLogicalLabel,
    normalizeSearchPath,
    rawRecordLabel,
    rawRef,
    resolveLocale,
    sanitizeLogicalEnvelopeValue,
    sanitizeLogicalEventDto,
  } = deps;

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
    return Math.max(
      countSearchMatches(event.preview, q),
      countSearchMatches(event.searchText, q),
    );
  }

  function eventHasSearchHit(event, q) {
    return eventSearchMatchCount(event, q) > 0;
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

  function eventMatches(event, filters, presentationIndexes) {
    if (filters.layer && event.layer !== filters.layer) return false;
    if (filters.kind && event.kind !== filters.kind && event.subtype !== filters.kind) return false;
    if (filters.status && event.status !== filters.status) return false;
    if (filters.tool && !String(event.toolName || '').toLowerCase().includes(filters.tool.toLowerCase())) return false;
    if (filters.codeModeRequest) {
      if (event.layer !== 'main' || event.subtype !== 'code_mode_operation') return false;
      const fact = presentationIndexes?.codeModeDeclaredRequests?.get(String(event.id || ''));
      if (!fact?.toolNames?.includes(filters.codeModeRequest)) return false;
    }
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

  function sessionSummary(session, index) {
    const derivedKind = derivedSessionKind(session);
    const parentSession = session.parentSessionId ? index?.sessionsById?.get(session.parentSessionId) : null;
    const forkedFromSession = session.forkedFromSessionId ? index?.sessionsById?.get(session.forkedFromSessionId) : null;
    return {
      id: session.id,
      title: sanitizeLogicalEnvelopeValue(session.title),
      sourceFile: session.sourceFile,
      bytes: session.bytes,
      lineCount: session.lineCount,
      cwdSet: [...session.cwdSet],
      parentSessionId: session.parentSessionId,
      parentSessionInferred: Boolean(session.parentSessionInferred),
      parentSessionTitle: sanitizeLogicalEnvelopeValue(parentSession?.title || ''),
      forkedFromSessionId: session.forkedFromSessionId,
      forkedFromSessionTitle: sanitizeLogicalEnvelopeValue(forkedFromSession?.title || ''),
      agentNickname: sanitizeLogicalEnvelopeValue(session.agentNickname),
      isDerivedSession: Boolean(derivedKind),
      derivedKind,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      counts: session.counts,
      topTools: session.analysis.toolUsage.slice(0, 5),
      failedCommands: session.analysis.failedCommands.length,
      patchedFiles: session.analysis.patchedFiles.slice(0, 5),
      protocolCount: session.analysis.protocolStats.reduce((sum, item) => sum + item.count, 0),
      rawEventCount: session.rawEvents.length,
    };
  }

  function rawEventDto(raw, q, locale = defaultLocale) {
    const hasSearchHit = q ? eventHasSearchHit(raw, q) : false;
    return {
      id: raw.rawId,
      schemaVersion: canonicalSchemaVersion,
      sourceKind: codexSourceKind,
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
      hasLongOutput: raw.searchText.length > 1600,
      hasSearchHit,
      touchedFiles: raw.touchedFiles,
      outputStats: {
        exitCode: raw.exitCode,
        durationMs: raw.durationMs,
      },
      source: raw.source,
      sourceLocator: codexSourceLocator(raw.source),
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
      searchText: raw.searchText,
      snippet: hasSearchHit ? eventSearchSnippet(raw, q) : '',
    };
  }

  function logicalEventDto(event, q, locale = defaultLocale, presentationContexts, presentationFacts) {
    const hasSearchHit = q ? eventHasSearchHit(event, q) : false;
    const presentationContext = presentationContexts?.get(event.id);
    return sanitizeLogicalEventDto({
      id: event.id,
      schemaVersion: event.schemaVersion,
      sourceKind: event.sourceKind,
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
      source: event.source,
      sourceLocator: event.sourceLocator,
      rawRefs: event.rawRefs,
      channels: event.channels,
      snippet: hasSearchHit ? eventSearchSnippet(event, q) : '',
      ...(presentationContext ? { presentationContext } : {}),
      ...(presentationFacts ? { presentationFacts } : {}),
    });
  }

  function sourceEventsForLayer(session, layer, locale, q = '') {
    if (layer === 'raw') return session.rawEvents.map((raw) => rawEventDto(raw, q, locale));
    return session.logicalEvents.filter((event) => event.layer === layer);
  }

  function hasActiveProjectExpression(filters) {
    return Boolean(
      String(filters.q || '').trim()
      || String(filters.file || '').trim()
      || String(filters.kind || '').trim()
      || String(filters.status || '').trim()
      || String(filters.codeModeRequest || '').trim(),
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
    for (const session of index.sessions) {
      if (!sessionWithinDateRange(session, filters)) continue;
      const sourceEvents = sourceEventsForLayer(session, layer, locale);
      const structuralFilters = { ...filters, q: '', layer };
      const structurallyMatched = sourceEvents.filter((event) => eventMatches(event, structuralFilters, session.presentationIndexes));
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
        const label = layer === 'raw'
          ? event.label
          : localizedLogicalLabel(event, locale);
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

  function ordinarySessionResult(index, filters, locale) {
    let sessions = index.sessions.filter((session) => {
      if (!sessionWithinDateRange(session, filters)) return false;
      if (filters.kind || filters.status || filters.tool || filters.file || filters.codeModeRequest) {
        const layer = filters.layer || 'main';
        const haystack = sourceEventsForLayer(session, layer, locale);
        return haystack.some((event) => eventMatches(event, { ...filters, layer }, session.presentationIndexes));
      }
      return true;
    });

    if (filters.sort === 'started-asc') {
      sessions = sessions.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    } else if (filters.sort === 'events-desc') {
      sessions = sessions.sort((a, b) => b.logicalEvents.length - a.logicalEvents.length);
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

  function filterSessions(index, filters = {}) {
    const locale = resolveLocale(filters.locale);
    if (hasActiveProjectExpression(filters)) return projectSearchResult(index, filters, locale);
    return ordinarySessionResult(index, filters, locale);
  }

  function fileSuggestions(index, options = {}) {
    const normalizedOptions = typeof options === 'number' ? { limit: options } : options;
    const layer = normalizedOptions.layer || 'main';
    const limit = normalizedOptions.limit ?? 80;
    const sessions = normalizedOptions.sessionId
      ? [index.sessionsById.get(normalizedOptions.sessionId)].filter(Boolean)
      : index.sessions || [];
    const counts = new Map();
    for (const session of sessions) {
      const events = layer === 'raw'
        ? session.rawEvents || []
        : (session.logicalEvents || []).filter((event) => event.layer === layer);
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

  function getTimeline(index, sessionId, filters) {
    const locale = resolveLocale(filters.locale);
    const session = index.sessionsById.get(sessionId);
    if (!session) return null;
    const layer = filters.layer || 'main';
    const sourceEvents = sourceEventsForLayer(session, layer, locale, layer === 'raw' ? filters.q : '');
    const structuralFilters = { ...filters, q: '', layer };
    const matched = sourceEvents.filter((event) => eventMatches(event, structuralFilters, session.presentationIndexes));
    const searchMatchCount = filters.q
      ? matched.reduce((sum, event) => sum + eventSearchMatchCount(event, filters.q), 0)
      : 0;
    const searchEventCount = filters.q
      ? matched.reduce((sum, event) => sum + (eventHasSearchHit(event, filters.q) ? 1 : 0), 0)
      : 0;
    const page = matched.slice(filters.offset, filters.offset + filters.limit);
    const presentationContexts = layer === 'main' && page.length
      ? codeModePresentationContextMap(session.logicalEvents)
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
      codeModeRequests: layer === 'main'
        ? codeModeRequestCatalog([session], {
          label: (value) => codeModeRequestLabel(value, locale),
        })
        : [],
      events: layer === 'raw' ? page : page.map((event) => logicalEventDto(
        event,
        filters.q,
        locale,
        presentationContexts,
        layer === 'main' ? codeModePresentationFactsForEvent(session, event.id) : null,
      )),
    };
  }

  function getEvent(index, sessionId, eventId, options = {}) {
    const locale = resolveLocale(options.locale);
    const session = index.sessionsById.get(sessionId);
    if (!session) return null;
    const layer = options.layer || 'main';
    const sourceEvents = sourceEventsForLayer(session, layer, locale);
    const event = sourceEvents.find((candidate) => (candidate.id || candidate.rawId) === eventId);
    if (!event) return null;
    if (layer === 'raw') return event;
    const presentationContexts = layer === 'main'
      ? codeModePresentationContextMap(session.logicalEvents)
      : null;
    return logicalEventDto(
      event,
      '',
      locale,
      presentationContexts,
      layer === 'main' ? codeModePresentationFactsForEvent(session, event.id) : null,
    );
  }

  return {
    fileSuggestions,
    filterSessions,
    getEvent,
    getTimeline,
    matchTerms,
  };
}

module.exports = {
  createCodexSearch,
};
