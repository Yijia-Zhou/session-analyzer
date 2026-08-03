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
    const raws = fields.raws || [];
    const rawRefs = uniqueRawRefs(raws);
    const preview = String(fields.preview || '').trim();
    const searchText = String(fields.searchText || preview).trim();
    const runtimeRaw = raws.find((raw) => raw?.provider || raw?.model || raw?.effort) || null;
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
      provider: String(fields.provider || runtimeRaw?.provider || ''),
      model: String(fields.model || runtimeRaw?.model || ''),
      effort: String(fields.effort || runtimeRaw?.effort || ''),
      ...(fields.callId ? { callId: fields.callId } : {}),
      ...(fields.agentId ? { agentId: fields.agentId } : {}),
      ...(fields.messageId ? { messageId: fields.messageId } : {}),
      ...(fields.blockIndex != null ? { blockIndex: fields.blockIndex } : {}),
      ...(fields.sourceToolName ? { sourceToolName: fields.sourceToolName } : {}),
      ...(fields.lifecycle ? { lifecycle: fields.lifecycle } : {}),
      ...(fields.planSnapshot ? { planSnapshot: fields.planSnapshot } : {}),
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

  function notificationOutcome(lifecycle) {
    if (!lifecycle?.terminal) return 'in_progress';
    const status = String(lifecycle.terminal.status || '').toLowerCase();
    if (['failed', 'error'].includes(status)) return 'failed';
    if (status === 'declined') return 'declined';
    if (['cancelled', 'canceled', 'stopped'].includes(status)) return 'incomplete';
    if (lifecycle.kind === 'background_command'
        && lifecycle.terminal.exitCode != null
        && lifecycle.terminal.exitCode !== 0) return 'failed';
    return ['completed', 'success'].includes(status) ? 'success' : 'incomplete';
  }

  function resultStatus(match, lifecycle = null) {
    if (!match) return 'incomplete';
    const { raw: result, result: resultBlock } = match;
    if (result.toolDenialKind || resultBlock.status === 'declined') return 'declined';
    if (resultBlock.isError || resultBlock.status === 'failed') return 'failed';
    if (result.exitCode != null && result.exitCode !== 0) return 'failed';
    if (lifecycle) return notificationOutcome(lifecycle);
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

  function isTaskPlanTool(name) {
    return ['TaskCreate', 'TaskUpdate'].includes(String(name || ''));
  }

  function toolLabel(kind, name, status, lifecycle = null) {
    if (lifecycle?.kind === 'background_command') {
      if (status === 'failed') return 'Failed background command';
      if (status === 'incomplete') return 'Incomplete background command';
      return 'Background command';
    }
    if (lifecycle?.kind === 'async_agent') return 'Async agent';
    if (isTaskPlanTool(name)) return 'Plan update';
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
    if (call.name === 'TaskCreate') return truncate(input.subject || input.description || call.name);
    if (call.name === 'TaskUpdate') {
      const task = input.taskId ? `Task #${input.taskId}` : call.name;
      return truncate(input.status ? `${task} → ${input.status}` : task);
    }
    if (call.name === 'ExitPlanMode') return truncate(input.plan || call.name);
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
    const planModeExitByParentUuid = new Map();
    const uuidCounts = new Map();
    for (const raw of raws) {
      if (raw.uuid) uuidCounts.set(raw.uuid, (uuidCounts.get(raw.uuid) || 0) + 1);
    }
    for (const raw of raws) {
      if (raw.recordType === 'file-history-delta') {
        appendIndexedValue(fileHistoryByMessageId, fileDeltaMessageId(raw), raw);
      } else if (raw.recordType === 'attachment') {
        appendIndexedValue(attachmentsByCallId, attachmentToolUseId(raw), raw);
        if (
          raw.payloadType === 'plan_mode_exit'
          && raw.parentUuid
          && raw.parsed?.attachment?.planExists === true
        ) {
          appendIndexedValue(planModeExitByParentUuid, raw.parentUuid, raw);
        }
      }
    }
    return {
      attachmentsByCallId,
      fileHistoryByMessageId,
      planModeExitByParentUuid,
      uuidCounts,
    };
  }

  function supplementalRowsForCall(index, callRaw, call, resultMatch, callIdentityUnique) {
    const rows = [];
    if (callRaw.toolCalls.length === 1 && callRaw.uuid) {
      rows.push(...(index.fileHistoryByMessageId.get(callRaw.uuid) || []));
    }
    if (call.id && callIdentityUnique) {
      rows.push(...(index.attachmentsByCallId.get(call.id) || []));
    }
    if (
      call.name === 'ExitPlanMode'
      && resultMatch
      && resultStatus(resultMatch) === 'success'
      && resultMatch.raw.uuid
      && index.uuidCounts.get(resultMatch.raw.uuid) === 1
    ) {
      rows.push(...(index.planModeExitByParentUuid.get(resultMatch.raw.uuid) || []));
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

  function singleTagValue(text, tag) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const start = text.indexOf(open);
    if (start < 0 || text.indexOf(open, start + open.length) >= 0) return null;
    const end = text.indexOf(close, start + open.length);
    if (end < 0 || text.indexOf(close, end + close.length) >= 0) return null;
    return text.slice(start + open.length, end);
  }

  function tagCount(text, marker) {
    let count = 0;
    let offset = 0;
    while (offset < text.length) {
      const index = text.indexOf(marker, offset);
      if (index < 0) break;
      count += 1;
      offset = index + marker.length;
    }
    return count;
  }

  function trustedTaskNotificationText(raw) {
    if (
      raw.recordType === 'queue-operation'
      && ['enqueue', 'remove'].includes(raw.payloadType)
      && typeof raw.parsed?.content === 'string'
    ) return raw.parsed.content;
    if (
      raw.recordType === 'user'
      && raw.originKind === 'task-notification'
      && raw.promptSource === 'system'
      && typeof raw.parsed?.message?.content === 'string'
    ) return raw.parsed.message.content;
    return '';
  }

  function numericUsageValue(usageText, tag) {
    const value = singleTagValue(usageText, tag);
    if (value == null || !/^\d+$/.test(value.trim())) return null;
    const number = Number(value.trim());
    return Number.isSafeInteger(number) ? number : null;
  }

  function parseTaskNotification(raw) {
    const text = trustedTaskNotificationText(raw).trim();
    if (!text.startsWith('<task-notification>') || !text.endsWith('</task-notification>')) return null;
    if (text.indexOf('<task-notification>', '<task-notification>'.length) >= 0) return null;
    if (text.indexOf('</task-notification>') !== text.length - '</task-notification>'.length) return null;
    if (['task-id', 'tool-use-id', 'status', 'summary', 'result', 'usage'].some((tag) => {
      const opens = tagCount(text, `<${tag}>`);
      const closes = tagCount(text, `</${tag}>`);
      return opens !== closes || opens > 1;
    })) return null;
    const taskId = singleTagValue(text, 'task-id')?.trim() || '';
    const toolUseId = singleTagValue(text, 'tool-use-id')?.trim() || '';
    const status = singleTagValue(text, 'status')?.trim().toLowerCase() || '';
    const summary = singleTagValue(text, 'summary')?.trim() || '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(taskId)) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(toolUseId)) return null;
    if (!['completed', 'success', 'failed', 'error', 'declined', 'cancelled', 'canceled', 'stopped'].includes(status)) return null;
    if (!summary || summary.length > 4000) return null;
    const result = (singleTagValue(text, 'result') || '').trim().slice(0, 16000);
    const usageText = singleTagValue(text, 'usage') || '';
    const usage = usageText ? {
      subagentTokens: numericUsageValue(usageText, 'subagent_tokens'),
      toolUses: numericUsageValue(usageText, 'tool_uses'),
      durationMs: numericUsageValue(usageText, 'duration_ms'),
    } : null;
    const exitMatch = summary.match(/\(exit code (-?\d+)\)\s*$/i);
    const exitCode = exitMatch && Number.isSafeInteger(Number(exitMatch[1])) ? Number(exitMatch[1]) : null;
    const fingerprint = JSON.stringify({ taskId, toolUseId, status, summary, result, usage, exitCode });
    return {
      raw,
      taskId,
      toolUseId,
      status,
      summary,
      result,
      usage,
      exitCode,
      fingerprint,
    };
  }

  function launchCandidate(callKey, callMatch, resultMatch) {
    if (!resultMatch || !callMatch.call.id) return null;
    const structured = resultMatch.raw.toolUseResult;
    if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return null;
    if (
      callMatch.call.name === 'Bash'
      && typeof structured.backgroundTaskId === 'string'
      && structured.backgroundTaskId.trim()
      && Number.isFinite(structured.timedOutAfterMs)
      && structured.timedOutAfterMs > 0
    ) {
      return {
        callKey,
        call: callMatch.call,
        kind: 'background_command',
        taskId: structured.backgroundTaskId.trim(),
        timedOutAfterMs: structured.timedOutAfterMs,
        resultRawIndex: resultMatch.raw.rawIndex,
      };
    }
    if (
      callMatch.call.name === 'Agent'
      && structured.isAsync === true
      && structured.status === 'async_launched'
      && typeof structured.agentId === 'string'
      && structured.agentId.trim()
    ) {
      return {
        callKey,
        call: callMatch.call,
        kind: 'async_agent',
        taskId: structured.agentId.trim(),
        timedOutAfterMs: null,
        resultRawIndex: resultMatch.raw.rawIndex,
      };
    }
    return null;
  }

  function buildAsyncLifecycleCorrelation(raws, toolCorrelation) {
    const launchesByTaskId = new Map();
    const launches = [];
    for (const [callKey, callMatch] of toolCorrelation.callByBlock) {
      if (!toolCorrelation.uniqueCallIds.has(callMatch.call.id)) continue;
      const candidate = launchCandidate(
        callKey,
        callMatch,
        toolCorrelation.resultByCallBlock.get(callKey),
      );
      if (candidate) {
        launches.push(candidate);
        appendIndexedValue(launchesByTaskId, candidate.taskId, candidate);
      }
    }

    const notificationsByCall = new Map();
    for (const raw of raws) {
      const notification = parseTaskNotification(raw);
      if (!notification) continue;
      const owners = launchesByTaskId.get(notification.taskId) || [];
      if (
        owners.length !== 1
        || owners[0].call.id !== notification.toolUseId
        || notification.raw.rawIndex <= owners[0].resultRawIndex
      ) continue;
      appendIndexedValue(notificationsByCall, owners[0].callKey, notification);
    }

    const lifecycleByCallBlock = new Map();
    const matchedNotificationRawIds = new Set();
    for (const launch of launches) {
      const notifications = (notificationsByCall.get(launch.callKey) || [])
        .sort((left, right) => left.raw.rawIndex - right.raw.rawIndex);
      const semanticNotifications = [];
      const seen = new Set();
      for (const notification of notifications) {
        matchedNotificationRawIds.add(notification.raw.rawId);
        if (seen.has(notification.fingerprint)) continue;
        seen.add(notification.fingerprint);
        semanticNotifications.push(notification);
      }
      const terminal = semanticNotifications.at(-1) || null;
      lifecycleByCallBlock.set(launch.callKey, {
        kind: launch.kind,
        taskId: launch.taskId,
        phase: terminal ? 'terminal' : launch.kind === 'background_command' ? 'backgrounded' : 'async_launched',
        timedOutAfterMs: launch.timedOutAfterMs,
        notifications: semanticNotifications.map((notification) => ({
          status: notification.status,
          summary: notification.summary,
          result: notification.result,
          usage: notification.usage,
          exitCode: notification.exitCode,
        })),
        terminal: terminal ? {
          status: terminal.status,
          summary: terminal.summary,
          result: terminal.result,
          usage: terminal.usage,
          exitCode: terminal.exitCode,
        } : null,
        notificationRaws: notifications.map((notification) => notification.raw),
      });
    }
    return { lifecycleByCallBlock, matchedNotificationRawIds };
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

  function lifecycleSearchText(lifecycle) {
    if (!lifecycle) return '';
    return [
      lifecycle.taskId,
      lifecycle.phase,
      ...(lifecycle.notifications || []).flatMap((notification) => [
        notification.status,
        notification.summary,
        notification.result,
        stringifyValue(notification.usage),
      ]),
    ].filter(Boolean).join('\n');
  }

  function buildToolEvent(callRaw, call, resultMatch, supplements, lifecycle = null) {
    const ordinaryKind = toolKind(call.name);
    const result = resultMatch?.raw;
    const status = resultStatus(resultMatch, lifecycle);
    const structuredResult = result?.toolUseResult;
    const approvedPlan = Boolean(call.name === 'ExitPlanMode'
      && status === 'success'
      && typeof call.input?.plan === 'string'
      && call.input.plan.trim()
      && typeof structuredResult?.plan === 'string'
      && structuredResult.plan === call.input.plan);
    const kind = approvedPlan ? 'proposed_plan' : ordinaryKind;
    const subtype = approvedPlan ? 'proposed_plan' : call.name;
    const severity = status === 'failed' ? 'error' : ['declined', 'incomplete'].includes(status) ? 'warning' : 'normal';
    const resultText = toolResultText(resultMatch);
    const agentId = String(structuredResult?.agentId || result?.agentId || '');
    const touchedFiles = [
      ...(callRaw.touchedFiles || []),
      ...deltaTouchedFiles(supplements),
    ];
    const raws = [callRaw, result, ...supplements, ...(lifecycle?.notificationRaws || [])];
    const publicLifecycle = lifecycle ? {
      kind: lifecycle.kind,
      taskId: lifecycle.taskId,
      phase: lifecycle.phase,
      timedOutAfterMs: lifecycle.timedOutAfterMs,
      notifications: lifecycle.notifications,
      terminal: lifecycle.terminal,
    } : null;
    return createEvent({
      id: `${callRaw.sessionId}:logical:tool:${callRaw.line}:${call.blockIndex}${call.id ? `:${call.id}` : ''}`,
      timestamp: callRaw.timestamp,
      turnId: callRaw.turnId || result?.turnId || '',
      kind,
      subtype,
      layer: 'main',
      role: 'assistant',
      label: approvedPlan ? 'Proposed plan' : toolLabel(ordinaryKind, call.name, status, lifecycle),
      preview: approvedPlan ? truncate(call.input.plan) : toolPreview(call, ordinaryKind),
      searchText: [
        call.name,
        stringifyValue(call.input),
        resultText,
        stringifyValue(structuredResult),
        result?.toolDenialKind,
        lifecycleSearchText(lifecycle),
      ].filter(Boolean).join('\n'),
      severity,
      status,
      toolName: approvedPlan ? '' : call.name,
      sourceToolName: approvedPlan ? call.name : '',
      touchedFiles,
      outputStats: {
        exitCode: lifecycle?.terminal?.exitCode ?? result?.exitCode ?? null,
        durationMs: lifecycle?.terminal?.usage?.durationMs ?? result?.durationMs ?? 0,
      },
      raws,
      channels: raws.map((raw) => raw?.recordType),
      sourceOrder: callRaw.rawIndex * 100 + call.blockIndex,
      callId: call.id,
      agentId,
      blockIndex: call.blockIndex,
      tags: [
        agentId ? 'subagent' : '',
        lifecycle?.kind === 'background_command' ? 'backgrounded' : '',
        lifecycle?.kind === 'async_agent' ? 'async' : '',
      ],
      lifecycle: publicLifecycle,
    });
  }

  function normalizedTaskItem(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.id !== 'string' || typeof value.subject !== 'string' || typeof value.status !== 'string') return null;
    if (value.description != null && typeof value.description !== 'string') return null;
    const id = value.id.trim();
    const subject = value.subject.trim();
    const status = value.status.trim();
    if (!id || !subject || !status) return null;
    const stringList = (items) => {
      if (items == null) return [];
      if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) return null;
      return items.map((item) => item.trim()).filter(Boolean).sort();
    };
    const blocks = stringList(value.blocks);
    const blockedBy = stringList(value.blockedBy);
    if (!blocks || !blockedBy) return null;
    return {
      id,
      subject,
      description: String(value.description || '').trim(),
      status,
      blocks,
      blockedBy,
    };
  }

  function taskReminderSnapshot(raw) {
    if (raw.recordType !== 'attachment' || raw.payloadType !== 'task_reminder') return null;
    const attachment = raw.parsed?.attachment;
    if (!attachment || !Array.isArray(attachment.content) || !attachment.content.length) return null;
    if (!Number.isSafeInteger(attachment.itemCount) || attachment.itemCount !== attachment.content.length) return null;
    const items = attachment.content.map(normalizedTaskItem);
    if (items.some((item) => !item)) return null;
    const ids = items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) return null;
    items.sort((left, right) => left.id.localeCompare(right.id));
    return { raw, items, fingerprint: JSON.stringify(items) };
  }

  function taskTransition(callMatch, resultMatch) {
    if (!resultMatch || resultStatus(resultMatch) !== 'success') return null;
    const { call } = callMatch;
    const structured = resultMatch.raw.toolUseResult;
    if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return null;
    if (call.name === 'TaskCreate') {
      if (typeof structured.task?.id !== 'string') return null;
      if (structured.task.subject != null && typeof structured.task.subject !== 'string') return null;
      if (call.input?.subject != null && typeof call.input.subject !== 'string') return null;
      const id = structured.task.id.trim();
      const resultSubject = String(structured.task.subject || '').trim();
      const requestSubject = String(call.input?.subject || '').trim();
      if (resultSubject && requestSubject && resultSubject !== requestSubject) return null;
      const subject = resultSubject || requestSubject;
      if (!id || !subject) return null;
      if (call.input?.description != null && typeof call.input.description !== 'string') return null;
      if (structured.task.status != null && typeof structured.task.status !== 'string') return null;
      return {
        rawIndex: resultMatch.raw.rawIndex,
        blockIndex: call.blockIndex,
        apply(state) {
          state.set(id, {
            id,
            subject,
            description: String(call.input?.description || '').trim(),
            status: String(structured.task?.status || 'pending'),
            blocks: [],
            blockedBy: [],
          });
        },
      };
    }
    if (call.name === 'TaskUpdate') {
      if (typeof call.input?.taskId !== 'string' || typeof structured.taskId !== 'string') return null;
      const requestId = call.input.taskId.trim();
      const resultId = structured.taskId.trim();
      if (!requestId || requestId !== resultId || structured.success !== true) return null;
      if (!Array.isArray(structured.updatedFields)
          || structured.updatedFields.some((field) => typeof field !== 'string')) return null;
      const updatedFields = new Set(structured.updatedFields.map((field) => field.trim()).filter(Boolean));
      if (updatedFields.has('status') && typeof structured.statusChange?.to !== 'string') return null;
      if (call.input?.status != null && typeof call.input.status !== 'string') return null;
      const status = updatedFields.has('status') ? structured.statusChange.to.trim() : '';
      if (status && call.input?.status && status !== call.input.status.trim()) return null;
      const hasSubject = updatedFields.has('subject') && typeof call.input?.subject === 'string';
      const subject = hasSubject
        ? call.input.subject.trim()
        : '';
      const hasDescription = updatedFields.has('description') && typeof call.input?.description === 'string';
      const description = hasDescription
        ? call.input.description.trim()
        : '';
      const relationValues = (field) => {
        if (!updatedFields.has(field)) return [];
        if (!Array.isArray(call.input?.[field])
            || call.input[field].some((value) => typeof value !== 'string')) return null;
        return call.input[field].map((value) => value.trim()).filter(Boolean);
      };
      const addBlocks = relationValues('addBlocks');
      const addBlockedBy = relationValues('addBlockedBy');
      if (!addBlocks || !addBlockedBy) return null;
      if (!status && !hasSubject && !hasDescription && !addBlocks.length && !addBlockedBy.length) return null;
      return {
        rawIndex: resultMatch.raw.rawIndex,
        blockIndex: call.blockIndex,
        apply(state) {
          if (status === 'deleted') {
            state.delete(requestId);
            return;
          }
          const current = state.get(requestId) || {
            id: requestId,
            subject: `Task #${requestId}`,
            description: '',
            status: '',
            blocks: [],
            blockedBy: [],
          };
          state.set(requestId, {
            ...current,
            ...(hasSubject ? { subject } : {}),
            ...(hasDescription ? { description } : {}),
            ...(status ? { status } : {}),
            blocks: [...new Set([...current.blocks, ...addBlocks])].sort(),
            blockedBy: [...new Set([...current.blockedBy, ...addBlockedBy])].sort(),
          });
        },
      };
    }
    return null;
  }

  function stateFingerprint(state) {
    return JSON.stringify([...state.values()].sort((left, right) => left.id.localeCompare(right.id)));
  }

  function taskReminderPreview(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.status, (counts.get(item.status) || 0) + 1);
    return [
      `${items.length} task${items.length === 1 ? '' : 's'}`,
      ...[...counts.entries()].map(([status, count]) => `${count} ${status}`),
    ].join(' · ');
  }

  function taskReminderEvent(group, isNovel) {
    const raws = group.entries.map((entry) => entry.raw);
    const items = group.entries[0].items;
    return createEvent({
      id: `${raws[0].sessionId}:logical:${isNovel ? 'plan-update' : 'protocol-task-reminder'}:${raws[0].line}`,
      timestamp: raws[0].timestamp,
      turnId: raws[0].turnId,
      kind: isNovel ? 'plan_update' : 'protocol',
      subtype: isNovel ? 'plan_update' : 'task_reminder',
      layer: isNovel ? 'main' : 'protocol',
      role: 'system',
      label: isNovel ? 'Plan update' : 'Task reminder',
      preview: taskReminderPreview(items),
      searchText: stringifyValue(items),
      raws,
      sourceOrder: raws[0].rawIndex * 100,
      planSnapshot: items,
    });
  }

  function buildTaskReminderProjection(raws, toolCorrelation) {
    const transitions = [];
    for (const [callKey, callMatch] of toolCorrelation.callByBlock) {
      if (!toolCorrelation.uniqueCallIds.has(callMatch.call.id)) continue;
      const transition = taskTransition(callMatch, toolCorrelation.resultByCallBlock.get(callKey));
      if (transition) transitions.push(transition);
    }
    transitions.sort((left, right) => left.rawIndex - right.rawIndex || left.blockIndex - right.blockIndex);

    const snapshots = raws.map(taskReminderSnapshot).filter(Boolean);
    const groups = [];
    for (const snapshot of snapshots) {
      const previous = groups.at(-1);
      const transitionBetween = previous && transitions.some((transition) => (
        transition.rawIndex > previous.entries.at(-1).raw.rawIndex
        && transition.rawIndex < snapshot.raw.rawIndex
      ));
      if (previous && previous.fingerprint === snapshot.fingerprint && !transitionBetween) {
        previous.entries.push(snapshot);
      } else {
        groups.push({ fingerprint: snapshot.fingerprint, entries: [snapshot] });
      }
    }

    const state = new Map();
    const events = [];
    const consumedRawIds = new Set();
    let transitionIndex = 0;
    for (const group of groups) {
      const rawIndex = group.entries[0].raw.rawIndex;
      while (transitionIndex < transitions.length && transitions[transitionIndex].rawIndex < rawIndex) {
        transitions[transitionIndex].apply(state);
        transitionIndex += 1;
      }
      const isNovel = stateFingerprint(state) !== group.fingerprint;
      events.push(taskReminderEvent(group, isNovel));
      for (const entry of group.entries) consumedRawIds.add(entry.raw.rawId);
      if (isNovel) {
        state.clear();
        for (const item of group.entries[0].items) state.set(item.id, item);
      }
    }
    return { events, consumedRawIds };
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
    const asyncLifecycle = buildAsyncLifecycleCorrelation(raws, toolCorrelation);
    const taskReminderProjection = buildTaskReminderProjection(raws, toolCorrelation);
    const compactByBoundary = compactGroups(raws);
    for (const group of compactByBoundary.values()) {
      for (const raw of group.slice(1)) consumedRawIds.add(raw.rawId);
    }
    for (const rawId of asyncLifecycle.matchedNotificationRawIds) consumedRawIds.add(rawId);
    for (const rawId of taskReminderProjection.consumedRawIds) consumedRawIds.add(rawId);
    events.push(...taskReminderProjection.events);

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
        let ignoredWhitespaceTextCount = 0;
        raw.contentBlocks.forEach((block, blockIndex) => {
          if (block.type === 'thinking') {
            events.push(reasoningEvent(raw, block, blockIndex));
            projectedBlockCount += 1;
          } else if (block.type === 'text' && blockText(block).trim()) {
            events.push(messageEvent(raw, block, blockIndex, 'assistant'));
            projectedBlockCount += 1;
          } else if (block.type === 'text') {
            ignoredWhitespaceTextCount += 1;
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
              call,
              resultMatch,
              toolCorrelation.uniqueCallIds.has(call.id),
            );
            for (const supplement of supplements) consumedRawIds.add(supplement.rawId);
            events.push(buildToolEvent(
              raw,
              call,
              resultMatch,
              supplements,
              asyncLifecycle.lifecycleByCallBlock.get(callKey) || null,
            ));
            projectedBlockCount += 1;
          } else {
            events.push(protocolBlockEvent(raw, block, blockIndex));
            projectedBlockCount += 1;
          }
        });
        if (
          !projectedBlockCount
          && (!raw.contentBlocks.length || ignoredWhitespaceTextCount !== raw.contentBlocks.length)
        ) {
          events.push(protocolEvent(raw));
        }
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
