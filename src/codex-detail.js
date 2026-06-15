'use strict';

function createCodexDetailBuilder(deps) {
  const {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    classifyProtocolText,
    codexSourceLocator,
    commandLanguageContext,
    extractCommandSections,
    extractConversationSections,
    extractJsReplSections,
    extractLifecycleSections,
    extractPatchSections,
    extractPlanSections,
    extractProtocolSections,
    extractReasoningSections,
    extractToolOperationSections,
    extractToolSections,
    extractUpdatePlanSections,
    extractWebSearchSections,
    filterDetailSections,
    i18n,
    inferCommandLanguage,
    localizeDetailSections,
    localizedLogicalLabel,
    logicalMeta,
    makeNoticeSection,
    makeRawJsonSection,
    maybePushCodeSection,
    maybePushKvSection,
    maybePushMarkdownSection,
    maybePushStructuredSection,
    maybePushTerminalSection,
    rawConversationRole,
    rawEventsForLogicalEvent,
    rawMatchesEvent,
    rawMeta,
    rawRecordLabel,
    rawRef,
    rawToolSections,
    sanitizeLogicalDetailSections,
    sanitizeLogicalEnvelopeValue,
    structuredOutputValue,
    toKvEntries,
    withoutKeys,
    withoutSectionTypes,
  } = deps;

  function rawPrimarySections(raw, relatedEvent, session = {}) {
    if (relatedEvent?.kind === 'protocol') {
      return {
        sections: withoutSectionTypes(extractProtocolSections(relatedEvent, [raw]), ['raw_json']),
        omitPayloadKeys: relatedEvent.subtype === 'session_meta'
          ? ['id', 'cwd', 'originator']
          : relatedEvent.subtype === 'turn_context'
            ? ['turn_id', 'cwd', 'model']
            : [],
      };
    }
    if (['usage_limit_warning', 'compaction', 'abort', 'rollback', 'error', 'subagent'].includes(relatedEvent?.kind)) {
      return {
        sections: withoutSectionTypes(extractLifecycleSections(relatedEvent, [raw]), ['raw_json']),
        omitPayloadKeys: ['type', 'turn_id', 'thread_id', 'thread_name', 'last_agent_message'],
      };
    }

    const tool = rawToolSections(raw, relatedEvent, session);
    if (tool.sections.length) return tool;

    if (rawConversationRole(raw)) {
      return {
        sections: extractConversationSections([raw]),
        omitPayloadKeys: ['message'],
      };
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_reasoning') {
      return {
        sections: extractReasoningSections([raw]),
        omitPayloadKeys: ['text'],
      };
    }
    if (raw.recordType === 'response_item' && raw.payloadType === 'reasoning') {
      return {
        sections: extractReasoningSections([raw]),
        omitPayloadKeys: [],
      };
    }
    if (raw.recordType === 'event_msg' && raw.payloadType === 'item_completed' && raw.parsed?.payload?.item?.type === 'Plan') {
      return {
        sections: withoutSectionTypes(extractPlanSections([raw]), ['raw_json']),
        omitPayloadKeys: [],
      };
    }
    if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.messageText.startsWith('<proposed_plan>')) {
      return {
        sections: withoutSectionTypes(extractPlanSections([raw]), ['raw_json']),
        omitPayloadKeys: [],
      };
    }
    return { sections: [], omitPayloadKeys: [] };
  }

  function sectionIsInspectorSupplement(section) {
    if (!section) return false;
    if (section.type === 'raw_json' || section.type === 'kv' || section.type === 'json') return true;
    if (section.type === 'notice' && /(metadata|status|fields|raw json)$/i.test(section.title || '')) return true;
    return false;
  }

  function splitSectionsForDetail(sections) {
    const timelineSections = [];
    const inspectorSections = [];
    for (const section of sections || []) {
      if (sectionIsInspectorSupplement(section)) inspectorSections.push(section);
      else timelineSections.push(section);
    }
    return { timelineSections, inspectorSections };
  }

  function extractRawSections(raw, relatedEvent, session = {}) {
    const sections = [];
    const primary = rawPrimarySections(raw, relatedEvent, session);
    sections.push(...primary.sections);
    if (!primary.sections.length && raw.messageText) {
      const subtype = classifyProtocolText(raw.messageText, raw.role);
      if (subtype === 'user_shell_command') {
        maybePushCodeSection(sections, 'Message', raw.messageText, 'shell');
      } else {
        maybePushMarkdownSection(sections, 'Message', raw.messageText);
      }
    }
    if (!primary.sections.length && raw.commandText) {
      maybePushCodeSection(sections, 'Command', raw.commandText, inferCommandLanguage(raw.commandText, {}, commandLanguageContext(session)));
      maybePushTerminalSection(sections, 'stdout', raw.stdout, 'stdout');
      maybePushTerminalSection(sections, 'stderr', raw.stderr, 'stderr');
      if (raw.stdout) maybePushStructuredSection(sections, 'stdout (structured)', raw.stdout);
      if (raw.stderr) maybePushStructuredSection(sections, 'stderr (structured)', raw.stderr);
    }
    if (!primary.sections.length && raw.output) {
      maybePushStructuredSection(sections, 'Payload', structuredOutputValue(raw.output));
    }
    const recordFields = withoutKeys(raw.parsed?.payload, primary.omitPayloadKeys);
    maybePushKvSection(sections, 'Record fields', toKvEntries(recordFields, ['type', 'role', 'name', 'call_id', 'status', 'cwd']));
    if (raw.embeddedImages?.length) {
      sections.push(makeNoticeSection('Externalized image payloads', 'This indexed raw view omits embedded image bytes. Open Raw refs to load the original lossless JSONL row.', 'info'));
    }
    sections.push(makeRawJsonSection(raw.embeddedImages?.length ? 'Indexed raw JSON' : 'Raw JSON', raw.parsed));
    return sections;
  }

  function extractLogicalDetailSections(event, raws, session = {}) {
    switch (event.kind) {
      case 'user_message':
      case 'assistant_message':
        return splitSectionsForDetail(extractConversationSections(raws));
      case 'proposed_plan':
      case 'plan_update':
        return splitSectionsForDetail(extractPlanSections(raws));
      case 'reasoning':
        return splitSectionsForDetail(extractReasoningSections(raws));
      case 'command':
        return extractCommandSections(raws, event, session);
      case 'patch':
        return extractPatchSections(raws, event, session);
      case 'js_repl':
        return splitSectionsForDetail(extractJsReplSections(raws, event));
      case 'mcp_call':
        return splitSectionsForDetail(extractToolSections(raws, event));
      case 'other_tool_call':
        if (event.toolName === 'update_plan') return extractUpdatePlanSections(raws, event, splitSectionsForDetail);
        return extractToolOperationSections(raws, event, splitSectionsForDetail);
      case 'web_search':
        return splitSectionsForDetail(extractWebSearchSections(raws, event));
      case 'protocol':
        return splitSectionsForDetail(extractProtocolSections(event, raws));
      case 'usage_limit_warning':
      case 'compaction':
      case 'abort':
      case 'rollback':
      case 'error':
      case 'warning':
      case 'subagent':
      case 'review':
        return splitSectionsForDetail(extractLifecycleSections(event, raws));
      default:
        return { timelineSections: [], inspectorSections: [makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed))] };
    }
  }

  function buildEventDetail(session, eventId, layer = 'main', options = {}) {
    const locale = i18n.resolveLocale(options.locale);
    if (layer === 'raw') {
      const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
      if (!raw) return null;
      const relatedLogical = session.logicalEvents.find((event) => rawMatchesEvent(raw, event));
      const sections = filterDetailSections(extractRawSections(raw, relatedLogical, session));
      for (const section of sections) {
        if (section.type === 'raw_json') section.expanded = true;
      }
      const split = splitSectionsForDetail(sections);
      return {
        id: raw.rawId,
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        sourceKind: CODEX_SOURCE_KIND,
        kind: raw.payloadType || raw.recordType,
        subtype: raw.role || '',
        layer: 'raw',
        title: rawRecordLabel(raw, locale),
        sourceLocator: codexSourceLocator(raw.source),
        sourceRecordType: raw.recordType || '',
        sourceEventType: raw.payloadType || '',
        meta: rawMeta(raw),
        rawRefs: [rawRef(raw)],
        timelineSections: localizeDetailSections(split.timelineSections, locale),
        inspectorSections: localizeDetailSections(split.inspectorSections, locale),
      };
    }

    const logical = session.logicalEvents.find((candidate) => candidate.id === eventId && candidate.layer === layer);
    if (!logical) return null;
    const raws = rawEventsForLogicalEvent(session, logical);
    const detailSections = extractLogicalDetailSections(logical, raws, session);
    if (!detailSections.timelineSections.length && !detailSections.inspectorSections.length) {
      detailSections.inspectorSections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
    }
    const sanitizedDetailSections = sanitizeLogicalDetailSections(detailSections);
    return {
      id: logical.id,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sourceKind: CODEX_SOURCE_KIND,
      kind: sanitizeLogicalEnvelopeValue(logical.kind),
      subtype: sanitizeLogicalEnvelopeValue(logical.subtype),
      layer: sanitizeLogicalEnvelopeValue(logical.layer),
      title: localizedLogicalLabel(logical, locale),
      sourceLocator: logical.sourceLocator,
      meta: logicalMeta(logical),
      rawRefs: logical.rawRefs,
      timelineSections: localizeDetailSections(sanitizedDetailSections.timelineSections, locale),
      inspectorSections: localizeDetailSections(sanitizedDetailSections.inspectorSections, locale),
    };
  }

  return {
    buildEventDetail,
    extractLogicalDetailSections,
    extractRawSections,
    splitSectionsForDetail,
  };
}

module.exports = {
  createCodexDetailBuilder,
};
