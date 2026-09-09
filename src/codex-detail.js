'use strict';

function createCodexDetailBuilder(deps) {
  const {
    envelope,
    sourceTrace,
    localization,
    sectionBuilders,
    sectionExtractors,
    codeMode,
    codeModeTools,
    codeModePresentationContract,
    agentCoordination,
    cacheObservationPresentation,
  } = deps;
  const {
    codeModeAssociableOutputFragments,
    codeModeDisplayOutputText,
    codeModeExecSource,
    projectDeclaredCodeModeCalls,
  } = codeMode;
  const {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalDetailSections,
    sanitizeLogicalEnvelopeValue,
  } = envelope;
  const {
    CODE_MODE_PRESENTATION_VARIANT,
    CODE_MODE_RESULT_ASSOCIATION,
    sanitizeCodeModeDetailPresentationVocabulary,
  } = codeModePresentationContract;
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
    logicalFallbackPayload,
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
    extractLifecycleDetailSections,
    extractLifecycleSections,
    extractMcpSections,
    extractPatchSections,
    extractPlanSections,
    extractProtocolDetailSections,
    extractProtocolSections,
    extractReasoningSections,
    extractToolOperationSections,
    extractToolSections,
    extractUpdatePlanSections,
    extractWebSearchSections,
    inferCommandLanguage,
  } = sectionExtractors;

  const CODE_MODE_COLLAPSED_PREVIEW_ITEM_LIMIT = 2;
  const CODE_MODE_COLLAPSED_PREVIEW_TEXT_LIMIT = 160;
  const CODE_MODE_SOURCE_EXCERPT_SUMMARY_LINE_LIMIT = 2;

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

  function legacyRawSectionIsInspectorSupplement(section) {
    if (!section) return false;
    if (section.type === 'raw_json' || section.type === 'kv' || section.type === 'json') return true;
    if (section.type === 'notice' && /(metadata|status|fields|raw json)$/i.test(section.title || '')) return true;
    return false;
  }

  function splitLegacyRawSectionsForDisplay(sections) {
    const timelineSections = [];
    const inspectorSections = [];
    for (const section of sections || []) {
      if (legacyRawSectionIsInspectorSupplement(section)) inspectorSections.push(section);
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
      case 'developer_message': {
        const sections = extractConversationSections(raws);
        return {
          timelineSections: sections.filter((section) => section.purpose === 'content'),
          inspectorSections: sections.filter((section) => section.purpose === 'fallback'),
        };
      }
      case 'proposed_plan':
      case 'plan_update': {
        const sections = extractPlanSections(raws);
        return {
          timelineSections: sections.filter((section) => section.purpose === 'content'),
          inspectorSections: sections.filter((section) => section.purpose === 'fallback'),
        };
      }
      case 'reasoning':
        return { timelineSections: extractReasoningSections(raws), inspectorSections: [] };
      case 'command':
        return extractCommandSections(raws, event, session);
      case 'patch':
        return extractPatchSections(raws, event, session);
      case 'js_repl':
        return extractJsReplSections(raws, event);
      case 'mcp_call':
        return extractMcpSections(raws, event);
      case 'hook':
        return extractToolOperationSections(raws, event);
      case 'code_mode_operation':
        return extractCodeModeOperationSections(event, raws, session);
      case 'agent_coordination':
      case 'other_tool_call':
        if (event.toolName === 'update_plan') return extractUpdatePlanSections(raws, event);
        return extractToolOperationSections(raws, event);
      case 'web_search':
        return extractWebSearchSections(raws, event);
      case 'goal':
        return extractGoalSections(raws, event);
      case 'user_shell_command':
        return extractProtocolDetailSections(event, raws);
      case 'protocol':
        return extractProtocolDetailSections(event, raws);
      case 'usage_limit_warning':
      case 'compaction':
      case 'abort':
      case 'rollback':
      case 'error':
      case 'warning':
      case 'subagent':
      case 'review':
        return extractLifecycleDetailSections(event, raws);
      default:
        return { timelineSections: [], inspectorSections: [makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback')] };
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
      ...(options.collapsedPreview ? { collapsedPreview: options.collapsedPreview } : {}),
    };
  }

  function conciseCodeModePreviewTextWithMetadata(value, limit = CODE_MODE_COLLAPSED_PREVIEW_TEXT_LIMIT) {
    const sanitized = sanitizeLogicalEnvelopeValue(value == null ? '' : String(value));
    const text = String(sanitized || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length <= limit) return { text, truncated: false };
    return {
      text: `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`,
      truncated: true,
    };
  }

  function conciseCodeModePreviewText(value, limit = CODE_MODE_COLLAPSED_PREVIEW_TEXT_LIMIT) {
    return conciseCodeModePreviewTextWithMetadata(value, limit).text;
  }

  function conciseCodeModeSourcePreviewTextWithMetadata(value, limit = CODE_MODE_COLLAPSED_PREVIEW_TEXT_LIMIT) {
    const source = String(sanitizeLogicalEnvelopeValue(value == null ? '' : String(value)) || '');
    const namespaceElided = source.replace(
      /^(\s*(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*)?(?:await\s+)?)tools\.(?=[A-Za-z_$][\w$]*\s*\()/,
      '$1',
    );
    return conciseCodeModePreviewTextWithMetadata(namespaceElided, limit);
  }

  function conciseCodeModeSourcePreviewText(value, limit = CODE_MODE_COLLAPSED_PREVIEW_TEXT_LIMIT) {
    return conciseCodeModeSourcePreviewTextWithMetadata(value, limit).text;
  }

  function firstCodeModeRequestScalar(value, depth = 0) {
    if (depth > 4 || value == null) return '';
    if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
    if (Array.isArray(value)) {
      return value.map((item) => firstCodeModeRequestScalar(item, depth + 1)).find(Boolean) || '';
    }
    if (typeof value !== 'object') return '';
    const priorityKeys = [
      'command', 'cmd', 'objective', 'status', 'question', 'prompt', 'message', 'path', 'uri',
      'target', 'task_name', 'server', 'plugin', 'plugin_id', 'name', 'detail', 'timeout_ms', 'cursor',
    ];
    for (const key of priorityKeys) {
      if (!Object.hasOwn(value, key)) continue;
      const result = firstCodeModeRequestScalar(value[key], depth + 1);
      if (result) return result;
    }
    return Object.values(value).map((item) => firstCodeModeRequestScalar(item, depth + 1)).find(Boolean) || '';
  }

  function codeModeRequestFieldPreview(requestValue, keys, limit = CODE_MODE_COLLAPSED_PREVIEW_TEXT_LIMIT) {
    if (!requestValue || typeof requestValue !== 'object' || Array.isArray(requestValue)) return '';
    const values = keys.map((key) => {
      const value = requestValue[key];
      if (Array.isArray(value)) {
        return value.slice(0, 2).map((item) => firstCodeModeRequestScalar(item)).filter(Boolean).join(', ');
      }
      return firstCodeModeRequestScalar(value);
    }).filter(Boolean);
    return conciseCodeModePreviewText(values.join(' · '), limit);
  }

  function sanitizeCodeModeRequestField(rawField) {
    const source = String(rawField || 'Request');
    const embeddedDataUrlIndex = source.search(/data:[^,\s"'<>`]*,/i);
    const sanitized = embeddedDataUrlIndex > 0
      ? `${sanitizeLogicalEnvelopeValue(source.slice(0, embeddedDataUrlIndex))}${sanitizeLogicalEnvelopeValue(source.slice(embeddedDataUrlIndex))}`
      : sanitizeLogicalEnvelopeValue(source);
    return String(sanitized || 'Request');
  }

  function codeModeRequestStructureFallback(requestValue, hasRequestArgument) {
    if (requestValue == null && !hasRequestArgument) return null;
    const entries = requestValue === null
      ? [['Request', null]]
      : Array.isArray(requestValue)
      ? [['Request', requestValue]]
      : typeof requestValue === 'object' ? Object.entries(requestValue) : [['Request', requestValue]];
    if (!entries.length) return null;
    const [rawField, value] = entries[0];
    const field = sanitizeCodeModeRequestField(rawField)
      .replace(/[_-]+/g, ' ')
      .replace(/^\w/, (character) => character.toUpperCase());
    let shape = 'structured_value';
    if (Array.isArray(value)) shape = value.length ? 'list' : 'empty_list';
    else if (value === null) shape = 'null_value';
    else if (typeof value === 'object') shape = Object.keys(value).length ? 'object' : 'empty_object';
    else if (value === '') shape = 'empty_value';
    const shapeLabels = {
      empty_list: 'empty list',
      list: 'list',
      null_value: 'null',
      empty_object: 'empty object',
      object: 'object',
      empty_value: 'empty value',
      structured_value: 'structured value',
    };
    return {
      detailKind: 'request_structure',
      detailField: field,
      detailShape: shape,
      detail: `${field}: ${shapeLabels[shape]}`,
    };
  }

  function codeModeProjectionCollapsedPreviewItem(projection, call = {}) {
    const item = { label: String(projection?.title || projection?.toolName || '') };
    const requestSections = Array.isArray(projection?.requestSections) ? projection.requestSections : [];
    const requestValue = call?.requestValue;
    const plan = requestSections.find((section) => section?.type === 'plan_update');
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (steps.length) {
      return {
        ...item,
        detailKind: 'steps',
        detailCount: steps.length,
        detail: conciseCodeModePreviewText(steps[0]?.step, 72),
      };
    }

    const command = requestSections.find((section) => section?.type === 'code' && [
      'Command', 'Patch',
    ].includes(String(section?.title || '')));
    if (command?.code) return { ...item, detail: conciseCodeModePreviewText(command.code) };

    const webRequest = requestSections.find((section) => section?.type === 'web_request');
    const webItem = (webRequest?.groups || [])
      .flatMap((group) => group?.items || [])
      .find((candidate) => String(candidate?.primary || '').trim());
    if (webItem?.primary) return { ...item, detail: conciseCodeModePreviewText(webItem.primary) };

    const patch = requestSections.find((section) => section?.type === 'patch');
    const patchFiles = (patch?.files || []).map((file) => String(file?.file || file?.path || '').trim()).filter(Boolean);
    if (patchFiles.length) return { ...item, detail: conciseCodeModePreviewText(patchFiles.slice(0, 2).join(', ')) };

    const userInput = requestSections.find((section) => section?.type === 'user_input');
    const question = (userInput?.questions || []).find((candidate) => String(candidate?.prompt || candidate?.title || '').trim());
    if (question) {
      return {
        ...item,
        detail: conciseCodeModePreviewText(question.prompt || question.title),
      };
    }

    const toolName = String(projection?.toolName || call?.toolName || '');
    const previewFields = codeModeTools?.codeModeToolDefinition(toolName)?.previewFields || [];
    const detail = codeModeRequestFieldPreview(requestValue, previewFields);
    if (detail) return { ...item, detail };
    const genericDetail = conciseCodeModePreviewText(firstCodeModeRequestScalar(requestValue));
    if (genericDetail) return { ...item, detail: genericDetail };
    const structuralDetail = codeModeRequestStructureFallback(requestValue, call?.hasRequestArgument === true);
    if (structuralDetail) return { ...item, ...structuralDetail };
    return { ...item, detailKind: 'empty_request', detail: 'No arguments' };
  }

  function codeModeDeclaredSequenceCollapsedPreview(projections, calls = []) {
    const allItems = (projections || []).map((projection, index) => (
      codeModeProjectionCollapsedPreviewItem(projection, calls[index])
    ))
      .filter((item) => item.label);
    if (!allItems.length) return null;
    const items = allItems.slice(0, CODE_MODE_COLLAPSED_PREVIEW_ITEM_LIMIT);
    return {
      kind: 'declared_sequence',
      label: 'Declared sequence',
      items,
      omittedCount: Math.max(0, allItems.length - items.length),
    };
  }

  function codeModeSingleRequestCollapsedPreview(projection, call) {
    const item = codeModeProjectionCollapsedPreviewItem(projection, call);
    const text = conciseCodeModePreviewText(item?.detail);
    if (!text) return null;
    return {
      kind: 'request_summary',
      label: 'Request',
      text,
      ...(item.detailKind ? { detailKind: item.detailKind } : {}),
      ...(item.detailCount ? { detailCount: item.detailCount } : {}),
      ...(item.detailField ? { detailField: item.detailField } : {}),
      ...(item.detailShape ? { detailShape: item.detailShape } : {}),
    };
  }

  function codeModeSourceExcerptCollapsedPreview(source) {
    const sanitizedSource = String(sanitizeLogicalEnvelopeValue(String(source || '')) || '');
    let firstNonempty = null;
    let fallbackSecondary = null;
    let firstToolLine = null;
    let firstAfterTool = null;
    let nextToolLine = null;
    let nonemptyCount = 0;
    let nextToolIndex = sanitizedSource.indexOf('tools.');

    const considerLine = (lineStart, lineEnd) => {
      while (lineStart < lineEnd && /\s/.test(sanitizedSource[lineStart])) lineStart += 1;
      while (lineEnd > lineStart && /\s/.test(sanitizedSource[lineEnd - 1])) lineEnd -= 1;
      if (lineStart >= lineEnd) return;
      nonemptyCount = Math.min(3, nonemptyCount + 1);
      while (nextToolIndex >= 0 && nextToolIndex < lineStart) {
        nextToolIndex = sanitizedSource.indexOf('tools.', nextToolIndex + 'tools.'.length);
      }
      const candidate = { start: lineStart, end: lineEnd };
      const hasTool = nextToolIndex >= lineStart && nextToolIndex < lineEnd;
      if (!firstNonempty) firstNonempty = candidate;
      else if (!fallbackSecondary) fallbackSecondary = candidate;
      if (!firstToolLine && hasTool) {
        firstToolLine = candidate;
        firstAfterTool = null;
        nextToolLine = null;
      } else if (firstToolLine) {
        if (!firstAfterTool) firstAfterTool = candidate;
        if (!nextToolLine && hasTool) nextToolLine = candidate;
      }
    };

    let lineStart = 0;
    for (let cursor = 0; cursor <= sanitizedSource.length; cursor += 1) {
      const code = sanitizedSource.charCodeAt(cursor);
      const lineTerminator = cursor === sanitizedSource.length
        || code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
      if (!lineTerminator) continue;
      considerLine(lineStart, cursor);
      if (code === 0x0d && sanitizedSource.charCodeAt(cursor + 1) === 0x0a) cursor += 1;
      lineStart = cursor + 1;
    }
    if (!firstNonempty) return null;

    const primary = firstToolLine || firstNonempty;
    const secondary = firstToolLine ? (nextToolLine || firstAfterTool) : fallbackSecondary;
    const selectedCandidates = [primary, secondary]
      .filter(Boolean)
      .slice(0, CODE_MODE_SOURCE_EXCERPT_SUMMARY_LINE_LIMIT);
    const selectedLines = selectedCandidates.map((candidate) => {
      const sourceText = sanitizedSource.slice(candidate.start, candidate.end);
      return { sourceText, ...conciseCodeModeSourcePreviewTextWithMetadata(sourceText) };
    });
    const summaryLines = selectedLines.map((line) => line.text);
    const hasMoreSource = nonemptyCount > selectedLines.length || selectedLines.some((line) => line.truncated);
    const text = summaryLines[0] || '';
    return text
      ? {
        kind: 'source_excerpt',
        label: 'Source excerpt',
        text,
        summaryLines,
        hasMoreSource,
      }
      : null;
  }

  function sanitizeCodeModeCollapsedPreview(preview) {
    if (!preview || typeof preview !== 'object') return null;
    if (preview.kind === 'declared_sequence') {
      const items = (Array.isArray(preview.items) ? preview.items : [])
        .slice(0, CODE_MODE_COLLAPSED_PREVIEW_ITEM_LIMIT)
        .map((item) => {
          const label = conciseCodeModePreviewText(item?.label, 100);
          if (!label) return null;
          const detailKind = ['steps', 'empty_request', 'request_structure'].includes(item?.detailKind) ? item.detailKind : '';
          const detailCount = Number.isFinite(Number(item?.detailCount))
            ? Math.max(0, Math.trunc(Number(item.detailCount)))
            : 0;
          const detail = conciseCodeModePreviewText(item?.detail, 96);
          return {
            label,
            ...(detail ? { detail } : {}),
            ...(detailKind ? { detailKind } : {}),
            ...(detailKind === 'steps' && detailCount ? { detailCount } : {}),
            ...(detailKind === 'request_structure' && item?.detailField
              ? { detailField: conciseCodeModePreviewText(item.detailField, 60) }
              : {}),
            ...(detailKind === 'request_structure' && [
              'empty_list', 'list', 'null_value', 'empty_object', 'object', 'empty_value', 'structured_value',
            ].includes(item?.detailShape) ? { detailShape: item.detailShape } : {}),
          };
        })
        .filter(Boolean);
      if (!items.length) return null;
      return {
        kind: 'declared_sequence',
        label: conciseCodeModePreviewText(preview.label || 'Declared sequence', 100),
        items,
        omittedCount: Number.isFinite(Number(preview.omittedCount))
          ? Math.max(0, Math.trunc(Number(preview.omittedCount)))
          : 0,
      };
    }
    if (preview.kind === 'source_excerpt') {
      const text = conciseCodeModeSourcePreviewText(preview.text);
      if (!text) return null;
      const summaryLines = (Array.isArray(preview.summaryLines) ? preview.summaryLines : [])
        .slice(0, CODE_MODE_SOURCE_EXCERPT_SUMMARY_LINE_LIMIT)
        .map((line) => conciseCodeModeSourcePreviewText(line))
        .filter(Boolean);
      return {
        kind: 'source_excerpt',
        label: conciseCodeModePreviewText(preview.label || 'Source excerpt', 100),
        text,
        ...(summaryLines.length ? { summaryLines } : {}),
        hasMoreSource: preview.hasMoreSource === true,
      };
    }
    if (preview.kind === 'request_summary') {
      const text = conciseCodeModePreviewText(preview.text);
      if (!text) return null;
      const detailKind = ['steps', 'empty_request', 'request_structure'].includes(preview.detailKind) ? preview.detailKind : '';
      const detailCount = Number.isFinite(Number(preview.detailCount))
        ? Math.max(0, Math.trunc(Number(preview.detailCount)))
        : 0;
      return {
        kind: 'request_summary',
        label: conciseCodeModePreviewText(preview.label || 'Request', 100),
        text,
        ...(detailKind ? { detailKind } : {}),
        ...(detailKind === 'steps' && detailCount ? { detailCount } : {}),
        ...(detailKind === 'request_structure' && preview.detailField
          ? { detailField: conciseCodeModePreviewText(preview.detailField, 60) }
          : {}),
        ...(detailKind === 'request_structure' && [
          'empty_list', 'list', 'null_value', 'empty_object', 'object', 'empty_value', 'structured_value',
        ].includes(preview.detailShape) ? { detailShape: preview.detailShape } : {}),
      };
    }
    return null;
  }

  function sanitizeCodeModePresentation(presentation) {
    const vocabulary = sanitizeCodeModeDetailPresentationVocabulary(presentation);
    if (!vocabulary) return null;
    const collapsedPreview = sanitizeCodeModeCollapsedPreview(presentation.collapsedPreview);
    return {
      variant: vocabulary.variant,
      label: sanitizeLogicalEnvelopeValue(presentation.label),
      toolName: sanitizeLogicalEnvelopeValue(presentation.toolName),
      declaredToolCount: Number.isFinite(presentation.declaredToolCount)
        ? Math.max(0, Math.trunc(presentation.declaredToolCount))
        : 0,
      requestEvidence: vocabulary.requestEvidence,
      resultAssociation: vocabulary.resultAssociation,
      hasUnassociatedOutput: presentation.hasUnassociatedOutput === true,
      ...(collapsedPreview ? { collapsedPreview } : {}),
    };
  }

  function localizeCodeModeCollapsedPreview(preview, locale) {
    if (!preview) return null;
    const localizedRequestDetail = (item, fallback) => {
      if (item.detailKind === 'empty_request') return i18n.t(locale, 'ui', 'codeModeNoArguments');
      if (item.detailKind !== 'request_structure' || !item.detailField || !item.detailShape) return fallback;
      const shapeKey = {
        empty_list: 'codeModeEmptyList',
        list: 'codeModeList',
        null_value: 'codeModeNullValue',
        empty_object: 'codeModeEmptyObject',
        object: 'codeModeObject',
        empty_value: 'codeModeEmptyValue',
        structured_value: 'codeModeStructuredValue',
      }[item.detailShape];
      const field = i18n.sectionTitle(item.detailField, locale);
      const shape = i18n.t(locale, 'ui', shapeKey);
      return i18n.t(locale, 'ui', 'codeModeRequestStructure', { field, shape });
    };
    if (preview.kind === 'declared_sequence') {
      return {
        ...preview,
        label: i18n.t(locale, 'ui', 'codeModeDeclaredSequence') || preview.label,
        items: preview.items.map((item) => {
          const stepCount = item.detailKind === 'steps' && item.detailCount
            ? i18n.t(
              locale,
              'ui',
              item.detailCount === 1 ? 'codeModeStepCountOne' : 'codeModeStepCount',
              { count: item.detailCount },
            )
            : '';
          const requestDetail = localizedRequestDetail(item, item.detail);
          const detail = [stepCount, requestDetail].filter(Boolean).join(' · ');
          return {
            ...item,
            label: i18n.sectionTitle(item.label, locale),
            ...(detail ? { detail } : {}),
          };
        }),
      };
    }
    if (preview.kind === 'source_excerpt') {
      return {
        ...preview,
        label: i18n.t(locale, 'ui', 'codeModeSourceExcerpt') || preview.label,
      };
    }
    if (preview.kind === 'request_summary') {
      const detail = localizedRequestDetail(preview, preview.text);
      const stepCount = preview.detailKind === 'steps' && preview.detailCount
        ? i18n.t(
          locale,
          'ui',
          preview.detailCount === 1 ? 'codeModeStepCountOne' : 'codeModeStepCount',
          { count: preview.detailCount },
        )
        : '';
      return {
        ...preview,
        label: i18n.t(locale, 'ui', 'codeModeRequestSummary') || preview.label,
        text: [stepCount, detail].filter(Boolean).join(' · '),
      };
    }
    return null;
  }

  function localizeCodeModePresentation(presentation, locale) {
    if (!presentation) return null;
    const collapsedPreview = localizeCodeModeCollapsedPreview(presentation.collapsedPreview, locale);
    return {
      ...presentation,
      label: i18n.sectionTitle(presentation.label, locale),
      ...(collapsedPreview ? { collapsedPreview } : {}),
    };
  }

  function codeModeProjectionEvidenceSection(projection, declaredToolCount) {
    const entries = [
      {
        key: 'Presentation',
        value: declaredToolCount === 1
          ? CODE_MODE_PRESENTATION_VARIANT.SINGLE_TOOL
          : CODE_MODE_PRESENTATION_VARIANT.MULTI_TOOL,
      },
      { key: declaredToolCount === 1 ? 'Declared tool' : 'Declared requests', value: declaredToolCount === 1 ? projection.toolName : String(declaredToolCount) },
      { key: 'Request evidence', value: projection.requestEvidence },
      { key: 'Result association', value: projection.resultAssociation },
      ...(projection.resultAssociation === CODE_MODE_RESULT_ASSOCIATION.NONE
        ? [{ key: 'Result association note', value: 'No result output matched the supported shape' }]
        : []),
    ].filter((entry) => entry.value !== '');
    return { purpose: 'traceability', type: 'kv', title: 'Projection evidence', entries };
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
      purpose: 'context',
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
    const execSource = codeModeExecSource(event, rawById);

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

    let presentation = codeModePresentationDescriptor(CODE_MODE_PRESENTATION_VARIANT.RAW_CODE_MODE, {
      label: 'Scripted operation',
      toolName: 'exec',
      collapsedPreview: codeModeSourceExcerptCollapsedPreview(execSource),
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
          purpose: 'context',
          type: 'code_mode_source',
          title: 'Code Mode source',
          code: execSource,
          language: 'javascript',
        },
      );
      presentation = codeModePresentationDescriptor(CODE_MODE_PRESENTATION_VARIANT.SINGLE_TOOL, {
        label: singleProjection.title,
        toolName: singleProjection.toolName,
        declaredToolCount: 1,
        requestEvidence: singleProjection.requestEvidence,
        resultAssociation: singleProjection.resultAssociation,
        hasUnassociatedOutput,
        collapsedPreview: codeModeSingleRequestCollapsedPreview(singleProjection, declaredProjection.calls[0]),
      });
    } else if (projections.length > 1) {
      timelineSections.push(...projections);
      timelineSections.push({
        purpose: 'context',
        type: 'code_mode_source',
        title: 'Code Mode source',
        code: execSource,
        language: 'javascript',
      });
      inspectorSections.push(codeModeProjectionEvidenceSection(projections[0], projections.length));
      presentation = codeModePresentationDescriptor(CODE_MODE_PRESENTATION_VARIANT.MULTI_TOOL, {
        label: 'Multiple operations',
        declaredToolCount: projections.length,
        requestEvidence: projections[0].requestEvidence,
        resultAssociation: projections[0].resultAssociation,
        hasUnassociatedOutput,
        collapsedPreview: codeModeDeclaredSequenceCollapsedPreview(projections, declaredProjection.calls),
      });
    } else {
      maybePushCodeSection(timelineSections, 'Command', execSource, 'javascript', 'request');
      if (timelineSections.at(-1)?.type === 'code') timelineSections.at(-1).role = 'command';
    }

    if (hasUnassociatedOutput) {
      maybePushTerminalSection(
        timelineSections,
        singleProjection ? 'Operation output' : 'Final output',
        finalObservedOutput.text,
        'stdout',
        '',
        'result',
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
      const traceSection = { purpose: 'traceability', type: 'code_mode_trace', title: 'Execution trace', phases: tracePhases };
      inspectorSections.push(traceSection);
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
    return items.length ? { purpose: 'traceability', type: 'event_refs', title: 'Observed nested activity', items } : null;
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
      const split = splitLegacyRawSectionsForDisplay(sections);
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
    if (logical.cacheObservation) {
      const cacheSections = cacheObservationPresentation.cacheObservationDetailSections(
        logical.cacheObservation,
        { locale },
      );
      detailSections.timelineSections.unshift(...cacheSections.timelineSections);
      detailSections.inspectorSections.unshift(...cacheSections.inspectorSections);
    }
    const eventRefsSection = logical.kind === 'code_mode_operation'
      ? codeModeEventRefsSection(logical, session, locale)
      : null;
    if (eventRefsSection) detailSections.inspectorSections.push(eventRefsSection);
    if (!detailSections.timelineSections.length && !detailSections.inspectorSections.length) {
      detailSections.inspectorSections.push(makeRawJsonSection('Unmodeled fields', logicalFallbackPayload(raws), false, 'fallback'));
    }
    const sanitizedDetailSections = sanitizeLogicalDetailSections(detailSections);
    const presentation = logical.kind === 'code_mode_operation'
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
  };
}

module.exports = {
  createCodexDetailBuilder,
};
