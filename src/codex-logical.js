'use strict';

function createCodexLogicalBuilder(deps) {
  const {
    envelope,
    protocol,
    tool,
    text,
    usage,
  } = deps;
  const {
    CANONICAL_SCHEMA_VERSION,
    CODEX_SOURCE_KIND,
    sanitizeLogicalEnvelopeValue,
    rawRef,
  } = envelope;
  const {
    classifyProtocolText,
    humanizeProtocolSubtype,
    protocolLabelFor,
    protocolPreviewFor,
  } = protocol;
  const {
    TOOL_EVENT_TYPES,
    commandArgsFromRaw,
    commandToText,
    inferPatchSuccess,
    isFiniteNumberValue,
    numericExitCode,
    parseFormattedCommandOutput,
    parseOutputEnvelope,
    patchFilesFromPatchInput,
    touchFilesFromOutputText,
  } = tool;
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
      source: rawRefs[0] || fields.source,
      sourceLocator: rawRefs[0]?.sourceLocator || fields.sourceLocator || null,
    };
  }

  function toolLifecycleRank(raw) {
    const type = String(raw?.payloadType || '');
    if (/_declined$/.test(type)) return 4;
    if (/_end$/.test(type)) return 3;
    if (/(?:_update|_delta)$/.test(type)) return 2;
    if (/_begin$/.test(type)) return 1;
    return 0;
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

  function buildToolLogicalEvent(callId, group) {
    const rawRefs = group.map(rawRef);
    const channels = [...new Set(group.map((raw) => raw.recordType))];
    const first = group[0];
    const functionCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call');
    const functionOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'function_call_output');
    const customCall = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call');
    const customOutput = group.find((raw) => raw.recordType === 'response_item' && raw.payloadType === 'custom_tool_call_output');
    const execRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('exec_command_'));
    const patchRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('patch_apply_'));
    const mcpRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('mcp_tool_call_'));
    const imageRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('image_generation_call_'));
    const dynamicRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('dynamic_tool_call_'));
    const approvalRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('approval_request_'));
    const hookRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('hook_'));
    const collabRows = group.filter((raw) => raw.recordType === 'event_msg' && raw.payloadType.startsWith('collab_'));
    const execEnd = execRows.find((raw) => raw.payloadType === 'exec_command_end');
    const patchEnd = patchRows.find((raw) => raw.payloadType === 'patch_apply_end');
    const mcpEnd = mcpRows.find((raw) => raw.payloadType === 'mcp_tool_call_end');

    const protocolToolName = group.find((raw) => raw.toolName)?.toolName || '';
    const toolName = customCall?.toolName || functionCall?.toolName || protocolToolName || '';
    const functionOutputInfo = parseFormattedCommandOutput(functionOutput?.output);
    const customOutputObj = parseOutputEnvelope(customOutput?.output);

    let kind = 'other_tool_call';
    let label = toolName || 'Other tool call';
    let preview = truncate(toolName || 'Other tool call');
    let status = 'completed';
    let severity = 'normal';
    let touchedFiles = [];
    const outputStats = {};
    const parts = [];

    const protocolStatus = String(group.find((raw) => raw.status)?.status || '').toLowerCase();
    const declined = group.some((raw) => /_declined$/.test(raw.payloadType) || String(raw.status || '').toLowerCase() === 'declined');
    const failed = group.some((raw) => String(raw.status || '').toLowerCase() === 'failed');
    const completed = group.some((raw) => /_end$/.test(raw.payloadType)) || Boolean(functionOutput || customOutput);
    const explicitIncomplete = !completed && !failed && !declined;

    if (execRows.length) {
      const execText = execRows.map((raw) => [raw.commandText, raw.stdout, raw.stderr, raw.aggregatedOutput, raw.searchText].filter(Boolean).join('\n')).join('\n');
      parts.push(execText);
      if (execEnd?.exitCode != null) outputStats.exitCode = execEnd.exitCode;
      if (execEnd?.durationMs) outputStats.durationMs = execEnd.durationMs;
    }
    if (functionCall) parts.push(functionCall.output);
    if (functionOutput) parts.push(functionOutput.output);
    if (customCall) parts.push(customCall.output);
    if (customOutput) parts.push(customOutput.output);
    if (mcpRows.length) parts.push(mcpRows.map((raw) => raw.searchText).join('\n'));
    if (imageRows.length) parts.push(imageRows.map((raw) => raw.searchText).join('\n'));
    if (dynamicRows.length) parts.push(dynamicRows.map((raw) => raw.searchText).join('\n'));
    if (approvalRows.length) parts.push(approvalRows.map((raw) => raw.searchText).join('\n'));
    if (hookRows.length) parts.push(hookRows.map((raw) => raw.searchText).join('\n'));
    if (collabRows.length) parts.push(collabRows.map((raw) => raw.searchText).join('\n'));

    if (toolName === 'shell_command' || execRows.length) {
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
    } else if (imageRows.length || dynamicRows.length || approvalRows.length || hookRows.length || collabRows.length) {
      kind = 'other_tool_call';
      const representativeRow = representativeToolLifecycleRow([...imageRows, ...dynamicRows, ...approvalRows, ...hookRows, ...collabRows]);
      label = humanizeProtocolSubtype(representativeRow?.payloadType || toolName || 'Other tool call');
      preview = truncate(representativeRow?.preview || group.find((raw) => raw.preview)?.preview || toolName || label);
      status = declined ? 'declined' : failed ? 'failed' : explicitIncomplete ? 'incomplete' : 'success';
      severity = status === 'failed' ? 'error' : status === 'declined' || status === 'incomplete' ? 'warning' : 'normal';
    } else if (toolName === 'request_user_input' || toolName === 'update_plan' || toolName === 'view_image' || toolName === 'spawn_agent' || toolName === 'wait_agent' || toolName === 'send_input' || toolName === 'close_agent' || toolName === 'js_repl_reset') {
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

  function buildLifecycleEvent(raw, kind, label, severity, previewOverride = '') {
    const tokenUsage = kind === 'usage_limit_warning' ? tokenUsageItems(raw.parsed?.payload) : [];
    const usageLimits = kind === 'usage_limit_warning' ? collectUsageLimitItems(raw.parsed?.payload) : [];
    const reachedType = kind === 'usage_limit_warning' ? rateLimitReachedType(raw.parsed?.payload) : '';
    return createLogicalEvent({
      id: `${raw.sessionId}:logical:${kind}:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind,
      subtype: raw.payloadType || kind,
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
    const payload = raw.parsed?.payload || {};
    if (raw.payloadType === 'entered_review_mode') {
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

    for (const raw of rawEvents) {
      if (raw.callId) {
        if (!byCallId.has(raw.callId)) byCallId.set(raw.callId, []);
        byCallId.get(raw.callId).push(raw);
      }
    }

    for (const [callId, group] of byCallId.entries()) {
      group.sort((a, b) => a.line - b.line);
      const hasToolShape = group.some((raw) => raw.recordType === 'response_item' && ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(raw.payloadType))
        || group.some((raw) => raw.recordType === 'event_msg' && TOOL_EVENT_TYPES.has(raw.payloadType));
      if (!hasToolShape) continue;
      logicalEvents.push(buildToolLogicalEvent(callId, group));
      for (const raw of group) consumed.add(raw.rawId);
    }

    for (let i = 0; i < rawEvents.length; i += 1) {
      const raw = rawEvents[i];
      if (consumed.has(raw.rawId)) continue;
      const next = rawEvents[i + 1];
      const prev = rawEvents[i - 1];

      if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'user') {
        const protocolSubtype = classifyProtocolText(raw.messageText, raw.role);
        if (protocolSubtype) {
          logicalEvents.push(buildProtocolEvent(raw, protocolSubtype));
          consumed.add(raw.rawId);
          continue;
        }
        if (next && next.recordType === 'event_msg' && next.payloadType === 'user_message' && raw.messageText === next.messageText) {
          logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', next.messageText, [raw, next]));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:user:${raw.line}`, 'user_message', 'user', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'user_message') {
        if (prev && prev.recordType === 'response_item' && prev.payloadType === 'message' && prev.role === 'user' && prev.messageText === raw.messageText) {
          consumed.add(raw.rawId);
          continue;
        }
        const protocolSubtype = classifyProtocolText(raw.messageText, 'user');
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
        logicalEvents.push(buildProtocolEvent(raw, classifyProtocolText(raw.messageText, 'developer') || 'developer_instruction'));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'event_msg' && raw.payloadType === 'agent_message') {
        if (next && next.recordType === 'response_item' && next.payloadType === 'message' && next.role === 'assistant' && next.messageText === raw.messageText) {
          logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw, next]));
          consumed.add(raw.rawId);
          consumed.add(next.rawId);
          continue;
        }
        logicalEvents.push(buildConversationEvent(`${raw.sessionId}:logical:assistant:${raw.line}`, 'assistant_message', 'assistant', raw.messageText, [raw]));
        consumed.add(raw.rawId);
        continue;
      }

      if (raw.recordType === 'response_item' && raw.payloadType === 'message' && raw.role === 'assistant') {
        if (prev && prev.recordType === 'event_msg' && prev.payloadType === 'agent_message' && prev.messageText === raw.messageText) {
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
      if (raw.recordType === 'event_msg' && raw.payloadType === 'entered_review_mode') {
        logicalEvents.push(buildLifecycleEvent(raw, 'review', 'Review started', 'normal', reviewLifecyclePreview(raw)));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && raw.payloadType === 'exited_review_mode') {
        logicalEvents.push(buildLifecycleEvent(raw, 'review', 'Review completed', 'normal', reviewLifecyclePreview(raw)));
        consumed.add(raw.rawId);
        continue;
      }
      if (raw.recordType === 'event_msg' && ['collab_agent_spawn_end', 'collab_agent_interaction_end', 'collab_waiting_end', 'collab_close_end'].includes(raw.payloadType)) {
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
