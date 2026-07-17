'use strict';

function createCodexDetailBuilder(deps) {
  const {
    envelope,
    sourceTrace,
    localization,
    sectionBuilders,
    sectionExtractors,
    codeMode,
  } = deps;
  const {
    codeModeAssociableOutputFragments,
    codeModeDisplayOutputText,
    projectDeclaredCodeModeCalls,
  } = codeMode;
  const {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalDetailSections,
    sanitizeLogicalEnvelopeValue,
  } = envelope;
  const {
    classifyProtocolText,
    codexSourceLocator,
    commandLanguageContext,
    logicalMeta,
    rawConversationRole,
    rawEventsForLogicalEvent,
    rawMatchesEvent,
    rawMeta,
    rawRef,
    rawToolSections,
  } = sourceTrace;
  const {
    i18n,
    localizeDetailSections,
    localizedLogicalLabel,
    rawRecordLabel,
  } = localization;
  const {
    filterDetailSections,
    makeNoticeSection,
    makeRawJsonSection,
    maybePushCodeSection,
    maybePushKvSection,
    maybePushMarkdownSection,
    maybePushStructuredSection,
    maybePushTerminalSection,
    structuredOutputValue,
    toKvEntries,
    withoutKeys,
    withoutSectionTypes,
  } = sectionBuilders;
  const {
    codeModeToolProjectionSection,
    extractCommandSections,
    extractConversationSections,
    extractGoalSections,
    extractJsReplSections,
    extractLifecycleSections,
    extractMcpSections,
    extractPatchSections,
    extractPlanSections,
    extractProtocolSections,
    extractReasoningSections,
    extractToolOperationSections,
    extractToolSections,
    extractUpdatePlanSections,
    extractWebSearchSections,
    inferCommandLanguage,
  } = sectionExtractors;

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
      case 'developer_message':
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
        return extractMcpSections(raws, event, splitSectionsForDetail);
      case 'hook':
        return extractToolOperationSections(raws, event, splitSectionsForDetail);
      case 'other_tool_call':
        if (event.subtype === 'code_mode_operation') return extractCodeModeOperationSections(event, raws, session);
        if (event.toolName === 'update_plan') return extractUpdatePlanSections(raws, event, splitSectionsForDetail);
        return extractToolOperationSections(raws, event, splitSectionsForDetail);
      case 'web_search':
        return splitSectionsForDetail(extractWebSearchSections(raws, event));
      case 'goal':
        return extractGoalSections(raws, event, splitSectionsForDetail);
      case 'user_shell_command':
        return splitSectionsForDetail(extractProtocolSections(event, raws));
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

  function codeModePresentationDescriptor(variant, options = {}) {
    return {
      variant,
      label: String(options.label || 'Code Mode operation'),
      toolName: String(options.toolName || ''),
      declaredToolCount: Math.max(0, Number(options.declaredToolCount || 0)),
      requestEvidence: String(options.requestEvidence || ''),
      resultAssociation: String(options.resultAssociation || ''),
      hasUnassociatedOutput: options.hasUnassociatedOutput === true,
    };
  }

  function sanitizeCodeModePresentation(presentation) {
    if (!presentation || !['single_tool', 'multi_tool', 'raw_code_mode'].includes(presentation.variant)) return null;
    return {
      variant: presentation.variant,
      label: sanitizeLogicalEnvelopeValue(presentation.label),
      toolName: sanitizeLogicalEnvelopeValue(presentation.toolName),
      declaredToolCount: Number.isFinite(presentation.declaredToolCount)
        ? Math.max(0, Math.trunc(presentation.declaredToolCount))
        : 0,
      requestEvidence: ['declared_source', 'observed_lifecycle'].includes(presentation.requestEvidence)
        ? presentation.requestEvidence
        : '',
      resultAssociation: ['exact', 'exact_identity', 'bounded', 'bounded_order', 'none'].includes(presentation.resultAssociation)
        ? presentation.resultAssociation
        : '',
      hasUnassociatedOutput: presentation.hasUnassociatedOutput === true,
    };
  }

  function localizeCodeModePresentation(presentation, locale) {
    if (!presentation) return null;
    return {
      ...presentation,
      label: i18n.sectionTitle(presentation.label, locale),
    };
  }

  function codeModeProjectionEvidenceSection(projection, declaredToolCount) {
    const entries = [
      { key: 'Presentation', value: declaredToolCount === 1 ? 'single_tool' : 'multi_tool' },
      { key: declaredToolCount === 1 ? 'Declared tool' : 'Declared requests', value: declaredToolCount === 1 ? projection.toolName : String(declaredToolCount) },
      { key: 'Request evidence', value: projection.requestEvidence },
      { key: 'Result association', value: projection.resultAssociation },
    ].filter((entry) => entry.value !== '');
    return { type: 'kv', title: 'Projection evidence', entries };
  }

  function splitSingleCodeModeProjection(projection) {
    const requestSections = Array.isArray(projection.requestSections) ? projection.requestSections : [];
    const resultSections = Array.isArray(projection.resultSections) ? projection.resultSections : [];
    if (projection.toolName === 'web__run') {
      const associatedResultSections = resultSections.filter((section) => section.type === 'code_mode_source');
      return {
        timelineSections: [
          ...requestSections,
          ...resultSections.filter((section) => !associatedResultSections.includes(section)),
        ],
        inspectorSections: associatedResultSections,
      };
    }
    if (!['shell_command', 'exec_command'].includes(projection.toolName)) {
      return { timelineSections: [...requestSections, ...resultSections], inspectorSections: [] };
    }

    const commandSections = requestSections.filter((section) => section.type === 'code' && String(section.title || '').toLowerCase() === 'command');
    const requestSupplements = requestSections.filter((section) => !commandSections.includes(section));
    const terminalSections = resultSections.filter((section) => section.type === 'terminal');
    const associatedResultSections = resultSections.filter((section) => section.type === 'code_mode_source');
    const resultSupplements = resultSections.filter((section) => !terminalSections.includes(section) && !associatedResultSections.includes(section));
    return {
      timelineSections: [...commandSections, ...terminalSections, ...associatedResultSections],
      inspectorSections: [...requestSupplements, ...resultSupplements],
    };
  }

  function extractCodeModeOperationSections(event, raws, session = {}) {
    const operation = event.codeModeOperation || {};
    const rawById = new Map(raws.map((raw) => [raw.rawId, raw]));
    const phases = Array.isArray(operation.phases) ? operation.phases : [];
    const pollCount = phases.filter((phase) => phase.kind === 'wait').length;
    const timelineSections = [];
    const inspectorSections = [{
      type: 'kv',
      title: 'Operation metadata',
      entries: [
        { key: 'Evidence', value: String(operation.evidenceState || '') },
        { key: 'Observation', value: String(operation.observationState || '') },
        { key: 'Cell', value: String(operation.cellId || '') },
        { key: 'Poll count', value: String(pollCount) },
      ].filter((entry) => entry.value !== ''),
    }];

    const execPhase = phases.find((phase) => phase.kind === 'exec');
    const execRaw = rawById.get(execPhase?.callRef?.rawId);
    const execSource = String(execRaw?.parsed?.payload?.input || execRaw?.output || '');

    const observedOutputs = phases.map((phase) => {
      const outputRaw = rawById.get(phase.outputRef?.rawId);
      return outputRaw ? { phase, raw: outputRaw, text: codeModeDisplayOutputText(outputRaw) } : null;
    }).filter((item) => item?.text);
    const finalObservedOutput = observedOutputs.at(-1);
    const associableFragments = phases.length === 1
      && execPhase?.observationState === 'terminal'
      && finalObservedOutput?.phase === execPhase
      ? codeModeAssociableOutputFragments(finalObservedOutput.raw)
      : [];
    const declaredProjection = projectDeclaredCodeModeCalls(execSource, {
      outputFragments: associableFragments,
    });
    const hasUnassociatedOutput = Boolean(finalObservedOutput && !declaredProjection.hasCompleteOutputAssociation);

    let presentation = codeModePresentationDescriptor('raw_code_mode', {
      label: 'Code Mode operation',
      toolName: 'exec',
    });
    const projections = declaredProjection.supported
      ? declaredProjection.calls.map((call) => codeModeToolProjectionSection(call, session))
      : [];
    const singleProjection = projections.length === 1 ? projections[0] : null;

    if (singleProjection) {
      const split = splitSingleCodeModeProjection(singleProjection);
      timelineSections.push(...split.timelineSections);
      inspectorSections.push(
        codeModeProjectionEvidenceSection(singleProjection, 1),
        ...split.inspectorSections,
        {
          type: 'code_mode_source',
          title: 'Code Mode source',
          code: execSource,
          language: 'javascript',
        },
      );
      presentation = codeModePresentationDescriptor('single_tool', {
        label: singleProjection.title,
        toolName: singleProjection.toolName,
        declaredToolCount: 1,
        requestEvidence: singleProjection.requestEvidence,
        resultAssociation: singleProjection.resultAssociation,
        hasUnassociatedOutput,
      });
    } else if (projections.length > 1) {
      timelineSections.push(...projections);
      timelineSections.push({
        type: 'code_mode_source',
        title: 'Code Mode source',
        code: execSource,
        language: 'javascript',
      });
      inspectorSections.push(codeModeProjectionEvidenceSection(projections[0], projections.length));
      presentation = codeModePresentationDescriptor('multi_tool', {
        label: 'Multi-tool Code Mode operation',
        declaredToolCount: projections.length,
        requestEvidence: projections[0].requestEvidence,
        resultAssociation: projections[0].resultAssociation,
        hasUnassociatedOutput,
      });
    } else {
      maybePushCodeSection(timelineSections, 'Command', execSource, 'javascript');
      if (timelineSections.at(-1)?.type === 'code') timelineSections.at(-1).role = 'command';
    }

    if (hasUnassociatedOutput) {
      maybePushTerminalSection(
        timelineSections,
        singleProjection ? 'Unassociated operation output' : 'Final output',
        finalObservedOutput.text,
        'stdout',
      );
    }

    const tracePhases = [];
    let pollIndex = 0;
    for (const phase of phases) {
      const outputRaw = rawById.get(phase.outputRef?.rawId);
      if (phase.kind === 'wait') pollIndex += 1;
      tracePhases.push({
        kind: phase.kind,
        poll: phase.kind === 'wait' ? pollIndex : 0,
        entries: [
          { key: 'Call', value: String(phase.callId || '') },
          { key: 'Evidence', value: String(phase.evidenceState || '') },
          { key: 'Observation', value: String(phase.observationState || '') },
          { key: 'Cell', value: String(phase.targetCellId || operation.cellId || '') },
        ].filter((entry) => entry.value !== ''),
        output: outputRaw && outputRaw.rawId !== finalObservedOutput?.phase.outputRef?.rawId
          ? codeModeDisplayOutputText(outputRaw)
          : '',
      });
    }
    if (pollCount > 0) {
      const traceSection = { type: 'code_mode_trace', title: 'Execution trace', phases: tracePhases };
      if (singleProjection) inspectorSections.push(traceSection);
      else timelineSections.push(traceSection);
    }
    return { timelineSections, inspectorSections, presentation };
  }

  function codeModeEventRefsSection(event, session, locale) {
    const ids = event.codeModeOperation?.eventRefs || [];
    const items = ids.map((id) => {
      const target = session.logicalEvents.find((candidate) => candidate.id === id);
      if (!target) return null;
      return {
        id: target.id,
        label: localizedLogicalLabel(target, locale),
        kind: target.kind,
        status: target.status,
      };
    }).filter(Boolean);
    return items.length ? { type: 'event_refs', title: 'Observed nested activity', items } : null;
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
    const eventRefsSection = logical.subtype === 'code_mode_operation'
      ? codeModeEventRefsSection(logical, session, locale)
      : null;
    if (eventRefsSection) detailSections.inspectorSections.push(eventRefsSection);
    if (!detailSections.timelineSections.length && !detailSections.inspectorSections.length) {
      detailSections.inspectorSections.push(makeRawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)));
    }
    const sanitizedDetailSections = sanitizeLogicalDetailSections(detailSections);
    const presentation = logical.subtype === 'code_mode_operation'
      ? localizeCodeModePresentation(sanitizeCodeModePresentation(detailSections.presentation), locale)
      : null;
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
      ...(presentation ? { presentation } : {}),
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
