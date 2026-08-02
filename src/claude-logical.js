'use strict';

function createClaudeLogicalBuilder(deps) {
  const {
    CANONICAL_SCHEMA_VERSION,
    CLAUDE_SOURCE_KIND,
    blockText,
    rawRef,
    stringifyValue,
    truncate,
  } = deps;

  function humanize(value) {
    const text = String(value || '').replace(/[_-]+/g, ' ').trim();
    return text ? `${text[0].toUpperCase()}${text.slice(1)}` : 'Protocol';
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function uniqueRawRefs(raws) {
    const refs = [];
    const seen = new Set();
    for (const raw of raws.filter(Boolean)) {
      if (seen.has(raw.rawId)) continue;
      seen.add(raw.rawId);
      refs.push(rawRef(raw));
    }
    return refs.sort((left, right) => Number(left.line || 0) - Number(right.line || 0));
  }

  function createEvent(fields) {
    const rawRefs = uniqueRawRefs(fields.raws || []);
    const preview = String(fields.preview || '').trim();
    const searchText = String(fields.searchText || preview).trim();
    return {
      id: fields.id,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sourceKind: CLAUDE_SOURCE_KIND,
      timestamp: fields.timestamp || '',
      turnId: fields.turnId || '',
      kind: fields.kind || 'event',
      subtype: fields.subtype || '',
      layer: fields.layer || 'main',
      role: fields.role || '',
      label: fields.label || humanize(fields.kind),
      preview,
      searchText,
      severity: fields.severity || 'normal',
      status: fields.status || '',
      toolName: fields.toolName || '',
      hasLongOutput: preview.length > 800 || searchText.length > 1600,
      hasReadableReasoning: Boolean(fields.hasReadableReasoning),
      touchedFiles: unique(fields.touchedFiles || []),
      outputStats: fields.outputStats || {},
      tokenUsage: fields.tokenUsage || [],
      usageLimits: fields.usageLimits || [],
      rawRefs,
      channels: unique(fields.channels || (fields.raws || []).map((raw) => raw.recordType)),
      tags: unique(fields.tags || []),
      source: rawRefs[0] || null,
      sourceLocator: rawRefs[0]?.sourceLocator || null,
      _sourceOrder: fields.sourceOrder || 0,
      ...(fields.callId ? { callId: fields.callId } : {}),
      ...(fields.agentId ? { agentId: fields.agentId } : {}),
      ...(fields.messageId ? { messageId: fields.messageId } : {}),
      ...(fields.blockIndex != null ? { blockIndex: fields.blockIndex } : {}),
    };
  }

  function resolveTurnIds(raws) {
    const byUuid = new Map(raws.filter((raw) => raw.uuid).map((raw) => [raw.uuid, raw]));
    const memo = new Map();
    function resolve(raw, visiting = new Set()) {
      if (!raw) return '';
      if (raw.promptId) return raw.promptId;
      if (memo.has(raw.rawId)) return memo.get(raw.rawId);
      if (!raw.parentUuid || visiting.has(raw.uuid)) return '';
      visiting.add(raw.uuid);
      const value = resolve(byUuid.get(raw.parentUuid), visiting);
      memo.set(raw.rawId, value);
      return value;
    }
    for (const raw of raws) raw.turnId = resolve(raw);
  }

  function resultStatus(match) {
    if (!match) return 'incomplete';
    const { raw: result, result: resultBlock } = match;
    if (result.toolDenialKind || resultBlock.status === 'declined') return 'declined';
    if (resultBlock.isError || resultBlock.status === 'failed') return 'failed';
    if (result.exitCode != null && result.exitCode !== 0) return 'failed';
    return 'success';
  }

  function toolKind(name) {
    const normalized = String(name || '').toLowerCase();
    if (normalized === 'bash') return 'command';
    if (['write', 'edit', 'multiedit', 'notebookedit'].includes(normalized)) return 'patch';
    if (['websearch', 'webfetch'].includes(normalized)) return 'web_search';
    if (normalized === 'agent') return 'agent_coordination';
    if (/^(mcp__|mcp:)/.test(normalized)) return 'mcp_call';
    return 'other_tool_call';
  }

  function toolLabel(kind, name, status) {
    if (kind === 'command') {
      if (status === 'failed') return 'Failed command';
      if (status === 'declined') return 'Declined command';
      if (status === 'incomplete') return 'Incomplete command';
      return 'Command';
    }
    if (kind === 'patch') {
      if (status === 'failed') return 'Patch failed';
      if (status === 'declined') return 'Patch declined';
      if (status === 'incomplete') return 'Incomplete patch';
      return 'Patch applied';
    }
    if (kind === 'web_search') return String(name).toLowerCase() === 'webfetch' ? 'Web fetch' : 'Web search';
    if (kind === 'agent_coordination') return 'Agent coordination';
    if (kind === 'mcp_call') return 'MCP call';
    return 'Other tool call';
  }

  function toolPreview(call, kind) {
    const input = call.input || {};
    if (kind === 'command') return truncate(input.command || input.description || call.name);
    if (kind === 'patch') return truncate(input.file_path || input.filePath || input.path || input.notebook_path || call.name);
    if (kind === 'web_search') return truncate(input.query || input.url || input.prompt || call.name);
    if (kind === 'agent_coordination') return truncate(input.description || input.prompt || input.subagent_type || call.name);
    return truncate(input.description || input.query || input.path || input.file_path || stringifyValue(input, 4000) || call.name);
  }

  function attachmentToolUseId(raw) {
    const attachment = raw?.parsed?.attachment;
    return String(attachment?.toolUseID || attachment?.toolUseId || attachment?.tool_use_id || '');
  }

  function fileDeltaMessageId(raw) {
    const record = raw?.parsed || {};
    return String(record.messageId || record.messageID || record.sourceToolAssistantUUID || '');
  }

  function appendIndexedValue(index, key, value) {
    if (!key) return;
    const matches = index.get(key) || [];
    matches.push(value);
    index.set(key, matches);
  }

  function buildSupplementalIndex(raws) {
    const fileHistoryByMessageId = new Map();
    const attachmentsByCallId = new Map();
    for (const raw of raws) {
      if (raw.recordType === 'file-history-delta') {
        appendIndexedValue(fileHistoryByMessageId, fileDeltaMessageId(raw), raw);
      } else if (raw.recordType === 'attachment') {
        appendIndexedValue(attachmentsByCallId, attachmentToolUseId(raw), raw);
      }
    }
    return { attachmentsByCallId, fileHistoryByMessageId };
  }

  function supplementalRowsForCall(index, callRaw, callId, callIdentityUnique) {
    const rows = [];
    if (callRaw.toolCalls.length === 1 && callRaw.uuid) {
      rows.push(...(index.fileHistoryByMessageId.get(callRaw.uuid) || []));
    }
    if (callId && callIdentityUnique) {
      rows.push(...(index.attachmentsByCallId.get(callId) || []));
    }
    const seen = new Set();
    return rows.filter((raw) => {
      if (seen.has(raw.rawId)) return false;
      seen.add(raw.rawId);
      return true;
    });
  }

  function blockIdentity(raw, blockIndex) {
    return `${raw.rawId}:block:${blockIndex}`;
  }

  function blockComesAfter(resultMatch, callMatch) {
    if (resultMatch.raw.rawIndex !== callMatch.raw.rawIndex) {
      return resultMatch.raw.rawIndex > callMatch.raw.rawIndex;
    }
    return resultMatch.result.blockIndex > callMatch.call.blockIndex;
  }

  function buildToolCorrelation(raws) {
    const callByBlock = new Map();
    const callsById = new Map();
    const resultsById = new Map();
    for (const raw of raws) {
      for (const call of raw.toolCalls || []) {
        const match = { raw, call };
        callByBlock.set(blockIdentity(raw, call.blockIndex), match);
        if (call.id) appendIndexedValue(callsById, call.id, match);
      }
      for (const result of raw.toolResults || []) {
        if (result.id) appendIndexedValue(resultsById, result.id, { raw, result });
      }
    }

    const uniqueCallIds = new Set();
    const resultByCallBlock = new Map();
    const matchedResultBlocks = new Set();
    for (const [callId, calls] of callsById) {
      if (calls.length !== 1) continue;
      uniqueCallIds.add(callId);
      const results = resultsById.get(callId) || [];
      if (results.length !== 1 || !blockComesAfter(results[0], calls[0])) continue;
      const callKey = blockIdentity(calls[0].raw, calls[0].call.blockIndex);
      const resultKey = blockIdentity(results[0].raw, results[0].result.blockIndex);
      resultByCallBlock.set(callKey, results[0]);
      matchedResultBlocks.add(resultKey);
    }
    return {
      callByBlock,
      matchedResultBlocks,
      resultByCallBlock,
      uniqueCallIds,
    };
  }

  function deltaTouchedFiles(rows) {
    return rows.flatMap((raw) => {
      const record = raw.parsed || {};
      return [
        record.trackingPath,
        record.filePath,
        record.file_path,
        record.path,
      ].filter((value) => typeof value === 'string' && value.trim());
    });
  }

  function toolResultText(match) {
    if (!match) return '';
    const { raw, result } = match;
    const block = raw.contentBlocks[result.blockIndex];
    return blockText(block) || raw.output || stringifyValue(raw.toolUseResult);
  }

  function buildToolEvent(callRaw, call, resultMatch, supplements) {
    const kind = toolKind(call.name);
    const result = resultMatch?.raw;
    const status = resultStatus(resultMatch);
    const severity = status === 'failed' ? 'error' : ['declined', 'incomplete'].includes(status) ? 'warning' : 'normal';
    const resultText = toolResultText(resultMatch);
    const structuredResult = result?.toolUseResult;
    const agentId = String(structuredResult?.agentId || result?.agentId || '');
    const touchedFiles = [
      ...(callRaw.touchedFiles || []),
      ...deltaTouchedFiles(supplements),
    ];
    const raws = [callRaw, result, ...supplements];
    return createEvent({
      id: `${callRaw.sessionId}:logical:tool:${callRaw.line}:${call.blockIndex}${call.id ? `:${call.id}` : ''}`,
      timestamp: callRaw.timestamp,
      turnId: callRaw.turnId || result?.turnId || '',
      kind,
      subtype: call.name,
      layer: 'main',
      role: 'assistant',
      label: toolLabel(kind, call.name, status),
      preview: toolPreview(call, kind),
      searchText: [
        call.name,
        stringifyValue(call.input),
        resultText,
        stringifyValue(structuredResult),
        result?.toolDenialKind,
      ].filter(Boolean).join('\n'),
      severity,
      status,
      toolName: call.name,
      touchedFiles,
      outputStats: {
        exitCode: result?.exitCode ?? null,
        durationMs: result?.durationMs || 0,
      },
      raws,
      channels: raws.map((raw) => raw?.recordType),
      sourceOrder: callRaw.rawIndex * 100 + call.blockIndex,
      callId: call.id,
      agentId,
      blockIndex: call.blockIndex,
      tags: agentId ? ['subagent'] : [],
    });
  }

  function isLocalCommandEnvelope(raw) {
    if (raw.recordType !== 'user' || raw.contentBlocks.length !== 1) return false;
    const [block] = raw.contentBlocks;
    if (block.type !== 'text') return false;
    const text = blockText(block).trim();
    if (/^<local-command-([a-z][a-z-]*)>[\s\S]*<\/local-command-\1>$/u.test(text)) return true;
    return /^<command-name>[\s\S]*?<\/command-name>(?:\s*<command-message>[\s\S]*?<\/command-message>)?(?:\s*<command-args>[\s\S]*?<\/command-args>)?$/u.test(text);
  }

  function isHumanUserRaw(raw) {
    if (raw.recordType !== 'user') return false;
    if (raw.isMeta || raw.isCompactSummary || raw.originKind === 'task-notification') return false;
    if (raw.contentBlocks.some((block) => block.type === 'tool_result')) return false;
    if (isLocalCommandEnvelope(raw)) return false;
    return raw.contentBlocks.some((block) => block.type === 'text' && blockText(block).trim());
  }

  function messageEvent(raw, block, blockIndex, role) {
    const text = blockText(block);
    return createEvent({
      id: `${raw.sessionId}:logical:${role}:${raw.line}:${blockIndex}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: role === 'user' ? 'user_message' : 'assistant_message',
      subtype: 'text',
      layer: 'main',
      role,
      label: role === 'user' ? 'User message' : 'Assistant message',
      preview: truncate(text),
      searchText: text,
      raws: [raw],
      sourceOrder: raw.rawIndex * 100 + blockIndex,
      messageId: raw.messageId,
      blockIndex,
    });
  }

  function reasoningEvent(raw, block, blockIndex) {
    const text = blockText(block);
    return createEvent({
      id: `${raw.sessionId}:logical:reasoning:${raw.line}:${blockIndex}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: 'reasoning',
      subtype: 'thinking',
      layer: 'main',
      role: 'assistant',
      label: 'Reasoning',
      preview: truncate(text),
      searchText: text,
      hasReadableReasoning: Boolean(text.trim()),
      raws: [raw],
      sourceOrder: raw.rawIndex * 100 + blockIndex,
      messageId: raw.messageId,
      blockIndex,
    });
  }

  function apiErrorEvent(raw) {
    const text = raw.contentBlocks.map((block) => blockText(block)).filter(Boolean).join('\n');
    return createEvent({
      id: `${raw.sessionId}:logical:error:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: 'error',
      subtype: String(raw.parsed?.error || raw.payloadType || 'api_error'),
      layer: 'main',
      role: 'assistant',
      label: 'Error',
      preview: truncate(text || raw.parsed?.error || 'Claude API error'),
      searchText: [text, raw.parsed?.error, raw.parsed?.apiErrorStatus].filter(Boolean).join('\n'),
      severity: 'error',
      status: 'failed',
      raws: [raw],
      sourceOrder: raw.rawIndex * 100,
    });
  }

  function abortEvent(raw) {
    return createEvent({
      id: `${raw.sessionId}:logical:abort:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: 'abort',
      subtype: 'interrupted_by_shutdown',
      layer: 'main',
      role: 'system',
      label: 'Turn aborted',
      preview: 'Claude Code shut down before the turn completed.',
      searchText: 'interrupted by shutdown',
      severity: 'warning',
      status: 'incomplete',
      raws: [raw],
      sourceOrder: raw.rawIndex * 100 + 98,
    });
  }

  function informationalEvent(raw) {
    const level = String(raw.parsed?.level || '').toLowerCase();
    const kind = level === 'error' ? 'error' : level === 'warning' || level === 'warn' ? 'warning' : 'protocol';
    const layer = kind === 'protocol' ? 'protocol' : 'main';
    return createEvent({
      id: `${raw.sessionId}:logical:${kind}:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind,
      subtype: 'informational',
      layer,
      role: 'system',
      label: kind === 'error' ? 'Error' : kind === 'warning' ? 'Warning' : 'Informational',
      preview: truncate(raw.parsed?.content || raw.preview),
      searchText: raw.searchText,
      severity: kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : 'normal',
      status: kind === 'error' ? 'failed' : '',
      raws: [raw],
      sourceOrder: raw.rawIndex * 100,
    });
  }

  function protocolEvent(raw) {
    const subtype = isLocalCommandEnvelope(raw) ? 'local_command' : raw.payloadType || raw.recordType;
    return createEvent({
      id: `${raw.sessionId}:logical:protocol:${raw.line}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: 'protocol',
      subtype,
      layer: 'protocol',
      role: raw.role || 'system',
      label: humanize(subtype),
      preview: raw.preview,
      searchText: raw.searchText,
      severity: raw.toolDenialKind ? 'warning' : 'normal',
      status: raw.status,
      raws: [raw],
      sourceOrder: raw.rawIndex * 100,
    });
  }

  function protocolBlockEvent(raw, block, blockIndex, requestedSubtype = '') {
    const blockType = String(block?.type || 'unknown_block');
    const subtype = requestedSubtype || `${raw.recordType || 'record'}_${blockType}`;
    const text = blockText(block);
    const structured = stringifyValue(block);
    const failed = block?.is_error === true;
    return createEvent({
      id: `${raw.sessionId}:logical:protocol:${raw.line}:${blockIndex}`,
      timestamp: raw.timestamp,
      turnId: raw.turnId,
      kind: 'protocol',
      subtype,
      layer: 'protocol',
      role: raw.role || 'system',
      label: subtype === 'unmatched_tool_result' ? 'Unmatched tool result' : humanize(subtype),
      preview: truncate(text || structured || subtype),
      searchText: [text, structured].filter(Boolean).join('\n'),
      severity: failed || raw.toolDenialKind ? 'warning' : 'normal',
      status: failed ? 'failed' : '',
      raws: [raw],
      sourceOrder: raw.rawIndex * 100 + blockIndex,
      blockIndex,
    });
  }

  function compactGroups(raws) {
    const boundaries = raws.filter((raw) => raw.recordType === 'system' && raw.payloadType === 'compact_boundary');
    const groups = new Map();
    for (let index = 0; index < boundaries.length; index += 1) {
      const boundary = boundaries[index];
      const nextLine = boundaries[index + 1]?.line || Number.POSITIVE_INFINITY;
      const summary = raws.find((raw) => raw.isCompactSummary && raw.line > boundary.line && raw.line < nextLine);
      const reference = raws.find((raw) => (
        raw.recordType === 'attachment'
        && raw.payloadType === 'compact_file_reference'
        && raw.line > boundary.line
        && raw.line < nextLine
      ));
      groups.set(boundary.rawId, [boundary, summary, reference].filter(Boolean));
    }
    return groups;
  }

  function compactionEvent(boundary, group) {
    const metadata = boundary.parsed?.compactMetadata || {};
    const summary = group.find((raw) => raw.isCompactSummary);
    const preview = [
      metadata.trigger ? `${metadata.trigger} compaction` : 'Conversation compacted',
      Number.isFinite(Number(metadata.preTokens)) && Number.isFinite(Number(metadata.postTokens))
        ? `${metadata.preTokens} → ${metadata.postTokens} tokens`
        : '',
    ].filter(Boolean).join(' - ');
    return createEvent({
      id: `${boundary.sessionId}:logical:compaction:${boundary.line}`,
      timestamp: boundary.timestamp,
      turnId: boundary.turnId,
      kind: 'compaction',
      subtype: String(metadata.trigger || 'compact_boundary'),
      layer: 'main',
      role: 'system',
      label: 'Compaction',
      preview,
      searchText: [
        stringifyValue(metadata),
        summary?.messageText,
        ...group.map((raw) => raw.searchText),
      ].filter(Boolean).join('\n'),
      status: 'completed',
      raws: group,
      sourceOrder: boundary.rawIndex * 100,
    });
  }

  function buildLogicalEvents(raws) {
    resolveTurnIds(raws);
    const events = [];
    const consumedRawIds = new Set();
    const supplementalIndex = buildSupplementalIndex(raws);
    const toolCorrelation = buildToolCorrelation(raws);
    const compactByBoundary = compactGroups(raws);
    for (const group of compactByBoundary.values()) {
      for (const raw of group.slice(1)) consumedRawIds.add(raw.rawId);
    }

    for (const raw of raws) {
      if (consumedRawIds.has(raw.rawId)) continue;

      if (raw.recordType === 'assistant') {
        if (raw.isApiErrorMessage) {
          events.push(apiErrorEvent(raw));
          continue;
        }
        if (raw.isSynthetic) {
          events.push(protocolEvent(raw));
          continue;
        }
        let projectedBlockCount = 0;
        raw.contentBlocks.forEach((block, blockIndex) => {
          if (block.type === 'thinking') {
            events.push(reasoningEvent(raw, block, blockIndex));
            projectedBlockCount += 1;
          } else if (block.type === 'text' && blockText(block).trim()) {
            events.push(messageEvent(raw, block, blockIndex, 'assistant'));
            projectedBlockCount += 1;
          } else if (block.type === 'tool_use') {
            const callKey = blockIdentity(raw, blockIndex);
            const callMatch = toolCorrelation.callByBlock.get(callKey);
            if (!callMatch) {
              events.push(protocolBlockEvent(raw, block, blockIndex));
              projectedBlockCount += 1;
              return;
            }
            const { call } = callMatch;
            const resultMatch = toolCorrelation.resultByCallBlock.get(callKey);
            const supplements = supplementalRowsForCall(
              supplementalIndex,
              raw,
              call.id,
              toolCorrelation.uniqueCallIds.has(call.id),
            );
            for (const supplement of supplements) consumedRawIds.add(supplement.rawId);
            events.push(buildToolEvent(raw, call, resultMatch, supplements));
            projectedBlockCount += 1;
          } else {
            events.push(protocolBlockEvent(raw, block, blockIndex));
            projectedBlockCount += 1;
          }
        });
        if (!projectedBlockCount) events.push(protocolEvent(raw));
        continue;
      }

      if (raw.recordType === 'user') {
        if (raw.toolResults?.length) {
          if (!raw.contentBlocks.length) events.push(protocolEvent(raw));
          raw.contentBlocks.forEach((block, blockIndex) => {
            if (
              block.type === 'tool_result'
              && toolCorrelation.matchedResultBlocks.has(blockIdentity(raw, blockIndex))
            ) return;
            events.push(protocolBlockEvent(
              raw,
              block,
              blockIndex,
              block.type === 'tool_result' ? 'unmatched_tool_result' : '',
            ));
          });
          continue;
        }
        if (isHumanUserRaw(raw)) {
          raw.contentBlocks.forEach((block, blockIndex) => {
            if (block.type === 'text' && blockText(block).trim()) {
              events.push(messageEvent(raw, block, blockIndex, 'user'));
            } else if (block.type !== 'text') {
              events.push(protocolBlockEvent(raw, block, blockIndex));
            }
          });
          if (raw.interruptedByShutdown) events.push(abortEvent(raw));
        } else {
          events.push(protocolEvent(raw));
        }
        continue;
      }

      if (raw.recordType === 'system' && raw.payloadType === 'compact_boundary') {
        events.push(compactionEvent(raw, compactByBoundary.get(raw.rawId) || [raw]));
        continue;
      }
      if (raw.recordType === 'system' && raw.payloadType === 'informational') {
        events.push(informationalEvent(raw));
        continue;
      }
      events.push(protocolEvent(raw));
    }

    return events
      .sort((left, right) => left._sourceOrder - right._sourceOrder || left.id.localeCompare(right.id))
      .map((event) => {
        const copy = { ...event };
        delete copy._sourceOrder;
        return copy;
      });
  }

  return {
    buildLogicalEvents,
    resolveTurnIds,
    toolKind,
  };
}

module.exports = {
  createClaudeLogicalBuilder,
};
