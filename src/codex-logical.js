'use strict';

function hasExternalizedImage(value) {
  return typeof value === 'string' && value.includes('[embedded image payload externalized; open raw refs for source]');
}

function createCodexLogicalBuilder(deps) {
  const {
    semanticRawEvents = (raws) => raws,
    scopedRequestPeer,
    toolPeersInTurn,
    collaborationThreadId,
    legacyMcpStatus,
    matchesToolOutput,
    dynamicToolPeer,
    resolvedSubAgentStartup = () => null,
    turnBoundaryEpochs = () => new Map(),
    historyFacts = () => null,
    realtimeIdentity = () => '',
    externalToolInputFromRaw,
    externalToolInputMirrorsMatch,
    asyncAgentMessageFromRaw,
    asyncMessageMetadata,
    asyncMessageIdentityMatches,
    asyncMessageSearchText,
    summarizeCodexAttachments,
  } = deps.messages;
  const {
    envelope,
    goal,
    protocol,
    tool,
    text,
    usage,
    codeMode,
    agentCoordination,
    reviewLifecycle,
  } = deps;
  const {
    reviewLifecycleFromRaw,
  } = reviewLifecycle;
  const {
    deriveCodeModeFacts,
    projectCodeModeOperations,
  } = codeMode;
  const {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalEnvelopeValue,
    rawRef,
    subAgentActivityEventId,
  } = envelope;
  const {
    goalResponseFromValue,
    goalSnapshotFromGoal,
    goalSnapshotFromRaw,
    goalSnapshotSignature,
    goalSnapshotTransition,
    normalizeGoalStatus,
  } = goal;
  const {
    classifyProtocolText,
    humanizeProtocolSubtype,
    parseRolloutArtifactIdentity = () => null,
    protocolLabelFor,
    protocolPreviewFor,
  } = protocol;
  const {
    TOOL_LIFECYCLE_EVENT_TYPES,
    TOOL_LIFECYCLE_FAMILY,
    commandArgsFromRaw,
    nativeExecCommandArguments = () => null,
    commandToText,
    inferPatchSuccess,
    isFiniteNumberValue,
    numericExitCode,
    parseFormattedCommandOutput,
    parseOutputEnvelope,
    patchFilesFromPatchInput,
    touchFilesFromOutputText,
    isToolLifecycleCallGroupType,
    isToolLifecycleFamily,
    isToolLifecycleStandaloneType,
    toolLifecycleRepresentativeRank,
  } = tool;
  const CODE_MODE_ASSOCIATION_EVENT_TYPES = new Set([
    ...TOOL_LIFECYCLE_EVENT_TYPES,
    'web_search_end',
  ]);
  const {
    displayValue,
    codexFullSearchText = displayValue,
    codexSearchValue = displayValue,
    codexAsyncMessageText = () => '',
    codexAsyncSearchText = () => '',
    firstNonEmpty,
    planUpdateText,
    relatedReasoning,
    truncate,
    uniqueNonEmpty,
  } = text;
  const {
    tokenUsageItems,
    collectUsageLimitItems,
    rateLimitReachedType,
  } = usage;

  const GOAL_TOOL_NAMES = new Set(['create_goal', 'get_goal', 'update_goal']);
  const {
    AGENT_COORDINATION_KIND,
    isAgentCoordinationTool,
  } = agentCoordination;
  const TOOL_RESPONSE_ITEM_TYPES = new Set([
    'function_call',
    'function_call_output',
    'custom_tool_call',
    'custom_tool_call_output',
    'image_generation_call',
  ]);

  function createLogicalEvent(fields) {
    const preview = sanitizeLogicalEnvelopeValue(fields.preview || '');
    const searchText = sanitizeLogicalEnvelopeValue(fields.searchText || '').trim();
    const rawRefs = fields.rawRefs || [];
    return {
      id: fields.id,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sourceKind: CODEX_SOURCE_KIND,
      timestamp: sanitizeLogicalEnvelopeValue(fields.timestamp || ''),
      turnId: sanitizeLogicalEnvelopeValue(fields.turnId || ''),
      kind: sanitizeLogicalEnvelopeValue(fields.kind || 'event'),
      subtype: sanitizeLogicalEnvelopeValue(fields.subtype || ''),
      layer: sanitizeLogicalEnvelopeValue(fields.layer || 'main'),
      role: sanitizeLogicalEnvelopeValue(fields.role || ''),
      label: sanitizeLogicalEnvelopeValue(fields.label || fields.kind || 'event'),
      preview,
      searchText,
      severity: sanitizeLogicalEnvelopeValue(fields.severity || 'normal'),
      status: sanitizeLogicalEnvelopeValue(fields.status || ''),
      toolName: sanitizeLogicalEnvelopeValue(fields.toolName || ''),
      hasLongOutput: preview.length > 800 || searchText.length > 1600,
      hasReadableReasoning: Boolean(fields.hasReadableReasoning),
      touchedFiles: sanitizeLogicalEnvelopeValue(fields.touchedFiles || []),
      outputStats: sanitizeLogicalEnvelopeValue(fields.outputStats || {}),
      tokenUsage: sanitizeLogicalEnvelopeValue(fields.tokenUsage || []),
      usageLimits: sanitizeLogicalEnvelopeValue(fields.usageLimits || []),
      rawRefs,
      channels: sanitizeLogicalEnvelopeValue(fields.channels || []),
      tags: sanitizeLogicalEnvelopeValue(fields.tags || []),
      source: rawRefs[0] || fields.source,
      sourceLocator: rawRefs[0]?.sourceLocator || fields.sourceLocator || null,
    };
  }

  function toolLifecycleRank(raw) {
    return toolLifecycleRepresentativeRank(raw?.payloadType);
  }

  function representativeToolLifecycleRow(rows) {
    let best = null;
    for (const row of rows) {
      if (!best) {
        best = row;
        continue;
      }
      const rank = toolLifecycleRank(row);
      const bestRank = toolLifecycleRank(best);
      if (rank > bestRank || (rank === bestRank && row.line > best.line)) best = row;
    }
    return best;
  }

  function groupedToolLifecycleLabel(row, fallback) {
    if (row?.toolName === 'image_generation'
        || isToolLifecycleFamily(row?.payloadType, TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION)) {
      return 'Image Generation';
    }
    return humanizeProtocolSubtype(row?.payloadType || fallback || 'Other tool call');
  }

  function isHookLifecycleRow(raw) {
    return raw?.recordType === 'event_msg'
      && isToolLifecycleFamily(raw.payloadType, TOOL_LIFECYCLE_FAMILY.HOOK);
  }

  function toolLifecycleRowsForFamily(group, family) {
    return group.filter((raw) => raw.recordType === 'event_msg'
      && isToolLifecycleFamily(raw.payloadType, family));
  }

  function isToolResponseItemRow(raw) {
    return raw?.recordType === 'response_item'
      && TOOL_RESPONSE_ITEM_TYPES.has(raw.payloadType);
  }

  function isToolOutcomeRow(raw) {
    return isToolResponseItemRow(raw)
      || (raw?.recordType === 'event_msg'
        && isToolLifecycleCallGroupType(raw.payloadType));
  }

  function hookNameFromRow(row) {
    const payload = row?.parsed?.payload || {};
    return String(firstNonEmpty(
      payload.hook,
      payload.hook_name,
      payload.name,
      payload.hookName,
      row?.toolName,
      'Hook',
    ) || 'Hook');
  }

  function hookStatusFromRows(rows) {
    const terminal = representativeToolLifecycleRow(rows) || rows[0];
    const type = String(terminal?.payloadType || '');
    const explicit = String(terminal?.status || terminal?.parsed?.payload?.status || '').toLowerCase();
    if (explicit === 'declined' || /_declined$/.test(type)) return 'declined';
    if (explicit === 'failed' || explicit === 'error') return 'failed';
    if (explicit === 'completed' || explicit === 'complete' || explicit === 'success' || explicit === 'succeeded') return 'completed';
    if (/_completed$|_end$/.test(type)) return 'completed';
    return 'incomplete';
  }

  function buildHookLogicalEvent(idSuffix, rows) {
    const group = rows.slice().sort((a, b) => a.line - b.line);
    const first = group[0];
    const representative = representativeToolLifecycleRow(group) || first;
    const hookName = hookNameFromRow(group.find((row) => hookNameFromRow(row) !== 'Hook') || representative);
    const status = hookStatusFromRows(group);
    const severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
    const preview = truncate(firstNonEmpty(
      representative.preview,
      group.find((raw) => raw.preview)?.preview,
      group.map((raw) => raw.searchText).filter(Boolean).join('\n'),
      hookName,
    ));
    return createLogicalEvent({
      id: `${first.sessionId}:logical:hook:${idSuffix}`,
      timestamp: first.timestamp,
      turnId: group.find((raw) => raw.turnId)?.turnId || '',
      kind: 'hook',
      subtype: representative.payloadType || 'hook',
      layer: 'main',
      role: 'system',
      label: hookName,
      preview,
      searchText: uniqueNonEmpty([hookName, status, ...group.map((raw) => raw.searchText)]).join('\n'),
      severity,
      status,
      toolName: hookName,
      rawRefs: group.map(rawRef),
      channels: [...new Set(group.map((raw) => raw.recordType))],
    });
  }

  function parseToolJsonValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }

  function goalOutputFromRaw(raw) {
    const parsed = parseToolJsonValue(raw?.output);
    return parsed && typeof parsed === 'object' ? parsed : null;
  }

  function goalStatusFrom(toolName, requestSnapshot, responseValue, responseSnapshot) {
    return normalizeGoalStatus(firstNonEmpty(
      responseSnapshot?.status,
      responseValue?.status,
      requestSnapshot?.status,
      toolName === 'create_goal' ? 'active' : '',
    ));
  }

  function goalLabelFor(toolName, status) {
    if (toolName === 'create_goal') return 'Goal created';
    if (toolName === 'get_goal') return 'Goal status';
    if (status === 'complete') return 'Goal complete';
    if (status === 'blocked') return 'Goal blocked';
    if (status === 'budget_limited') return 'Goal budget limited';
    if (status === 'usage_limited') return 'Goal usage limited';
    return 'Goal updated';
  }

  function goalSeverity(status) {
    return ['blocked', 'incomplete', 'budget_limited', 'usage_limited'].includes(status)
      ? 'warning'
      : 'normal';
  }

  function goalPreviewStatus(status) {
    return String(status || '').replace(/_/g, ' ');
  }

  function goalPreviewParts(snapshot, options = {}) {
    const objective = displayValue(snapshot?.objective, 4000).trim();
    const usageParts = [];
    if (options.includeBudget || snapshot?.hasTokenBudget) {
      const budget = snapshot?.tokenBudget == null || snapshot.tokenBudget === ''
        ? 'unbounded'
        : displayValue(snapshot.tokenBudget, 1000).trim();
      usageParts.push(`budget: ${budget}`);
    }
    if (snapshot?.tokensUsed != null) usageParts.push(`tokens: ${snapshot.tokensUsed}`);
    if (snapshot?.timeUsedSeconds != null) usageParts.push(`time: ${snapshot.timeUsedSeconds}s`);
    return [
      goalPreviewStatus(snapshot?.status),
      usageParts.join(', '),
      objective,
    ].filter(Boolean);
  }

  function goalToolState(group, toolName, functionCall, functionOutput) {
    const first = group[0];
    const completed = Boolean(functionOutput);
    const requestValue = parseToolJsonValue(functionCall?.output) || {};
    const responseValue = goalOutputFromRaw(functionOutput) || {};
    const response = goalResponseFromValue(responseValue, {
      threadId: firstNonEmpty(responseValue.threadId, responseValue.thread_id),
      sessionId: first.sessionId,
    });
    const requestSnapshot = goalSnapshotFromGoal(requestValue, { sessionId: first.sessionId });
    const responseSnapshot = response.snapshot;
    const objective = firstNonEmpty(responseSnapshot?.objective, requestSnapshot?.objective);
    const status = completed ? goalStatusFrom(toolName, requestSnapshot, responseValue, responseSnapshot) : 'incomplete';
    const snapshot = responseSnapshot
      ? goalSnapshotFromGoal({
        ...responseSnapshot.goal,
        objective,
        status,
      }, {
        threadId: responseSnapshot.threadId,
        sessionId: first.sessionId,
      })
      : null;
    return {
      completed,
      objective,
      requestSnapshot,
      response,
      snapshot,
      status,
    };
  }

  function buildGoalLogicalEvent(callId, group, toolName, functionCall, functionOutput) {
    const first = group[0];
    const {
      completed,
      objective,
      requestSnapshot,
      response,
      snapshot,
      status,
    } = goalToolState(group, toolName, functionCall, functionOutput);
    const label = completed ? goalLabelFor(toolName, status) : 'Incomplete goal call';
    const previewParts = goalPreviewParts({
      objective,
      status,
      hasTokenBudget: snapshot?.hasTokenBudget || requestSnapshot?.hasTokenBudget,
      tokenBudget: snapshot ? snapshot.tokenBudget : requestSnapshot?.tokenBudget,
      tokensUsed: snapshot?.tokensUsed,
      timeUsedSeconds: snapshot?.timeUsedSeconds,
    }, { includeBudget: Boolean(snapshot) });
    const searchText = [
      toolName,
      status,
      objective,
      displayValue(snapshot?.goal, 8000),
      displayValue(response.completionBudgetReport, 4000),
      displayValue(response.remainingTokens, 1000),
      codexSearchValue(functionCall?.output),
      codexSearchValue(functionOutput?.output),
    ].filter(Boolean).join('\n');

    return createLogicalEvent({
      id: `${first.sessionId}:logical:call:${callId}`,
      timestamp: first.timestamp,
      turnId: first.turnId || '',
      kind: 'goal',
      subtype: toolName,
      layer: 'main',
      role: 'assistant',
      label,
      preview: truncate(previewParts.join(' - ') || toolName || label),
      searchText,
      severity: goalSeverity(status),
      status,
      toolName,
      rawRefs: group.map(rawRef),
      channels: [...new Set(group.map((raw) => raw.recordType))],
    });
  }

  function buildGoalSnapshotLogicalEvent(raw, snapshot, transition) {
    const hasRecordedProgress = Number(snapshot.tokensUsed || 0) > 0 || Number(snapshot.timeUsedSeconds || 0) > 0;
    const statusLabel = goalLabelFor('thread_goal_updated', snapshot.status);
    const hasSpecificStatusLabel = statusLabel !== 'Goal updated';
    const label = hasSpecificStatusLabel
      ? statusLabel
      : transition === 'created' && !hasRecordedProgress
        ? 'Goal created'
        : transition === 'created'
          ? 'Goal status'
          : statusLabel;
    const previewParts = goalPreviewParts(snapshot, { includeBudget: true });
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:goal:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId || '',
      kind: 'goal',
      subtype: 'thread_goal_updated',
      layer: 'main',
      role: 'system',
      label,
      preview: truncate(previewParts.join(' - ') || label),
      searchText: uniqueNonEmpty([
        'thread_goal_updated',
        snapshot.status,
        codexFullSearchText(snapshot.goal),
      ]).join('\n'),
      severity: goalSeverity(snapshot.status),
      status: snapshot.status,
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
    });
  }

  function mergeGoalSnapshotRef(event, raw, snapshot) {
    event.rawRefs.push(rawRef(raw));
    event.rawRefs.sort((a, b) => a.line - b.line);
    if (!event.channels.includes(raw.recordType)) event.channels.push(raw.recordType);
    const preview = truncate(goalPreviewParts({ ...snapshot, status: event.status || snapshot.status }, { includeBudget: true }).join(' - '));
    const searchText = uniqueNonEmpty([event.searchText, raw.searchText || codexFullSearchText(snapshot.goal)]).join('\n');
    event.preview = sanitizeLogicalEnvelopeValue(preview || event.preview);
    event.searchText = sanitizeLogicalEnvelopeValue(searchText).trim();
    event.hasLongOutput = event.preview.length > 800 || event.searchText.length > 1600;
  }

  function goalToolCandidateMatches(candidate, raw) {
    if (candidate.matched) return false;
    if (raw.line < candidate.startLine || raw.line > candidate.endLine + 1) return false;
    if (raw.turnId && candidate.turnIds.length && !candidate.turnIds.includes(raw.turnId)) return false;
    return true;
  }

  function nearestGoalToolEvent(candidates, raw) {
    const matching = (candidates || []).filter((candidate) => goalToolCandidateMatches(candidate, raw));
    const candidate = matching.reduce((nearest, current) => {
      if (!nearest) return current;
      const distance = raw.line <= current.endLine ? 0 : raw.line - current.endLine;
      const nearestDistance = raw.line <= nearest.endLine ? 0 : raw.line - nearest.endLine;
      return distance < nearestDistance || (distance === nearestDistance && current.startLine > nearest.startLine)
        ? current
        : nearest;
    }, null);
    if (!candidate) return null;
    candidate.matched = true;
    return candidate.event;
  }

  function textIncludes(source, needle) {
    const sourceText = String(source || '');
    const needleText = String(needle || '').trim();
    return needleText && sourceText.includes(needleText);
  }

  function textIncludesAll(source, needles) {
    return (needles || []).every((needle) => textIncludes(source, needle));
  }

  function firstTextCoveringAll(candidates, needles) {
    return uniqueNonEmpty(candidates).find((candidate) => textIncludesAll(candidate, needles)) || '';
  }

  function addUncoveredTextPart(parts, candidate) {
    const text = String(candidate || '').trim();
    if (!text) return parts;
    if (parts.some((part) => textIncludes(part, text))) return parts;
    return [...parts.filter((part) => !textIncludes(text, part)), text];
  }

  function commandSearchText({ commandText, execEnd, execRows, functionOutputInfo, functionOutput, touchedFiles }) {
    const parsedOutput = functionOutputInfo?.output || '';
    const streamParts = uniqueNonEmpty(execRows.flatMap((raw) => [
      raw.stdout,
      raw.stderr,
    ]));
    const outputCandidates = uniqueNonEmpty([
      parsedOutput,
      execEnd?.aggregatedOutput,
      execEnd?.parsed?.payload?.formatted_output,
      parsedOutput ? '' : functionOutput?.output,
      ...execRows.flatMap((raw) => [
        raw.aggregatedOutput,
        raw.parsed?.payload?.formatted_output,
      ]),
    ]);
    const coveringOutput = streamParts.length ? firstTextCoveringAll(outputCandidates, streamParts) : '';
    let outputParts = coveringOutput ? [coveringOutput] : streamParts;
    for (const candidate of outputCandidates) {
      outputParts = addUncoveredTextPart(outputParts, candidate);
    }
    let searchParts = addUncoveredTextPart([], commandText);
    for (const outputPart of outputParts) {
      searchParts = addUncoveredTextPart(searchParts, codexSearchValue(outputPart));
    }
    for (const touchedFile of touchedFiles || []) {
      searchParts = addUncoveredTextPart(searchParts, touchedFile);
    }
    return searchParts.join('\n');
  }

  function buildToolLogicalEvent(callId, group, traceabilityRows = [], sourceEpochs = null) {
    const rawRefs = [...group.map(rawRef), ...traceabilityRows.map(rawRef)];
    const channels = [...new Set([...group, ...traceabilityRows].map((raw) => raw.recordType))];
    const first = group[0];
    const functionCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
    const functionOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
    const customCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
    const customOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
    const execRows = toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.COMMAND);
    const patchRows = toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.PATCH);
    const mcpRows = toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.MCP_TOOL);
    const imageRows = [
      ...toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION),
      ...group.filter((raw) => raw.recordType === 'response_item' && raw.payloadType === 'image_generation_call'),
    ].sort((a, b) => a.line - b.line);
    const dynamicRows = toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL);
    const approvalRows = toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.APPROVAL);
    const hookRows = group.filter(isHookLifecycleRow);
    const collabRows = toolLifecycleRowsForFamily(group, TOOL_LIFECYCLE_FAMILY.COLLABORATION);
    const execEnd = execRows.find((raw) => raw.payloadType === 'exec_command_end');
    const patchEnd = patchRows.find((raw) => raw.payloadType === 'patch_apply_end');
    const mcpEnd = mcpRows.find((raw) => raw.payloadType === 'mcp_tool_call_end');

    const protocolToolName = group.find((raw) => raw.toolName)?.toolName || '';
    const toolName = customCall?.toolName || functionCall?.toolName || protocolToolName || '';
    const scopedRequest = (customCall || functionCall)?.scopedRequest;
    const functionOutputInfo = parseFormattedCommandOutput(functionOutput?.output);
    const customOutputObj = parseOutputEnvelope(customOutput?.output);
    const attachmentSummaries = attachmentSummaryForRawList(group);
    const attachmentPreview = attachmentSummaries.map((summary) => summary.previewText)
      .filter(Boolean)
      .join(' · ');

    if (GOAL_TOOL_NAMES.has(toolName)) {
      return buildGoalLogicalEvent(callId, group, toolName, functionCall, functionOutput);
    }

    let kind = 'other_tool_call';
    let label = toolName || 'Other tool call';
    let preview = truncate(toolName || 'Other tool call');
    let status = 'completed';
    let severity = 'normal';
    let touchedFiles = [];
    const outputStats = {};
    const parts = scopedRequest ? [toolName] : [];

    // A scoped request can carry its own status. Only an admitted lifecycle
    // describes the tool's outcome; an ordinary response just records a return.
    const outcomeRows = group.filter(raw => isToolOutcomeRow(raw) && (!scopedRequest || raw.recordType === 'event_msg'));
    const protocolStatus = String(outcomeRows.find((raw) => raw.status)?.status || '').toLowerCase();
    const declined = outcomeRows.some((raw) => /_declined$/.test(raw.payloadType) || String(raw.status || '').toLowerCase() === 'declined');
    const failed = outcomeRows.some((raw) => String(raw.status || '').toLowerCase() === 'failed');
    const imageCallCompleted = outcomeRows.some((raw) => raw.payloadType === 'image_generation_call'
      && ['completed', 'complete', 'success', 'succeeded'].includes(String(raw.status || '').toLowerCase()));
    const completed = outcomeRows.some((raw) => /_end$/.test(raw.payloadType)) || imageCallCompleted || Boolean(functionOutput || customOutput);
    const explicitIncomplete = !completed && !failed && !declined;

    const nativeArgs = !customCall && !customOutput
      && group.filter(raw => raw.recordType === 'response_item' && raw.payloadType === 'function_call').length === 1
      && group.filter(raw => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output').length <= 1
      && (!functionOutput || (functionOutput.line > functionCall.line
        && (!sourceEpochs || sourceEpochs.get(functionOutput.rawId)?.number === sourceEpochs.get(functionCall.rawId)?.number)
        && (functionOutput.parsed?.payload?.namespace == null || functionOutput.parsed.payload.namespace === 'functions')))
      ? nativeExecCommandArguments(functionCall) : null;
    const isCommandTool = toolName === 'shell_command' || execRows.length || nativeArgs;

    if (execRows.length) {
      if (execEnd?.exitCode != null) outputStats.exitCode = execEnd.exitCode;
      if (execEnd?.durationMs) outputStats.durationMs = execEnd.durationMs;
    }
    if (functionCall && !isCommandTool) parts.push(codexSearchValue(functionCall.output));
    if (functionOutput && !isCommandTool) parts.push(codexSearchValue(functionOutput.output));
    if (customCall && !isCommandTool) parts.push(codexSearchValue(customCall.output));
    if (customOutput && !isCommandTool) parts.push(codexSearchValue(customOutput.output));
    if (mcpRows.length) parts.push(mcpRows.map((raw) => raw.searchText).join('\n'));
    if (patchRows.length) parts.push(patchRows.map((raw) => raw.searchText).join('\n'));
    if (imageRows.length) parts.push(imageRows.map((raw) => raw.searchText).join('\n'));
    if (dynamicRows.length) parts.push(dynamicRows.map((raw) => raw.searchText).join('\n'));
    if (approvalRows.length) parts.push(approvalRows.map((raw) => raw.searchText).join('\n'));
    if (hookRows.length) parts.push(hookRows.map((raw) => raw.searchText).join('\n'));
    if (collabRows.length) parts.push(collabRows.map((raw) => raw.searchText).join('\n'));
    const startup = resolvedSubAgentStartup([...group, ...traceabilityRows]);
    if (startup) parts.push(codexFullSearchText(Object.fromEntries(['model', 'reasoning_effort']
      .filter((key) => startup[key]).map((key) => [key, startup[key]]))));
    if (attachmentPreview) parts.push(attachmentPreview);

    if (isCommandTool) {
      kind = 'command';
      const args = nativeArgs || commandArgsFromRaw(functionCall);
      const exitCode = numericExitCode(execEnd?.exitCode, functionOutputInfo?.exitCode, customOutputObj?.metadata?.exit_code);
      const commandText = execRows.find((raw) => raw.commandText)?.commandText || commandToText(args?.cmd ?? args?.command);
      const commandSearchSource = execRows.find((raw) => raw.parsed?.payload?.command)?.parsed.payload.command ?? args?.cmd ?? args?.command;
      status = declined ? 'declined' : failed || (exitCode != null && exitCode !== 0) ? 'failed' : exitCode === 0 ? 'success' : (explicitIncomplete || (!execRows.length && functionOutputInfo?.processId !== undefined)) ? 'incomplete' : protocolStatus || 'completed';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
      label = status === 'failed' ? 'Failed command' : status === 'declined' ? 'Declined command' : status === 'incomplete' ? 'Incomplete command' : 'Command';
      preview = truncate(commandText || functionCall?.output || group.find((raw) => raw.preview)?.preview || 'shell command');
      if (exitCode != null) outputStats.exitCode = exitCode;
      if (!execEnd && functionOutputInfo?.durationMs !== undefined) outputStats.durationMs = functionOutputInfo.durationMs;
      if (!outputStats.durationMs && customOutputObj?.metadata?.duration_seconds) {
        outputStats.durationMs = Math.round(Number(customOutputObj.metadata.duration_seconds) * 1000);
      }
      touchedFiles = touchFilesFromOutputText(firstNonEmpty(execEnd?.stdout, execEnd?.aggregatedOutput, functionOutputInfo?.output));
      parts.push(commandSearchText({
        commandText: commandSearchSource == null ? commandText : codexFullSearchText(commandSearchSource),
        execEnd,
        execRows,
        functionOutputInfo,
        functionOutput,
        touchedFiles,
      }));
    } else if (toolName === 'apply_patch' || patchRows.length) {
      kind = 'patch';
      const patchInput = firstNonEmpty(customCall?.output, patchRows.find((raw) => raw.output)?.output);
      touchedFiles = patchEnd?.touchedFiles?.length ? patchEnd.touchedFiles : patchFilesFromPatchInput(patchInput || '');
      const patchSuccess = inferPatchSuccess(patchEnd, customOutputObj, customOutput?.output);
      status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : patchSuccess === true ? 'success' : patchSuccess === false ? 'failed' : 'incomplete';
      severity = patchSuccess === true ? 'normal' : patchSuccess === false ? 'error' : 'warning';
      if (status === 'declined' || status === 'incomplete') severity = 'warning';
      label = status === 'success' ? 'Patch applied' : status === 'declined' ? 'Patch declined' : status === 'incomplete' ? 'Incomplete patch' : 'Patch failed';
      preview = truncate(touchedFiles.join(', ') || customOutputObj?.output || patchInput || group.find((raw) => raw.preview)?.preview || 'apply_patch');
      if (customOutputObj?.metadata && isFiniteNumberValue(customOutputObj.metadata.exit_code)) {
        outputStats.exitCode = Number(customOutputObj.metadata.exit_code);
      } else if (patchSuccess === false) {
        outputStats.exitCode = 1;
      }
      if (customOutputObj?.metadata?.duration_seconds) {
        outputStats.durationMs = Math.round(Number(customOutputObj.metadata.duration_seconds) * 1000);
      }
    } else if (toolName === 'js_repl') {
      kind = 'js_repl';
      const exitCode = execEnd?.exitCode ?? customOutputObj?.metadata?.exit_code ?? 0;
      status = exitCode === 0 ? 'success' : 'failed';
      severity = exitCode === 0 ? 'normal' : 'error';
      label = exitCode === 0 ? 'JS REPL' : 'JS REPL error';
      preview = truncate(codexSearchValue(customCall?.output) || codexSearchValue(customOutputObj?.output) || 'js_repl');
      outputStats.exitCode = exitCode;
      outputStats.durationMs = execEnd?.durationMs || Math.round(Number(customOutputObj?.metadata?.duration_seconds || 0) * 1000);
    } else if (mcpRows.length || (!scopedRequest && toolName.startsWith('mcp__'))) {
      kind = 'mcp_call';
      label = 'MCP tool';
      preview = truncate(mcpEnd?.preview || group.find((raw) => raw.preview)?.preview || toolName);
      status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
      if (scopedRequest && !mcpEnd && !declined && !failed) status = completed ? 'completed' : 'incomplete';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
      outputStats.durationMs = mcpEnd?.durationMs || 0;
    } else if (hookRows.length) {
      return buildHookLogicalEvent(`call:${callId}`, hookRows);
    } else if (collabRows.length || isAgentCoordinationTool(toolName)) {
      kind = AGENT_COORDINATION_KIND;
      const representativeRow = representativeToolLifecycleRow(collabRows);
      label = representativeRow ? groupedToolLifecycleLabel(representativeRow, toolName) : toolName;
      preview = truncate(representativeRow?.preview || codexSearchValue(functionCall?.output) || codexSearchValue(functionOutput?.output) || toolName || label);
      status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
    } else if (imageRows.length || dynamicRows.length || approvalRows.length) {
      kind = 'other_tool_call';
      const representativeRow = representativeToolLifecycleRow([...imageRows, ...dynamicRows, ...approvalRows]);
      label = groupedToolLifecycleLabel(representativeRow, toolName);
      preview = truncate(representativeRow?.preview || group.find((raw) => raw.preview)?.preview || toolName || label);
      status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
    } else if (toolName === 'request_user_input' || toolName === 'update_plan' || toolName === 'view_image' || toolName === 'js_repl_reset') {
      kind = 'other_tool_call';
      label = toolName;
      preview = truncate(codexSearchValue(functionCall?.output) || codexSearchValue(functionOutput?.output) || toolName);
      status = 'success';
    } else {
      preview = truncate(first.preview || toolName || 'Other tool call');
      if (scopedRequest && explicitIncomplete) {
        status = 'incomplete';
        severity = 'warning';
      }
    }

    const typedExtension = group.find((raw) => raw.typedItemType === 'Extension')?.originalRaw?.parsed?.payload?.item;
    if (typedExtension && ['clock.sleep', 'web.search'].includes(typedExtension.kind) && status === 'success') status = 'completed';
    // A typed dynamic end records completion, not necessarily success. Keep
    // explicit failure precedence, and require a boolean true for success.
    const typedDynamic = group.find((raw) => raw.typedItemType === 'DynamicToolCall')?.parsed?.payload;
    const dynamicEnds = dynamicRows.filter(row => row.dynamicTerminalStatus);
    if (dynamicEnds.length) {
      status = dynamicEnds.find(row => row.dynamicTerminalStatus !== 'completed')?.dynamicTerminalStatus || 'completed';
      severity = status === 'failed' ? 'error' : ['declined', 'interrupted'].includes(status) ? 'warning' : 'normal';
    } else if (scopedRequest && dynamicRows.length) {
      status = completed ? 'completed' : 'incomplete';
      severity = completed ? 'normal' : 'warning';
    } else if (typedDynamic && typedDynamic.success !== true && status === 'success') status = 'completed';
    if (collabRows.some((raw) => raw.status === 'interrupted')) {
      status = 'interrupted';
      severity = 'warning';
    }

    const event = createLogicalEvent({
      id: `${first.sessionId}:logical:call:${callId}`,
      timestamp: first.timestamp,
      turnId: first.turnId || '',
      kind,
      subtype: toolName || kind,
      layer: 'main',
      role: 'assistant',
      label,
      preview: truncate([preview, attachmentPreview].filter(Boolean).join(' · ')),
      searchText: parts.filter(Boolean).join('\n'),
      severity,
      status,
      toolName: toolName || kind,
      touchedFiles,
      outputStats,
      rawRefs,
      channels,
    });
    return event;
  }

  function buildCodeModeLogicalEvent(operation, facts, rawById) {
    const ownedRaws = facts.rawRefs
      .map((ref) => rawById.get(ref.rawId))
      .filter(Boolean);
    const first = ownedRaws[0];
    const execCall = rawById.get(operation.phases[0]?.callRef?.rawId);
    const event = createLogicalEvent({
      id: operation.id,
      timestamp: first?.timestamp || '',
      turnId: operation.turnId || first?.turnId || '',
      kind: 'code_mode_operation',
      layer: 'main',
      role: 'assistant',
      label: 'Code Mode operation',
      preview: truncate(execCall?.output || ''),
      searchText: facts.searchableText,
      severity: 'normal',
      status: '',
      toolName: 'exec',
      rawRefs: facts.rawRefs,
      channels: [...new Set(ownedRaws.map((raw) => raw.recordType))],
    });
    event.codeModeOperation = { ...operation, eventRefs: facts.eventRefs };
    return event;
  }

  function isWebSearchCall(raw) {
    return raw?.recordType === 'response_item' && raw.payloadType === 'web_search_call';
  }

  function isWebSearchEnd(raw) {
    return raw?.recordType === 'event_msg' && raw.payloadType === 'web_search_end';
  }

  function webSearchActionKey(raw) {
    const payload = raw?.parsed?.payload || {};
    const action = payload.action && typeof payload.action === 'object' ? payload.action : {};
    const type = action.type || '';
    const query = action.query || (type === 'search' ? payload.query : '');
    const url = action.url || payload.url || (type === 'open_page' ? payload.query : '');
    const pattern = action.pattern || payload.pattern || '';
    return [
      type,
      query,
      url,
      pattern,
    ].filter(Boolean).join('\n');
  }

  function webSearchRowsMatch(searchEnd, searchCall) {
    if (!isWebSearchEnd(searchEnd) || !isWebSearchCall(searchCall)) return false;
    const endKey = webSearchActionKey(searchEnd);
    const callKey = webSearchActionKey(searchCall);
    if (endKey && callKey) return endKey === callKey;
    if (!searchEnd.turnId || searchEnd.turnId !== searchCall.turnId) return false;
    if (!searchEnd.timestamp || !searchCall.timestamp) return false;
    const deltaMs = Math.abs(Date.parse(searchEnd.timestamp) - Date.parse(searchCall.timestamp));
    return Number.isFinite(deltaMs) && deltaMs <= 1000;
  }

  function buildWebSearchEvent(searchCall, searchEnd) {
    const raws = [searchEnd, searchCall].filter(Boolean).sort((a, b) => a.line - b.line);
    const first = raws[0];
    const preview = searchEnd?.preview || searchCall?.preview || 'web_search';
    const searchText = uniqueNonEmpty(raws.map((raw) => raw.searchText)).join('\n');
    return createLogicalEvent({
      id: `${first.sessionId}:logical:web_search:${first.line}`,
      timestamp: first.timestamp,
      turnId: searchEnd?.turnId || searchCall?.turnId || '',
      kind: 'web_search',
      subtype: 'web_search',
      layer: 'main',
      role: 'assistant',
      label: 'Web search',
      preview,
      searchText,
      severity: 'normal',
      status: searchEnd?.status || searchCall?.status || 'completed',
      toolName: 'web_search',
      rawRefs: raws.map(rawRef),
      channels: raws.map((raw) => raw.recordType),
    });
  }

  function buildProtocolEvent(raw, subtype, label) {
    const resolvedSubtype = subtype || raw.payloadType || raw.recordType || 'protocol_event';
    const displayLabel = protocolLabelFor(resolvedSubtype, label);
    const preview = protocolPreviewFor(raw, resolvedSubtype);
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:protocol:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: 'protocol',
      subtype: resolvedSubtype,
      layer: 'protocol',
      role: raw.role,
      label: displayLabel,
      preview,
      searchText: uniqueNonEmpty([displayLabel, preview, raw.searchText]).join('\n'),
      severity: 'normal',
      status: raw.status,
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
    });
  }

  function buildUserShellCommandEvent(raws) {
    const group = Array.isArray(raws) ? raws : [raws];
    const first = group[0];
    const preview = protocolPreviewFor(first, 'user_shell_command');
    return createLogicalEvent({
      id: `${first.sessionId}:logical:user_shell_command:${first.line}`,
      timestamp: first.timestamp,
      turnId: group.find((raw) => raw.turnId)?.turnId || '',
      kind: 'user_shell_command',
      subtype: 'user_shell_command',
      layer: 'main',
      role: 'user',
      label: 'user_shell_command',
      preview,
      searchText: uniqueNonEmpty(['user_shell_command', preview, ...group.map((raw) => raw.searchText)]).join('\n'),
      severity: 'normal',
      status: first.status,
      rawRefs: group.map(rawRef),
      channels: [...new Set(group.map((raw) => raw.recordType))],
    });
  }

  function buildLifecycleEvent(raw, kind, label, severity, previewOverride = '', subtype = '') {
    const tokenUsage = kind === 'usage_limit_warning' ? tokenUsageItems(raw.parsed?.payload) : [];
    const usageLimits = kind === 'usage_limit_warning' ? collectUsageLimitItems(raw.parsed?.payload) : [];
    const reachedType = kind === 'usage_limit_warning' ? rateLimitReachedType(raw.parsed?.payload) : '';
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:${kind}:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind,
      subtype: subtype || raw.payloadType || kind,
      layer: 'main',
      role: raw.role,
      label,
      preview: previewOverride || raw.preview || label,
      searchText: raw.searchText,
      severity,
      status: raw.status || reachedType,
      tokenUsage,
      usageLimits,
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
    });
  }

  function reviewLifecyclePreview(raw) {
    const lifecycle = reviewLifecycleFromRaw(raw, { ownerId: raw.sessionId });
    const payload = lifecycle?.payload || {};
    if (!lifecycle) return '';
    if (lifecycle.phase === 'entered') {
      const hint = displayValue(firstNonEmpty(payload.user_facing_hint, payload.target), 180).trim();
      return hint ? `Review started: ${hint}` : 'Review started';
    }

    const output = payload.review_output || {};
    const findings = Array.isArray(output.findings) ? `${output.findings.length} findings` : '';
    const correctness = displayValue(output.overall_correctness, 200).trim();
    const explanation = displayValue(output.overall_explanation, 400).trim();
    const summary = uniqueNonEmpty([correctness, findings, explanation]).join(' - ');
    return truncate(summary ? `Review completed: ${summary}` : 'Review completed');
  }

  function buildConversationEvent(id, kind, role, text, raws) {
    const asyncMessage = raws.map(asyncAgentMessageFromRaw).find(Boolean) || null;
    const asyncPayload = asyncMessage
      ? raws.find((raw) => asyncAgentMessageFromRaw(raw))?.parsed?.payload : null;
    const attachmentSummary = attachmentSummaryForRawList(raws)[0] || null;
    const attachmentPreview = attachmentSummary?.previewText || '';
    const event = createLogicalEvent({
      id,
      timestamp: raws[0].timestamp,
      turnId: raws.find((raw) => raw.turnId)?.turnId || '',
      kind,
      subtype: kind,
      layer: 'main',
      role,
      label: asyncMessage ? 'Asynchronous message' : role === 'user' ? 'User message' : 'Assistant message',
      preview: truncate([text, attachmentPreview].filter(Boolean).join(' · ')),
      // Preserve the established async occurrence domain (question projection
      // plus message body) while both projections now carry complete text.
      searchText: asyncMessage
        ? [codexAsyncSearchText(asyncPayload) || asyncMessageSearchText(asyncMessage),
          codexAsyncMessageText(asyncPayload) || text, attachmentPreview].filter(Boolean).join('\n')
        : raws.reduce((parts, raw) => addUncoveredTextPart(parts, raw.searchText || raw.messageText), []).join('\n')
          || [text, attachmentPreview].filter(Boolean).join('\n'),
      severity: 'normal',
      status: '',
      rawRefs: raws.map(rawRef),
      channels: [...new Set(raws.map((raw) => raw.recordType))],
    });
    if (asyncMessage) event.asyncMessage = asyncMessageMetadata(asyncMessage);
    return event;
  }

  function mirroredMessageTextMatches(left, right) {
    return String(left || '').trim() === String(right || '').trim();
  }

  // 0.172 creates the prepared input and a fresh-ID UserMessage in one
  // acceptance. The mirror map has already checked full text and turn epoch.
  function recordedUserTextOrigin(raw, mirror) {
    if (raw.typedItemType) return '';
    const payload = raw.parsed.payload;
    const attribution = payload.internal_chat_message_metadata_passthrough;
    const kinds = attribution?.content_item_kinds;
    if (!Array.isArray(kinds) || !Array.isArray(payload.content) || kinds.length !== payload.content.length) return '';
    if (kinds.length === 1 && kinds[0] === 'user.heartbeat' && payload.content[0]?.type === 'input_text') return 'heartbeat';
    const parts = attribution.content_item_metadata;
    const completion = mirror?.originalRaw?.parsed?.payload;
    const evidence = raw.parsed.metadata;
    if (mirror?.typedItemType !== 'UserMessage' || completion.thread_id !== raw.sessionId
        || !mirror.turnId || attribution.turn_id !== mirror.turnId
        || mirror.source.file !== raw.source.file || mirror.source.line !== raw.source.line + 1
        || !Array.isArray(parts) || !kinds.length || parts.length !== kinds.length
        || completion.item.content.length !== kinds.length
        || evidence?.inherited_user_message || evidence?.guardian_sources?.length
        || evidence?.realtime_session_input || evidence?.realtime_session_end_input) return '';
    return payload.content.every((part, index) => part?.type === 'input_text' && typeof part.text === 'string'
      && !hasExternalizedImage(part.text)
      && kinds[index] === 'user.text' && parts[index]?.provenance?.type === 'user'
      && completion.item.content[index]?.type === 'text' && completion.item.content[index].text === part.text)
      ? 'submitted' : '';
  }

  function attachmentSummaryForRaw(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.attachmentSummary?.totalCount > 0) return raw.attachmentSummary;
    const payload = raw.parsed?.payload;
    const summary = summarizeCodexAttachments(payload);
    return summary.totalCount > 0 ? summary : null;
  }

  function attachmentSummaryForRawList(raws) {
    const summaries = [];
    const completeDigests = new Set();
    for (const raw of raws || []) {
      const summary = attachmentSummaryForRaw(raw);
      if (!summary) continue;
      const digest = summary.identity?.complete === true ? summary.identity.digest : '';
      if (digest && completeDigests.has(digest)) continue;
      if (digest) completeDigests.add(digest);
      summaries.push(summary);
    }
    return summaries;
  }

  function mirroredAttachmentIdentityMatches(leftRaw, rightRaw) {
    const left = attachmentSummaryForRaw(leftRaw);
    const right = attachmentSummaryForRaw(rightRaw);
    if (!left && !right) return true;
    if (!left || !right) return false;
    if (left.identity?.complete !== true || right.identity?.complete !== true) return false;
    return left.identity.digest === right.identity.digest;
  }

  function canonicalAsyncMessageOwnerMatches(raw) {
    const payload = raw?.parsed?.payload;
    if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'thread_id')) return true;
    return typeof payload.thread_id === 'string'
      && payload.thread_id.length > 0
      && payload.thread_id === raw.sessionId;
  }

  function asyncMessageRawIdentityMatches(leftRaw, leftMessage, rightRaw, rightMessage) {
    if (!leftRaw || !rightRaw || leftRaw.sessionId !== rightRaw.sessionId) return false;
    if (leftRaw.turnId && rightRaw.turnId && leftRaw.turnId !== rightRaw.turnId) return false;
    return asyncMessageIdentityMatches(leftMessage, rightMessage)
      && mirroredAttachmentIdentityMatches(leftRaw, rightRaw);
  }

  function buildDeveloperMessageEvent(raw) {
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:developer:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId || '',
      kind: 'developer_message',
      subtype: 'developer_message',
      layer: 'protocol',
      role: 'developer',
      label: 'Developer message',
      preview: truncate(raw.messageText || raw.preview || 'Developer message'),
      searchText: uniqueNonEmpty(['Possible hook output', raw.messageText, raw.searchText]).join('\n'),
      severity: 'normal',
      status: '',
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
      tags: ['Possible hook output'],
    });
  }

  function buildReasoningEvent(raws, text) {
    return createLogicalEvent({
      id: `${raws[0].sessionId}:logical:reasoning:${raws[0].line}`,
      timestamp: raws[0].timestamp,
      turnId: raws.find((raw) => raw.turnId)?.turnId || '',
      kind: 'reasoning',
      subtype: 'reasoning',
      layer: text ? 'main' : 'protocol',
      role: 'assistant',
      label: text ? 'Reasoning' : 'Empty reasoning',
      preview: truncate(text || raws[0].preview || 'reasoning'),
      searchText: raws.reduce((parts, raw) => addUncoveredTextPart(parts, raw.searchText || raw.messageText), []).join('\n') || text,
      hasReadableReasoning: Boolean(text),
      severity: 'normal',
      status: '',
      rawRefs: raws.map(rawRef),
      channels: [...new Set(raws.map((raw) => raw.recordType))],
    });
  }

  function buildPlanArtifact(itemRaw, messageRaw, text) {
    const raws = messageRaw ? [itemRaw, messageRaw] : [itemRaw];
    return createLogicalEvent({
      id: `${itemRaw.sessionId}:logical:plan:${itemRaw.line}`,
      timestamp: itemRaw.timestamp,
      turnId: itemRaw.turnId || messageRaw?.turnId || '',
      kind: 'proposed_plan',
      subtype: 'proposed_plan',
      layer: 'main',
      role: 'assistant',
      label: 'Proposed plan',
      preview: truncate(text),
      searchText: text,
      severity: 'normal',
      status: '',
      rawRefs: raws.map(rawRef),
      channels: [...new Set(raws.map((raw) => raw.recordType))],
    });
  }

  function buildPlanUpdateEvent(raw) {
    const text = planUpdateText(raw);
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:plan-update:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId || '',
      kind: 'plan_update',
      subtype: raw.payloadType,
      layer: 'main',
      role: 'assistant',
      label: raw.payloadType === 'plan_delta' ? 'Plan delta' : 'Plan update',
      preview: truncate(text || raw.preview || raw.payloadType),
      searchText: raw.searchText || text,
      severity: 'normal',
      status: raw.status || '',
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
    });
  }

  function protocolWarningLabel(type) {
    if (type === 'stream_error') return 'Stream error';
    if (type === 'guardian_warning') return 'Guardian warning';
    return 'Warning';
  }

  function buildProtocolWarningEvent(raw) {
    const isError = raw.payloadType === 'stream_error';
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:${raw.payloadType}:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId || '',
      kind: isError ? 'error' : 'warning',
      subtype: raw.payloadType,
      layer: 'main',
      role: 'system',
      label: protocolWarningLabel(raw.payloadType),
      preview: truncate(firstNonEmpty(raw.parsed?.payload?.message, raw.parsed?.payload?.reason, raw.preview, raw.payloadType)),
      searchText: raw.searchText,
      severity: isError ? 'error' : 'warning',
      status: raw.status || '',
      rawRefs: [rawRef(raw)],
      channels: [raw.recordType],
    });
  }

  function sideChatBoundary(raws, initialOwnedHeader) {
    function isSideHeader(raw) {
      const meta = raw?.parsed?.payload;
      return raw?.recordType === 'session_meta' && raw.source.line === 1 && meta?.id === raw.sessionId
        && meta.history_mode === 'paginated' && meta.attached_thread === true
        && meta.thread_source === 'tui_side_chat' && typeof meta.forked_from_id === 'string'
        && meta.forked_from_id.trim() && meta.forked_from_id !== meta.id;
    }
    const head = raws[0];
    if (!isSideHeader(head) || !isSideHeader(initialOwnedHeader)
        || initialOwnedHeader.sessionId !== head.sessionId
        || initialOwnedHeader.parsed.payload.forked_from_id !== head.parsed.payload.forked_from_id
        || !Number.isSafeInteger(initialOwnedHeader.parsed.ordinal) || initialOwnedHeader.parsed.ordinal < 0) return null;
    const physical = parseRolloutArtifactIdentity(initialOwnedHeader.source.file);
    if (!physical || physical.threadId !== initialOwnedHeader.sessionId.toLowerCase()
        || physical.rolloutId !== physical.threadId) return null;
    // The TUI injects two response items together before its first child turn.
    // Only inspect owned rows. The effective header can be in a later revert artifact.
    function textPart(row, role) {
      const p = row?.parsed?.payload;
      return row?.recordType === 'response_item' && p?.type === 'message' && p.role === role
        && Array.isArray(p.content) && p.content.length === 1 && p.content[0]?.type === 'input_text'
        && typeof p.content[0].text === 'string' ? p.content[0].text : '';
    }
    function follows(row, previous) {
      return row?.source.file === previous.source.file && row.source.line === previous.source.line + 1
        && Number.isSafeInteger(row.parsed?.ordinal) && row.parsed.ordinal === previous.parsed.ordinal + 1;
    }
    let previous = initialOwnedHeader;
    for (let i = 1; i < raws.length; i++) {
      const policy = raws[i];
      if (!follows(policy, previous)) return null;
      if (policy.recordType === 'event_msg' && policy.payloadType === 'thread_settings_applied') {
        previous = policy;
        continue;
      }
      const text = textPart(policy, 'developer');
      if (!text.startsWith('<side_conversation>') || !text.endsWith('</side_conversation>')) return null;
      const source = policy.parsed.payload.internal_chat_message_metadata_passthrough;
      if (!Array.isArray(source?.content_item_kinds) || source.content_item_kinds.length !== 1
          || source.content_item_kinds[0] !== 'side_conversation.policy'
          || !Array.isArray(source.content_item_metadata) || source.content_item_metadata.length !== 1
          || source.content_item_metadata[0]?.provenance?.type !== 'harness'
          || source.content_item_metadata[0].provenance.hook) return null;
      const next = raws[i + 1];
      if (!follows(next, policy) || !textPart(next, 'user').startsWith('Side conversation boundary.\n\n')) return null;
      const attribution = next.parsed.payload.internal_chat_message_metadata_passthrough;
      const kinds = attribution?.content_item_kinds;
      const following = raws[i + 2];
      if (following?.recordType === 'event_msg' && (following.payloadType === 'user_message'
          || following.parsed?.payload?.item?.type === 'UserMessage')) return null;
      // The native writer fills an unannotated injected text part with "unknown".
      return attribution?.content_item_metadata == null && (kinds == null
        || (Array.isArray(kinds) && kinds.length === 1 && kinds[0] === 'unknown')) ? next : null;
    }
    return null;
  }

  function buildLogicalEvents(rawEvents, initialOwnedHeader = rawEvents[0]) {
    const sideBoundary = sideChatBoundary(rawEvents, initialOwnedHeader);
    rawEvents = semanticRawEvents(rawEvents, remainingToolPeer);
    const typedMirrors = new Map();
    const omittedTyped = new Set();
    const responseById = new Map();
    const epochs = turnBoundaryEpochs(rawEvents);
    for (const raw of rawEvents) {
      const id = raw.parsed?.payload?.id;
      if (!raw.typedItemType && raw.recordType === 'response_item' && typeof id === 'string' && id) {
        if (!responseById.has(id)) responseById.set(id, []);
        responseById.get(id).push(raw);
      }
    }
    for (let position = 0; position < rawEvents.length; position += 1) {
      const raw = rawEvents[position];
      if (!['UserMessage', 'AgentMessage', 'Reasoning', 'FunctionCallOutput'].includes(raw.typedItemType)) continue;
      // AgentMessage and Reasoning preserve an existing ResponseItem ID.
      // UserMessage gets a fresh UUID: only the immediate preceding prepared
      // response is a supported fanout, never a text/time-window search.
      const candidates = raw.typedItemType === 'UserMessage'
        ? [rawEvents[position - 1]].filter(Boolean)
        : responseById.get(raw.parsed.payload.id) || [];
      if (candidates.length !== 1) continue;
      const owner = candidates[0];
      if (raw.typedItemType === 'UserMessage') {
        // Media redaction can replace even identity strings in a malformed row.
        // A shared placeholder cannot identify the owner, turn or completion.
        const prepared = owner.parsed?.payload;
        const completion = raw.originalRaw?.parsed?.payload;
        if ([owner.sessionId, owner.turnId, prepared?.id, prepared?.internal_chat_message_metadata_passthrough?.turn_id,
          completion?.thread_id, completion?.turn_id, completion?.item?.id].some(hasExternalizedImage)) continue;
      }
      const fullBody = (value) => {
        const payload = value.parsed?.payload || {};
        if (payload.content != null && !Array.isArray(payload.content)) return null;
        return JSON.stringify([payload.summary || [], (payload.content || []).map((part) => part?.text).filter((text) => typeof text === 'string')]);
      };
      if (owner.typedItemType || owner.recordType !== raw.recordType || owner.payloadType !== raw.payloadType
          || owner.role !== raw.role || owner.sessionId !== raw.sessionId
          || epochs.get(owner.rawId)?.number !== epochs.get(raw.rawId)?.number
          || (owner.turnId && raw.turnId && owner.turnId !== raw.turnId)
          || owner.messageText !== raw.messageText
          || fullBody(owner) !== fullBody(raw)
          || !mirroredAttachmentIdentityMatches(owner, raw)
          || typedMirrors.has(owner.rawId)) continue;
      if (raw.typedItemType === 'FunctionCallOutput' && !externalToolInputMirrorsMatch(owner, raw)) continue;
      typedMirrors.set(owner.rawId, raw);
      omittedTyped.add(raw.rawId);
    }
    rawEvents = rawEvents.filter((raw) => !omittedTyped.has(raw.rawId));
    const logicalEvents = [];
    // Duplicate opaque identities are ambiguous, including equal text. Leave
    // every occurrence inspectable rather than choosing an owner across a
    // copied-history boundary before the fork ownership pass has run.
    const realtimeIdentities = new Map();
    for (const raw of rawEvents) {
      const key = realtimeIdentity(raw);
      if (!key) continue;
      realtimeIdentities.set(key, (realtimeIdentities.get(key) || 0) + 1);
    }
    const consumed = new Set();
    const asyncMessageOwnersByIdentity = new Map();
    const registerAsyncMessageOwner = (raw, message, event) => {
      if (!message?.itemId) return;
      const key = JSON.stringify([raw.sessionId, message.itemId]);
      if (!asyncMessageOwnersByIdentity.has(key)) asyncMessageOwnersByIdentity.set(key, []);
      asyncMessageOwnersByIdentity.get(key).push({ event, raw, message });
    };
    const findAsyncMessageOwner = (raw, message) => {
      if (!message?.itemId) return null;
      const key = JSON.stringify([raw.sessionId, message.itemId]);
      const owners = asyncMessageOwnersByIdentity.get(key) || [];
      if (owners.length !== 1) return null;
      return asyncMessageRawIdentityMatches(owners[0].raw, owners[0].message, raw, message)
        ? owners[0]
        : null;
    };
    const byCallId = new Map();
    const subAgentActivityByEventId = new Map();
    const goalToolEventsBySignature = new Map();
    const previousGoalSnapshots = new Map();
    const rawById = new Map(rawEvents.map((raw) => [raw.rawId, raw]));
    const codeModeProjection = projectCodeModeOperations(rawEvents);
    const initialCodeModeFacts = deriveCodeModeFacts({
      projection: codeModeProjection,
      rawEvents,
      logicalEvents: [],
      lifecycleTypes: CODE_MODE_ASSOCIATION_EVENT_TYPES,
    });
    const initialFactsByOperation = new Map(initialCodeModeFacts.operationFacts
      .map((facts) => [facts.operationId, facts]));

    for (const operation of codeModeProjection.operations) {
      const event = buildCodeModeLogicalEvent(operation, initialFactsByOperation.get(operation.id), rawById);
      logicalEvents.push(event);
    }
    for (const rawId of initialCodeModeFacts.claimedRawIds) consumed.add(rawId);

    function keepUnpaired(raw) {
      const request = raw.recordType === 'response_item' && ['custom_tool_call', 'function_call'].includes(raw.payloadType);
      logicalEvents.push(request ? createLogicalEvent({
        id: `${raw.sessionId}:logical:unpaired-call:${raw.line}`,
        timestamp: raw.timestamp, turnId: raw.turnId, kind: 'other_tool_call', layer: 'main',
        role: 'assistant', toolName: raw.toolName, subtype: raw.toolName, label: raw.toolName,
        preview: raw.preview, searchText: uniqueNonEmpty([raw.toolName, codexSearchValue(raw.output)]).join('\n'),
        status: 'incomplete', severity: 'warning', rawRefs: [rawRef(raw)], channels: [raw.recordType],
      }) : buildProtocolEvent(raw.originalRaw || raw));
      consumed.add(raw.rawId);
    }

    const disputedFunctionIds = new Set();
    for (const rawId of codeModeProjection.isolatedRawIds || []) {
      const raw = rawById.get(rawId);
      if (raw.payloadType === 'function_call') disputedFunctionIds.add(raw.callId);
    }
    for (const raw of rawEvents) {
      const disputedMcp = raw.recordType === 'event_msg' && disputedFunctionIds.has(raw.callId)
        && isToolLifecycleFamily(raw.payloadType, TOOL_LIFECYCLE_FAMILY.MCP_TOOL);
      if (codeModeProjection.isolatedRawIds?.has(raw.rawId) || disputedMcp || raw.detachedNativeTerminal) {
        if (consumed.has(raw.rawId)) continue;
        keepUnpaired(raw);
        continue;
      }
      if (raw.callId) {
        if (!byCallId.has(raw.callId)) byCallId.set(raw.callId, []);
        byCallId.get(raw.callId).push(raw);
      }
      const activityEventId = subAgentActivityEventId(raw);
      if (activityEventId) {
        if (!subAgentActivityByEventId.has(activityEventId)) subAgentActivityByEventId.set(activityEventId, []);
        subAgentActivityByEventId.get(activityEventId).push(raw);
      }
    }

    // AgentPath accepts /root descendants and relative references made of
    // lowercase names. The registry is needed to resolve a valid path to a UUID.
    function isAgentPathReference(value) {
      if (typeof value !== 'string') return false;
      if (value === '/root') return true;
      const names = value.startsWith('/root/') ? value.slice('/root/'.length) : value;
      return names.split('/').every(part => part !== 'root' && /^[a-z0-9_]+$/.test(part));
    }

    function waitReceiversMatch(call, row, native, pathWait) {
      const payload = row.parsed.payload;
      const { name, namespace } = call.parsed.payload;
      const args = commandArgsFromRaw(call);
      if (payload.sender_thread_id !== call.sessionId || !args || Array.isArray(args)
          || (args.timeout_ms != null && !Number.isSafeInteger(args.timeout_ms))) return false;

      // Early bare wait and wait_agent took ids. Later targeted waits took
      // targets, and the V2 mailbox wait accepts only an optional timeout.
      const namedV1 = namespace === 'multi_agent_v1';
      const hasIds = Object.hasOwn(args, 'ids');
      const hasTargets = Object.hasOwn(args, 'targets');
      const field = namedV1 || hasTargets ? 'targets' : hasIds ? 'ids' : null;
      if ((!namedV1 && hasTargets && hasIds)
          || ((name === 'wait' || !field) && Object.keys(args).some(key => key !== field && key !== 'timeout_ms'))
          || (name === 'wait' && (!native || field !== 'ids'))
          || (field === 'ids' && !native)
          || (field === 'targets' && !native && !namedV1)) return false;
      const declared = field ? args[field] : [];
      if (!Array.isArray(declared) || (field && (!declared.length || (args.timeout_ms != null && args.timeout_ms <= 0)))
          || !declared.every(value => typeof value === 'string' && value.length)) return false;
      const targets = declared.map(collaborationThreadId);
      const paths = new Set(declared.filter((value, i) => targets[i] === null));
      // The earlier bare targets handler could resolve paths or relative names.
      if (paths.size && (!native || field !== 'targets' || ![...paths].every(isAgentPathReference))) return false;

      const begin = payload.type === 'collab_waiting_begin';
      // A verified paginated end lists its returned threads directly. A legacy
      // end records the same subset as the keys of its statuses map.
      const listsReceivers = begin || row.typedItemType === 'CollabAgentToolCall';
      const receivers = listsReceivers ? payload.receiver_thread_ids
        : payload.statuses && typeof payload.statuses === 'object' && !Array.isArray(payload.statuses)
          ? Object.keys(payload.statuses) : null;
      if (!Array.isArray(receivers) || (begin && receivers.length !== targets.length)) return false;
      const receiverIds = receivers.map(collaborationThreadId);
      const observed = new Set(receiverIds);
      if (observed.has(null)) return false;
      const metadata = listsReceivers ? payload.receiver_agents : payload.agent_statuses;
      if (metadata !== undefined && (!Array.isArray(metadata)
          || !metadata.every(agent => observed.has(collaborationThreadId(agent?.thread_id))))) return false;

      // The writer resolves targets in order before emitting the begin. Each
      // occurrence of a path in that request must resolve to the same UUID.
      if (begin) {
        const resolved = new Map();
        const matches = targets.every((id, i) => {
          if (id !== null) return id === receiverIds[i];
          const path = declared[i];
          if (!resolved.has(path)) resolved.set(path, receiverIds[i]);
          return resolved.get(path) === receiverIds[i];
        });
        if (matches && paths.size && pathWait) {
          if (pathWait.ends.size) {
            pathWait.closed = true;
            return false;
          }
          pathWait.begins.add(row.rawId);
          pathWait.receivers = observed;
        }
        return matches;
      }
      // 79ad7b247's wait writer subscribes to the UUIDs recorded in its begin.
      // Without a begin, each distinct path can still explain one unknown UUID.
      const known = new Set(targets.filter(id => id !== null));
      const unknown = [...observed].filter(id => !known.has(id));
      if (unknown.length > paths.size) return false;
      if (paths.size && pathWait) {
        if (pathWait.closed) return false;
        if (unknown.length && pathWait.begins.size && (pathWait.begins.size > 1
            || !unknown.every(id => pathWait.receivers.has(id)))) return false;
        pathWait.ends.add(row.rawId);
      }
      return true;
    }

    function legacyAgentMessageMatches(call, payload) {
      const args = commandArgsFromRaw(call);
      const receiver = collaborationThreadId(payload.receiver_thread_id);
      if (call.parsed.payload.namespace === 'multi_agent_v1' || payload.sender_thread_id !== call.sessionId
          || !receiver || !args || typeof payload.prompt !== 'string') return false;
      const target = collaborationThreadId(args.target);
      if (target ? target !== receiver : args.target !== '/morpheus' && !isAgentPathReference(args.target)) return false;
      // Earlier SendMessage handlers copied the text into a legacy interaction.
      // A later writer redacted it to ""; the current one emits no interaction.
      if (Array.isArray(args.items)) {
        // The first items writer ignored extra fields and decoded interrupt as a boolean.
        return (!Object.hasOwn(args, 'interrupt') || typeof args.interrupt === 'boolean')
          && args.items.length > 0 && args.items.every(item => item?.type === 'text' && typeof item.text === 'string')
          && args.items.map(item => item.text).join('\n') === payload.prompt;
      }
      return typeof args.message === 'string' && Boolean(args.message.trim())
        && Object.keys(args).every(key => key === 'target' || key === 'message')
        && (payload.prompt === args.message || (payload.prompt === '' && target === receiver));
    }

    function collaborationReceiverConflicts(name, args, payload) {
      const receiver = collaborationThreadId(payload.receiver_thread_id);
      if (name === 'spawn_agent' || receiver === null) return false;
      // The older send_input and close_agent contracts called the target "id".
      return [args?.target, args?.id].map(collaborationThreadId).some(id => id !== null && id !== receiver);
    }

    function remainingToolPeer(call, row, pathWait) {
      const { name, namespace } = call.parsed.payload;
      if (typeof name !== 'string' || (namespace != null && typeof namespace !== 'string')) return null;
      const native = namespace == null || namespace === '' || namespace === 'functions';
      const fn = call.payloadType === 'function_call';
      const imageRequest = fn && (native || namespace === 'image_gen') && name === 'imagegen';
      if (row.recordType === 'response_item' && row.payloadType === 'image_generation_call') {
        return imageRequest && row.parsed.payload.id === call.callId ? row : null;
      }
      if (row.recordType !== 'event_msg') return null;
      if (fn && isToolLifecycleFamily(row.payloadType, TOOL_LIFECYCLE_FAMILY.MCP_TOOL)) {
        const p = row.parsed.payload;
        const invocation = p.invocation;
        if (!invocation || invocation.environment_id != null || typeof invocation.server !== 'string'
            || !invocation.server || typeof invocation.tool !== 'string' || !invocation.tool) return null;
        const server = 'mcp__' + invocation.server;
        const flat = native && !invocation.server.includes('__') && !invocation.tool.includes('__')
          && name === server + '__' + invocation.tool;
        if (!flat && !(namespace === server && name === invocation.tool)) return null;
        const status = legacyMcpStatus(p);
        // Older native records carry their outcome in status or the lifecycle
        // subtype. Once the invocation matches, keep their normal dispatch.
        return status ? { ...row, status } : row;
      }
      if (fn && (native || ['collaboration', 'agents', 'multi_agent_v1'].includes(namespace))
          && isToolLifecycleFamily(row.payloadType, TOOL_LIFECYCLE_FAMILY.COLLABORATION)) {
        const sender = row.parsed.payload.sender_thread_id;
        if (sender != null && sender !== call.sessionId) return null;
        if ((name === 'wait' || name === 'wait_agent') && ['collab_waiting_begin', 'collab_waiting_end'].includes(row.payloadType)) {
          return waitReceiversMatch(call, row, native, pathWait) ? row : null;
        }
        if (name === 'send_message' && ['collab_agent_interaction_begin', 'collab_agent_interaction_end'].includes(row.payloadType)) {
          return legacyAgentMessageMatches(call, row.parsed.payload) ? row : null;
        }
        const actions = { spawn_agent: 'collab_agent_spawn', send_input: 'collab_agent_interaction', close_agent: 'collab_close' };
        if (!Object.hasOwn(actions, name)) return null;
        const action = actions[name];
        if (row.payloadType !== action + '_begin' && row.payloadType !== action + '_end') return null;
        return collaborationReceiverConflicts(name, commandArgsFromRaw(call), row.parsed.payload) ? null : row;
      }
      if (fn && isToolLifecycleFamily(row.payloadType, TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL)) {
        return dynamicToolPeer(call, row);
      }
      if (fn && isToolLifecycleFamily(row.payloadType, TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION)) {
        return imageRequest ? row : null;
      }
      if (!native) return null;
      if (fn && name === 'view_image' && row.payloadType === 'view_image_tool_call') return row;
      if (isToolLifecycleFamily(row.payloadType, TOOL_LIFECYCLE_FAMILY.PATCH)) {
        return name === 'apply_patch' || name === 'functions.apply_patch' ? row : null;
      }
      return fn && isToolLifecycleFamily(row.payloadType, TOOL_LIFECYCLE_FAMILY.COMMAND)
        && ['shell', 'shell_command', 'exec_command', 'write_stdin', 'functions.shell_command', 'functions.exec_command', 'functions.write_stdin'].includes(name) ? row : null;
    }

    function consumeScopedRequests(callId, group) {
      const requests = group.filter(raw => raw.recordType === 'response_item'
        && ['function_call', 'custom_tool_call'].includes(raw.payloadType));
      const scopedChannels = new Set(requests.filter(raw => raw.scopedRequest).map(raw => raw.payloadType));
      for (const channel of scopedChannels) {
        const calls = requests.filter(raw => raw.payloadType === channel);
        if (calls.length > 1) {
          for (const raw of calls) keepUnpaired(raw);
          continue;
        }
        const call = calls[0];
        const eligible = toolPeersInTurn(call, group, epochs, scopedRequestPeer);
        if (eligible.filter(raw => raw.payloadType === channel + '_output').length > 1) {
          keepUnpaired(call);
          continue;
        }
        const peers = [call, ...eligible];
        const event = buildToolLogicalEvent(callId, peers, [], epochs);
        if (requests.length > 1) event.id = `${call.sessionId}:logical:scoped-call:${call.line}`;
        logicalEvents.push(event);
        for (const raw of peers) consumed.add(raw.rawId);
      }
      // A reused ID alone cannot assign a lifecycle or receipt to the other wire channel.
      const remaining = requests.filter(raw => !consumed.has(raw.rawId));
      const owner = remaining.length === 1 ? remaining[0] : null;
      const unclaimed = group.filter(raw => !consumed.has(raw.rawId));
      const pathWait = { begins: new Set(), ends: new Set(), closed: false };
      // Process eligible rows in physical order so a later begin cannot revise an earlier end.
      let eligible = owner ? toolPeersInTurn(owner, unclaimed, epochs, (call, row) => remainingToolPeer(call, row, pathWait)) : [];
      if (pathWait.begins.size > 1) eligible = eligible.filter(row => !pathWait.begins.has(row.rawId));
      if (pathWait.ends.size > 1) eligible = eligible.filter(row => !pathWait.ends.has(row.rawId));
      const outputs = eligible.filter(raw => matchesToolOutput(owner, raw));
      const remainingPeers = owner ? [owner, ...eligible.filter(raw => outputs.length <= 1 || !matchesToolOutput(owner, raw))] : [];
      const ownedIds = new Set(remainingPeers.map(raw => raw.rawId));
      for (const raw of unclaimed) if (!ownedIds.has(raw.rawId)) keepUnpaired(raw);
      return remainingPeers;
    }

    for (const [callId, callGroup] of byCallId.entries()) {
      let group = callGroup.filter((raw) => !consumed.has(raw.rawId)).sort((a, b) => a.line - b.line);
      if (group.some(raw => raw.scopedRequest)) {
        group = consumeScopedRequests(callId, group);
      }
      const hasToolShape = group.some(isToolResponseItemRow)
        || group.some((raw) => raw.recordType === 'event_msg' && isToolLifecycleCallGroupType(raw.payloadType));
      if (!hasToolShape) continue;
      const hasAgentCoordinationOwner = group.some((raw) => raw.recordType === 'response_item'
        && ['function_call', 'custom_tool_call'].includes(raw.payloadType)
        && isAgentCoordinationTool(raw.toolName));
      const ownerCalls = group.filter((raw) => raw.recordType === 'response_item'
        && ['function_call', 'custom_tool_call'].includes(raw.payloadType));
      const groupRawIds = new Set(group.map((raw) => raw.rawId));
      const traceabilityRows = hasAgentCoordinationOwner && ownerCalls.length === 1
        ? (subAgentActivityByEventId.get(callId) || [])
          .filter((raw) => !consumed.has(raw.rawId) && !groupRawIds.has(raw.rawId)
            && raw.sessionId === ownerCalls[0].sessionId
            && (raw.parsed?.payload?.thread_id == null || raw.parsed.payload.thread_id === raw.sessionId)
            && epochs.get(raw.rawId)?.number === epochs.get(ownerCalls[0].rawId)?.number
            && (!raw.turnId || !ownerCalls[0].turnId || raw.turnId === ownerCalls[0].turnId))
          .sort((a, b) => a.line - b.line)
        : [];
      const logicalEvent = buildToolLogicalEvent(callId, group, traceabilityRows, epochs);
      logicalEvents.push(logicalEvent);
      if (logicalEvent.kind === 'goal' && ['create_goal', 'update_goal'].includes(logicalEvent.toolName)) {
        const functionCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
        const functionOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
        const signature = goalSnapshotSignature(
          goalToolState(group, logicalEvent.toolName, functionCall, functionOutput).snapshot,
        );
        if (signature) {
          if (!goalToolEventsBySignature.has(signature)) goalToolEventsBySignature.set(signature, []);
          goalToolEventsBySignature.get(signature).push({
            event: logicalEvent,
            startLine: group[0]?.line || 0,
            endLine: group[group.length - 1]?.line || 0,
            turnIds: [...new Set(group.map((raw) => raw.turnId).filter(Boolean))],
            matched: false,
          });
        }
      }
      for (const raw of group) consumed.add(raw.rawId);
      for (const raw of traceabilityRows) consumed.add(raw.rawId);
    }

    for (let i = 0; i < rawEvents.length; i += 1) {
      const raw = rawEvents[i];
      if (consumed.has(raw.rawId)) continue;
      const next = rawEvents[i + 1];
      const prev = rawEvents[i - 1];

      const history = historyFacts(raw);
      if (history) {
        const identityCount = realtimeIdentities.get(realtimeIdentity(raw));
        // Only admitted, persisted speech has a role. Recording and receipt facts do not.
        const speech = Boolean(history.role);
        const event = speech && identityCount === 1
          ? buildConversationEvent(`${raw.sessionId}:logical:realtime:${raw.line}`, `${history.role}_message`, history.role, raw.messageText, [raw])
          : buildProtocolEvent(raw, speech ? 'realtime_identity_conflict' : history.type);
        event.historyFacts = history;
        event.turnId = '';
        if (speech && event.layer === 'main') event.tags.push('realtime');
        logicalEvents.push(event);
        consumed.add(raw.rawId);
        continue;
      }

      const externalToolInput = externalToolInputFromRaw(raw);
      if (externalToolInput) {
        const attachmentSummary = attachmentSummaryForRaw(raw);
        const attachmentPreview = attachmentSummary?.previewText || '';
        logicalEvents.push(createLogicalEvent({
          id: `${raw.sessionId}:logical:external:${raw.line}`,
          timestamp: raw.timestamp,
          turnId: raw.turnId,
          kind: 'external_tool_input',
          subtype: 'external_tool_input',
          layer: 'main',
          role: 'tool',
          label: 'External tool input',
          preview: truncate([externalToolInput.text || externalToolInput.name, attachmentPreview]
            .filter(Boolean).join(' · ')),
          searchText: [externalToolInput.name, externalToolInput.namespace,
            codexFullSearchText(raw.parsed?.payload?.output) || externalToolInput.text, attachmentPreview]
            .filter(Boolean).join('\n'),
          rawRefs: [rawRef(raw)],
          channels: [raw.recordType],
        }));
        consumed.add(raw.rawId);
        continue;
      }

      const goalSnapshot = goalSnapshotFromRaw(raw);
      if (goalSnapshot) {
        const previousSnapshot = previousGoalSnapshots.get(goalSnapshot.identityKey);
        const transition = goalSnapshotTransition(previousSnapshot, goalSnapshot);
        previousGoalSnapshots.set(goalSnapshot.identityKey, goalSnapshot);
        const matchingToolEvent = nearestGoalToolEvent(
          goalToolEventsBySignature.get(goalSnapshotSignature(goalSnapshot)),
          raw,
        );
        if (matchingToolEvent) {
          mergeGoalSnapshotRef(matchingToolEvent, raw, goalSnapshot);
        } else if (transition) {
          logicalEvents.push(buildGoalSnapshotLogicalEvent(raw, goalSnapshot, transition));
        } else {
          logicalEvents.push(buildProtocolEvent(raw, 'thread_goal_updated'));
        }
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'user') {
        if (raw === sideBoundary) {
          logicalEvents.push(buildProtocolEvent(raw, 'side_conversation_boundary'));
          consumed.add(raw.rawId);
          continue;
        }
        const mirror = typedMirrors.get(raw.rawId);
        const origin = recordedUserTextOrigin(raw, mirror);
        const protocolSubtype = origin === 'submitted' ? ''
          : origin === 'heartbeat' ? 'meta_block' : classifyProtocolText(raw.messageText, raw.role);
        if (protocolSubtype === 'user_shell_command') {
          if (next && next.recordType === 'event_msg' && next.payloadType === 'user_message'
              && mirroredMessageTextMatches(raw.messageText, next.messageText)
              && mirroredAttachmentIdentityMatches(raw, next)) {
            logicalEvents.push(buildUserShellCommandEvent([raw, next]));
            consumed.add(raw.rawId);
            consumed.add(next.rawId);
            continue;
          }
          logicalEvents.push(buildUserShellCommandEvent(raw));
          consumed.add(raw.rawId);
          continue;
        }
        if (protocolSubtype) {
          logicalEvents.push(buildProtocolEvent(raw, protocolSubtype));
          consumed.add(raw.rawId);
          continue;
        }
        const sources = [raw];
        if (origin === 'submitted') {
          // This adjacent canonical completion supplies the recorded turn and
          // precedes any legacy mirror in the physical evidence list.
          sources.push(mirror);
          typedMirrors.delete(raw.rawId);
        }
        if (next && next.recordType === 'event_msg' && next.payloadType === 'user_message'
            && mirroredMessageTextMatches(raw.messageText, next.messageText)
            && mirroredAttachmentIdentityMatches(raw, next)) {
          sources.push(next);
          consumed.add(next.rawId);
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, sources));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'user_message') {
        if (prev && prev.recordType === 'response_item' && prev.payloadType === 'message' && prev.role === 'user'
            && mirroredMessageTextMatches(prev.messageText, raw.messageText)
            && mirroredAttachmentIdentityMatches(prev, raw)) {
          consumed.add(raw.rawId);
          continue;
        }
        const protocolSubtype = classifyProtocolText(raw.messageText, 'user');
        if (protocolSubtype === 'user_shell_command') {
          logicalEvents.push(buildUserShellCommandEvent(raw));
          consumed.add(raw.rawId);
          continue;
        }
        if (protocolSubtype) {
          logicalEvents.push(buildProtocolEvent(raw, protocolSubtype));
          consumed.add(raw.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'developer') {
        const protocolSubtype = classifyProtocolText(raw.messageText, 'developer');
        logicalEvents.push(protocolSubtype ? buildProtocolEvent(raw, protocolSubtype) : buildDeveloperMessageEvent(raw));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_message') {
        const asyncMessage = asyncAgentMessageFromRaw(raw);
        if (next && next.recordType === 'response_item' && next.payloadType === 'message' && next.role === 'assistant'
            && mirroredMessageTextMatches(next.messageText, raw.messageText)
            && mirroredAttachmentIdentityMatches(raw, next)) {
          const nextAsyncMessage = asyncAgentMessageFromRaw(next);
          const canMergeMirror = asyncMessage
            ? Boolean(nextAsyncMessage && asyncMessageRawIdentityMatches(raw, asyncMessage, next, nextAsyncMessage))
            : !nextAsyncMessage && mirroredAttachmentIdentityMatches(raw, next);
          if (canMergeMirror) {
            logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', next.messageText, [raw, next]));
            consumed.add(raw.rawId);
            consumed.add(next.rawId);
            continue;
          }
        }
        if (asyncMessage) {
          const event = buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]);
          logicalEvents.push(event);
          registerAsyncMessageOwner(raw, asyncMessage, event);
          consumed.add(raw.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'assistant') {
        const previousAsyncMessage = prev ? asyncAgentMessageFromRaw(prev) : null;
        const currentAsyncMessage = asyncAgentMessageFromRaw(raw);
        const canMergeMirror = prev
          && prev.recordType === 'event_msg'
          && prev.payloadType === 'agent_message'
          && mirroredMessageTextMatches(prev.messageText, raw.messageText)
          && mirroredAttachmentIdentityMatches(prev, raw)
          && (previousAsyncMessage
            ? Boolean(currentAsyncMessage && asyncMessageRawIdentityMatches(prev, previousAsyncMessage, raw, currentAsyncMessage))
            : !currentAsyncMessage);
        if (canMergeMirror) {
          consumed.add(raw.rawId);
          continue;
        }
        if (raw.messageText.startsWith('<proposed_plan>')) {
          logicalEvents.push(buildPlanArtifact(raw, null, raw.messageText));
          consumed.add(raw.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_reasoning') {
        if (next && next.recordType === 'response_item' && next.payloadType === 'reasoning' && relatedReasoning(raw.messageText, next.messageText)) {
          logicalEvents.push(buildReasoningEvent([raw, next], next.messageText || raw.messageText));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildReasoningEvent([raw], raw.messageText));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'response_item' && raw.payloadType === 'reasoning') {
        if (prev && prev.recordType === 'event_msg' && prev.payloadType === 'agent_reasoning' && relatedReasoning(prev.messageText, raw.messageText)) {
          consumed.add(raw.rawId);
          continue;
        }
        logicalEvents.push(buildReasoningEvent([raw], raw.messageText));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'item_completed' && raw.parsed.payload?.item?.type === 'Plan') {
        if (next && next.recordType === 'response_item' && next.payloadType === 'message' && next.role === 'assistant' && next.messageText.startsWith('<proposed_plan>')) {
          logicalEvents.push(buildPlanArtifact(raw, next, next.messageText));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildPlanArtifact(raw, null, raw.parsed.payload.item.text || raw.searchText));
        consumed.add(raw.rawId);
        continue;
      }

      const asyncMessage = asyncAgentMessageFromRaw(raw);
      if (raw.recordType === 'event_msg'
          && raw.payloadType === 'item_completed'
          && asyncMessage
          && asyncMessage.source === 'canonical') {
        if (!canonicalAsyncMessageOwnerMatches(raw)) {
          logicalEvents.push(buildProtocolEvent(raw, 'item_completed'));
          consumed.add(raw.rawId);
          continue;
        }
        const owner = findAsyncMessageOwner(raw, asyncMessage);
        if (owner) {
          owner.event.rawRefs.push(rawRef(raw));
          owner.event.channels = [...new Set([...owner.event.channels, raw.recordType])];
        } else {
          const event = buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', asyncMessage.text, [raw]);
          logicalEvents.push(event);
          registerAsyncMessageOwner(raw, asyncMessage, event);
        }
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && ['plan_update', 'plan_delta'].includes(raw.payloadType)) {
        logicalEvents.push(buildPlanUpdateEvent(raw));
        consumed.add(raw.rawId);
        continue;
      }

      if (isHookLifecycleRow(raw) && isToolLifecycleStandaloneType(raw.payloadType)) {
        logicalEvents.push(buildHookLogicalEvent(raw.line, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (isWebSearchCall(raw)) {
        const pairedEnd = webSearchRowsMatch(next, raw) ? next : null;
        const event = buildWebSearchEvent(raw, pairedEnd);
        logicalEvents.push(event);
        consumed.add(raw.rawId);
        if (pairedEnd) consumed.add(pairedEnd.rawId);
        continue;
      }

      if (isWebSearchEnd(raw)) {
        if (webSearchRowsMatch(raw, prev)) {
          consumed.add(raw.rawId);
          continue;
        }
        if (webSearchRowsMatch(raw, next)) {
          logicalEvents.push(buildWebSearchEvent(next, raw));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildWebSearchEvent(null, raw));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'session_meta') {
        logicalEvents.push(buildProtocolEvent(raw, 'session_meta'));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'turn_context') {
        logicalEvents.push(buildProtocolEvent(raw, 'turn_context'));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'token_count') {
        logicalEvents.push(buildProtocolEvent(raw, 'token_count'));
        if (rateLimitReachedType(raw.parsed?.payload)) {
          logicalEvents.push(buildLifecycleEvent(raw, 'usage_limit_warning', 'Usage limit reached', 'warning'));
        }
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && raw.payloadType === 'context_compacted') {
        const event = buildLifecycleEvent(raw, 'compaction', 'Context compacted', 'warning');
        // Legacy fanout carries no item ID. Accept only an adjacent, opposite
        // carrier in the same owner/turn; repeated typed IDs stay Protocol.
        if (next?.payloadType === 'context_compacted'
            && Boolean(raw.typedItemType) !== Boolean(next.typedItemType)
            && raw.sessionId === next.sessionId
            && (!raw.turnId || !next.turnId || raw.turnId === next.turnId)) {
          event.rawRefs.push(rawRef(next));
          consumed.add(next.rawId);
        }
        logicalEvents.push(event);
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && raw.payloadType === 'turn_aborted') {
        logicalEvents.push(buildLifecycleEvent(raw, 'abort', 'Turn aborted', 'error'));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && raw.payloadType === 'thread_rolled_back') {
        logicalEvents.push(buildLifecycleEvent(raw, 'rollback', 'Thread rolled back', 'warning'));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && ['warning', 'guardian_warning', 'stream_error'].includes(raw.payloadType)) {
        logicalEvents.push(buildProtocolWarningEvent(raw));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && raw.payloadType === 'error') {
        logicalEvents.push(buildLifecycleEvent(raw, 'error', 'Error', 'error'));
        consumed.add(raw.rawId);
        continue;
      }
      const reviewLifecycle = reviewLifecycleFromRaw(raw, { ownerId: raw.sessionId });
      if (reviewLifecycle) {
        const started = reviewLifecycle.phase === 'entered';
        logicalEvents.push(buildLifecycleEvent(
          raw,
          'review',
          started ? 'Review started' : 'Review completed',
          'normal',
          reviewLifecyclePreview(raw),
          reviewLifecycle.subtype,
        ));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg'
          && isToolLifecycleStandaloneType(raw.payloadType)
          && isToolLifecycleFamily(raw.payloadType, TOOL_LIFECYCLE_FAMILY.COLLABORATION)) {
        logicalEvents.push(buildLifecycleEvent(raw, 'subagent', 'Subagent', 'normal'));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && ['task_started', 'task_complete'].includes(raw.canonicalType)) {
        logicalEvents.push(buildProtocolEvent(raw, raw.canonicalType));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && ['thread_name_updated', 'item_completed'].includes(raw.canonicalType)) {
        logicalEvents.push(buildProtocolEvent(raw, raw.canonicalType));
        consumed.add(raw.rawId);
        continue;
      }

      logicalEvents.push(buildProtocolEvent(raw, raw.payloadType || raw.recordType, raw.payloadType || raw.recordType));
      consumed.add(raw.rawId);
    }

    for (const event of logicalEvents) {
      for (const ref of event.rawRefs.slice()) {
        const mirror = typedMirrors.get(ref.rawId);
        if (!mirror) continue;
        event.rawRefs.push(rawRef(mirror));
      }
      // rawRef resolves originalRaw: channels describe persisted provenance,
      // never the temporary record type used for semantic projection.
      event.channels = sanitizeLogicalEnvelopeValue([...new Set(event.rawRefs.map((ref) => ref.sourceRecordType))]);
    }
    const finalCodeModeFacts = deriveCodeModeFacts({
      projection: codeModeProjection,
      rawEvents,
      logicalEvents,
      lifecycleTypes: CODE_MODE_ASSOCIATION_EVENT_TYPES,
    });
    for (const facts of finalCodeModeFacts.operationFacts) {
      const event = logicalEvents.find((candidate) => candidate.id === facts.operationId);
      if (event?.codeModeOperation) {
        event.codeModeOperation = {
          ...event.codeModeOperation,
          eventRefs: facts.eventRefs,
          phaseEventRefs: facts.phaseEventRefs,
        };
      }
    }

    // Persisted realtime and positional controls carry source-position meaning.
    // Only these histories opt into line order; legacy timeline policy stays.
    const hasUntimestampedEvent = logicalEvents.some((event) => !event.timestamp || event.historyFacts);
    const rawOrder = new Map(rawEvents.map((raw, position) => [raw.rawId, position]));
    logicalEvents.sort((a, b) => {
      const al = rawOrder.get(a.rawRefs[0]?.rawId) ?? a.rawRefs[0]?.line ?? 0;
      const bl = rawOrder.get(b.rawRefs[0]?.rawId) ?? b.rawRefs[0]?.line ?? 0;
      if (!hasUntimestampedEvent) {
        const at = a.timestamp || '';
        const bt = b.timestamp || '';
        if (at !== bt) return at.localeCompare(bt);
      }
      return al - bl;
    });

    return logicalEvents;
  }

  return { buildLogicalEvents };
}

module.exports = {
  createCodexLogicalBuilder,
};
