'use strict';

function createCodexLogicalBuilder(deps) {
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
    protocolLabelFor,
    protocolPreviewFor,
  } = protocol;
  const {
    TOOL_LIFECYCLE_EVENT_TYPES,
    TOOL_LIFECYCLE_FAMILY,
    commandArgsFromRaw,
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
      functionCall?.output,
      functionOutput?.output,
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
        displayValue(snapshot.goal, 8000),
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
    const searchText = uniqueNonEmpty([event.searchText, displayValue(snapshot.goal, 8000)]).join('\n');
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
      searchParts = addUncoveredTextPart(searchParts, outputPart);
    }
    for (const touchedFile of touchedFiles || []) {
      searchParts = addUncoveredTextPart(searchParts, touchedFile);
    }
    return searchParts.join('\n');
  }

  function buildToolLogicalEvent(callId, group, traceabilityRows = []) {
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
    const functionOutputInfo = parseFormattedCommandOutput(functionOutput?.output);
    const customOutputObj = parseOutputEnvelope(customOutput?.output);

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
    const parts = [];

    const outcomeRows = group.filter(isToolOutcomeRow);
    const protocolStatus = String(outcomeRows.find((raw) => raw.status)?.status || '').toLowerCase();
    const declined = outcomeRows.some((raw) => /_declined$/.test(raw.payloadType) || String(raw.status || '').toLowerCase() === 'declined');
    const failed = outcomeRows.some((raw) => String(raw.status || '').toLowerCase() === 'failed');
    const imageCallCompleted = outcomeRows.some((raw) => raw.payloadType === 'image_generation_call'
      && ['completed', 'complete', 'success', 'succeeded'].includes(String(raw.status || '').toLowerCase()));
    const completed = outcomeRows.some((raw) => /_end$/.test(raw.payloadType)) || imageCallCompleted || Boolean(functionOutput || customOutput);
    const explicitIncomplete = !completed && !failed && !declined;

    const isCommandTool = toolName === 'shell_command' || execRows.length;

    if (execRows.length) {
      if (execEnd?.exitCode != null) outputStats.exitCode = execEnd.exitCode;
      if (execEnd?.durationMs) outputStats.durationMs = execEnd.durationMs;
    }
    if (functionCall && !isCommandTool) parts.push(functionCall.output);
    if (functionOutput && !isCommandTool) parts.push(functionOutput.output);
    if (customCall && !isCommandTool) parts.push(customCall.output);
    if (customOutput && !isCommandTool) parts.push(customOutput.output);
    if (mcpRows.length) parts.push(mcpRows.map((raw) => raw.searchText).join('\n'));
    if (imageRows.length) parts.push(imageRows.map((raw) => raw.searchText).join('\n'));
    if (dynamicRows.length) parts.push(dynamicRows.map((raw) => raw.searchText).join('\n'));
    if (approvalRows.length) parts.push(approvalRows.map((raw) => raw.searchText).join('\n'));
    if (hookRows.length) parts.push(hookRows.map((raw) => raw.searchText).join('\n'));
    if (collabRows.length) parts.push(collabRows.map((raw) => raw.searchText).join('\n'));

    if (isCommandTool) {
      kind = 'command';
      const args = commandArgsFromRaw(functionCall);
      const exitCode = numericExitCode(execEnd?.exitCode, functionOutputInfo?.exitCode, customOutputObj?.metadata?.exit_code);
      const commandText = execRows.find((raw) => raw.commandText)?.commandText || commandToText(args?.command);
      status = declined ? 'declined' : failed || (exitCode != null && exitCode !== 0) ? 'failed' : exitCode === 0 ? 'success' : explicitIncomplete ? 'incomplete' : protocolStatus || 'completed';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
      label = status === 'failed' ? 'Failed command' : status === 'declined' ? 'Declined command' : status === 'incomplete' ? 'Incomplete command' : 'Command';
      preview = truncate(commandText || functionCall?.output || group.find((raw) => raw.preview)?.preview || 'shell command');
      if (exitCode != null) outputStats.exitCode = exitCode;
      if (!outputStats.durationMs && customOutputObj?.metadata?.duration_seconds) {
        outputStats.durationMs = Math.round(Number(customOutputObj.metadata.duration_seconds) * 1000);
      }
      touchedFiles = touchFilesFromOutputText(firstNonEmpty(execEnd?.stdout, execEnd?.aggregatedOutput, functionOutputInfo?.output));
      parts.push(commandSearchText({
        commandText,
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
      preview = truncate(customCall?.output || customOutputObj?.output || 'js_repl');
      outputStats.exitCode = exitCode;
      outputStats.durationMs = execEnd?.durationMs || Math.round(Number(customOutputObj?.metadata?.duration_seconds || 0) * 1000);
    } else if (mcpRows.length || toolName.startsWith('mcp__')) {
      kind = 'mcp_call';
      label = 'MCP tool';
      preview = truncate(mcpEnd?.preview || group.find((raw) => raw.preview)?.preview || toolName);
      status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
      outputStats.durationMs = mcpEnd?.durationMs || 0;
    } else if (hookRows.length) {
      return buildHookLogicalEvent(`call:${callId}`, hookRows);
    } else if (collabRows.length || isAgentCoordinationTool(toolName)) {
      kind = AGENT_COORDINATION_KIND;
      const representativeRow = representativeToolLifecycleRow(collabRows);
      label = representativeRow ? groupedToolLifecycleLabel(representativeRow, toolName) : toolName;
      preview = truncate(representativeRow?.preview || functionCall?.output || functionOutput?.output || toolName || label);
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
      preview = truncate(functionCall?.output || functionOutput?.output || toolName);
      status = 'success';
    } else {
      preview = truncate(first.preview || toolName || 'Other tool call');
    }

    return createLogicalEvent({
      id: `${first.sessionId}:logical:call:${callId}`,
      timestamp: first.timestamp,
      turnId: first.turnId || '',
      kind,
      subtype: toolName || kind,
      layer: 'main',
      role: 'assistant',
      label,
      preview,
      searchText: parts.filter(Boolean).join('\n'),
      severity,
      status,
      toolName: toolName || kind,
      touchedFiles,
      outputStats,
      rawRefs,
      channels,
    });
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
    return createLogicalEvent({
      id,
      timestamp: raws[0].timestamp,
      turnId: raws.find((raw) => raw.turnId)?.turnId || '',
      kind,
      subtype: kind,
      layer: 'main',
      role,
      label: role === 'user' ? 'User message' : 'Assistant message',
      preview: truncate(text),
      searchText: text,
      severity: 'normal',
      status: '',
      rawRefs: raws.map(rawRef),
      channels: [...new Set(raws.map((raw) => raw.recordType))],
    });
  }

  function mirroredMessageTextMatches(left, right) {
    return String(left || '').trim() === String(right || '').trim();
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
      searchText: text,
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
      searchText: text || raw.searchText,
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

  function buildLogicalEvents(rawEvents) {
    const logicalEvents = [];
    const consumed = new Set();
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

    for (const raw of rawEvents) {
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

    for (const [callId, callGroup] of byCallId.entries()) {
      const group = callGroup.filter((raw) => !consumed.has(raw.rawId)).sort((a, b) => a.line - b.line);
      const hasToolShape = group.some(isToolResponseItemRow)
        || group.some((raw) => raw.recordType === 'event_msg' && isToolLifecycleCallGroupType(raw.payloadType));
      if (!hasToolShape) continue;
      const hasAgentCoordinationOwner = group.some((raw) => raw.recordType === 'response_item'
        && ['function_call', 'custom_tool_call'].includes(raw.payloadType)
        && isAgentCoordinationTool(raw.toolName));
      const groupRawIds = new Set(group.map((raw) => raw.rawId));
      const traceabilityRows = hasAgentCoordinationOwner
        ? (subAgentActivityByEventId.get(callId) || [])
          .filter((raw) => !consumed.has(raw.rawId) && !groupRawIds.has(raw.rawId))
          .sort((a, b) => a.line - b.line)
        : [];
      const logicalEvent = buildToolLogicalEvent(callId, group, traceabilityRows);
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
        const protocolSubtype = classifyProtocolText(raw.messageText, raw.role);
        if (protocolSubtype === 'user_shell_command') {
          if (next && next.recordType === 'event_msg' && next.payloadType === 'user_message' && mirroredMessageTextMatches(raw.messageText, next.messageText)) {
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
        if (next && next.recordType === 'event_msg' && next.payloadType === 'user_message' && mirroredMessageTextMatches(raw.messageText, next.messageText)) {
          logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, [raw, next]));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'user_message') {
        if (prev && prev.recordType === 'response_item' && prev.payloadType === 'message' && prev.role === 'user' && mirroredMessageTextMatches(prev.messageText, raw.messageText)) {
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
        if (next && next.recordType === 'response_item' && next.payloadType === 'message' && next.role === 'assistant' && mirroredMessageTextMatches(next.messageText, raw.messageText)) {
          logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', next.messageText, [raw, next]));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'assistant') {
        if (prev && prev.recordType === 'event_msg' && prev.payloadType === 'agent_message' && mirroredMessageTextMatches(prev.messageText, raw.messageText)) {
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
        logicalEvents.push(buildLifecycleEvent(raw, 'compaction', 'Context compacted', 'warning'));
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

    const hasUntimestampedEvent = logicalEvents.some((event) => !event.timestamp);
    logicalEvents.sort((a, b) => {
      const al = a.rawRefs[0]?.line || 0;
      const bl = b.rawRefs[0]?.line || 0;
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
