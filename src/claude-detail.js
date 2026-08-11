'use strict';

const MarkdownIt = require('markdown-it');
const i18n = require('./shared/i18n');
const {
  DATA_URL_MARKER,
  sanitizeLogicalDetailDto,
  sanitizeLogicalDetailValue,
} = require('./shared/logical-detail-sanitizer');
const {
  CANONICAL_SCHEMA_VERSION,
  CLAUDE_SOURCE_KIND,
  blockText,
  claudeRawRef,
  rawEventsForLogicalEvent,
  stringifyValue,
} = require('./claude-source');

let markdownRenderer = null;

const CLAUDE_LOGICAL_DETAIL_SANITIZER_OPTIONS = Object.freeze({
  marker: DATA_URL_MARKER,
  maxStringChars: 32_000,
  maxTotalStringChars: 128_000,
  maxDepth: 32,
  maxNodes: 1_000,
  maxArrayItems: 128,
  maxObjectEntries: 128,
});
const CLAUDE_LOGICAL_DETAIL_OMIT_OBJECT_KEYS = new Set(['signature']);

function sanitizeClaudeDetailText(value) {
  return sanitizeLogicalDetailValue(
    String(value ?? ''),
    CLAUDE_LOGICAL_DETAIL_SANITIZER_OPTIONS,
  );
}

function sanitizeClaudeDetailDto(dto, options = {}) {
  return sanitizeLogicalDetailDto(dto, {
    ...CLAUDE_LOGICAL_DETAIL_SANITIZER_OPTIONS,
    ...options,
  });
}

function renderMarkdown(text) {
  if (!markdownRenderer) {
    markdownRenderer = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: false,
    });
  }
  return markdownRenderer.render(String(text || ''));
}

function localizeSections(sections, locale) {
  return sections.filter(Boolean).map((section) => {
    if (section.sourceOwnedTitle !== true) return i18n.localizeSection(section, locale);
    const { sourceOwnedTitle, ...sourceOwnedSection } = section;
    return sourceOwnedSection;
  });
}

function eventTitle(event, locale) {
  const known = i18n.lookupKnownLabel(event?.label || '', locale);
  return known || i18n.eventKindLabel(event?.kind || event?.payloadType || event?.recordType || 'event', locale);
}

function rawMeta(raw) {
  return {
    timestamp: raw.timestamp || '',
    turnId: raw.turnId || '',
    status: raw.status || '',
    severity: raw.isApiErrorMessage ? 'error' : 'normal',
    toolName: raw.toolName || '',
    provider: raw.provider || '',
    model: raw.model || '',
    effort: raw.effort || '',
    touchedFiles: raw.touchedFiles || [],
    outputStats: {
      exitCode: raw.exitCode,
      durationMs: raw.durationMs,
    },
    channels: [raw.recordType],
    source: raw.source || null,
  };
}

function logicalMeta(event) {
  return {
    timestamp: event.timestamp || '',
    turnId: event.turnId || '',
    status: event.status || '',
    severity: event.severity || 'normal',
    toolName: event.toolName || event.sourceToolName || '',
    provider: event.provider || '',
    model: event.model || '',
    effort: event.effort || '',
    provenance: event.provenance || null,
    touchedFiles: event.touchedFiles || [],
    outputStats: event.outputStats || {},
    channels: event.channels || [],
    source: event.source || null,
  };
}

function markdownSection(title, text, options = {}) {
  const sanitized = sanitizeClaudeDetailText(text);
  if (!sanitized.trim()) return null;
  return {
    type: 'markdown',
    title,
    html: renderMarkdown(sanitized),
    ...(options.hideTitle ? { hideTitle: true } : {}),
  };
}

function jsonSection(title, value) {
  if (value == null) return null;
  return { type: 'json', title, value };
}

function rawJsonSection(title, value, expanded = false) {
  return { type: 'raw_json', title, value, expanded };
}

function noticeSection(title, text, level = 'info') {
  const sanitized = sanitizeClaudeDetailText(text);
  if (!sanitized.trim()) return null;
  return { type: 'notice', title, text: sanitized, level };
}

function codeSection(title, code, language = 'text', role = '') {
  const sanitized = sanitizeClaudeDetailText(code);
  if (!sanitized.trim()) return null;
  return {
    type: 'code',
    title,
    code: sanitized,
    language,
    ...(role ? { role } : {}),
  };
}

function terminalSection(title, text, stream = 'stdout') {
  const sanitized = sanitizeClaudeDetailText(text);
  if (!sanitized.trim()) return null;
  return {
    type: 'terminal',
    title,
    text: sanitized,
    stream,
    language: 'text',
  };
}

function claudeDetailText(key, locale, vars = {}) {
  return i18n.t(locale, 'claudeDetail', key, vars);
}

function toolRequestTitle(toolName, locale) {
  const tool = String(toolName || '').trim()
    || claudeDetailText('toolNameFallback', locale);
  return claudeDetailText('toolRequestTitle', locale, { tool });
}

function fileChangeFallback(status, locale) {
  const keys = {
    success: 'fileChangeCompleted',
    declined: 'fileChangeDeclined',
    incomplete: 'fileChangeIncomplete',
    failed: 'fileChangeFailed',
  };
  return claudeDetailText(keys[status] || 'fileChangeUnknown', locale);
}

function toolRows(raws, event) {
  let callRaw = null;
  let call = null;
  let resultRaw = null;
  let result = null;
  let resultBlock = null;
  for (const raw of raws) {
    for (const candidate of raw.toolCalls || []) {
      if ((event.callId && candidate.id === event.callId)
          || (!event.callId && candidate.name === event.toolName)) {
        callRaw = raw;
        call = candidate;
        break;
      }
    }
    for (const candidate of raw.toolResults || []) {
      if ((event.callId && candidate.id === event.callId)
          || (!event.callId && candidate.id === call?.id)) {
        resultRaw = raw;
        result = candidate;
        resultBlock = raw.contentBlocks[candidate.blockIndex];
        break;
      }
    }
  }
  return { callRaw, call, resultRaw, result, resultBlock };
}

function hasUniqueResultOwner(resultRaw, result) {
  const results = resultRaw?.toolResults || [];
  return Boolean(result && results.length === 1 && results[0].blockIndex === result.blockIndex);
}

function uniquelyOwnedStructuredResult(resultRaw, result) {
  if (!hasUniqueResultOwner(resultRaw, result)) return null;
  const structured = resultRaw.toolUseResult;
  return structured && typeof structured === 'object' && !Array.isArray(structured)
    ? structured
    : null;
}

function planUpdateSection(explanation, items) {
  const text = sanitizeClaudeDetailText(explanation);
  const steps = (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const step = sanitizeClaudeDetailText(item.step || item.subject || '').trim();
    const status = sanitizeClaudeDetailText(item.status || '').trim();
    if (!step && !status) return null;
    return { step: step || '(unnamed step)', status };
  }).filter(Boolean);
  if (!text.trim() && !steps.length) return null;
  return {
    type: 'plan_update',
    title: 'Plan update',
    explanationHtml: text.trim() ? renderMarkdown(text) : '',
    steps,
  };
}

function taskToolPlanSection(call, structured, locale) {
  const request = call?.input || {};
  if (call?.name === 'TaskCreate') {
    return planUpdateSection(
      request.description || '',
      [{
        step: request.subject || structured?.task?.subject || '',
        status: structured?.task?.status || 'pending',
      }],
    );
  }
  if (call?.name === 'TaskUpdate') {
    const taskId = request.taskId || structured?.taskId || '';
    const status = structured?.statusChange?.to || request.status || '';
    const from = structured?.statusChange?.from || '';
    const changed = (Array.isArray(structured?.updatedFields) ? structured.updatedFields : [])
      .map((field) => sanitizeClaudeDetailText(field).trim())
      .filter(Boolean);
    return planUpdateSection(
      from && status
        ? claudeDetailText('taskStatusTransition', locale, { taskId, from, to: status })
        : changed.length
          ? claudeDetailText('taskUpdatedFields', locale, { taskId, fields: changed.join(', ') })
          : '',
      [{ step: request.subject || claudeDetailText('taskFallback', locale, { taskId }), status }],
    );
  }
  return null;
}

function lifecycleSections(event, locale) {
  const lifecycle = event?.lifecycle;
  if (!lifecycle) return [];
  if (lifecycle.kind === 'goal') {
    const terminal = lifecycle.terminal;
    return [
      markdownSection('Goal condition', lifecycle.condition),
      ...lifecycle.validations.map((validation) => jsonSection('Goal validation', validation)),
      terminal
        ? markdownSection('Result', terminal.reason)
        : noticeSection('Lifecycle', claudeDetailText('goalLifecycleActive', locale), 'warning'),
      jsonSection('Lifecycle data', {
        kind: lifecycle.kind,
        phase: lifecycle.phase,
        initial: lifecycle.initial,
        terminal: terminal ? {
          met: terminal.met,
          iterations: terminal.iterations,
          durationMs: terminal.durationMs,
          tokens: terminal.tokens,
        } : null,
      }),
    ].filter(Boolean);
  }
  const terminal = lifecycle.terminal;
  const notifications = Array.isArray(lifecycle.notifications) ? lifecycle.notifications : terminal ? [terminal] : [];
  const isWorkflow = lifecycle.kind === 'async_workflow';
  const launchText = lifecycle.kind === 'background_command'
    ? claudeDetailText(
      lifecycle.timedOutAfterMs ? 'backgroundLifecycleLaunchTimed' : 'backgroundLifecycleLaunch',
      locale,
      { duration: lifecycle.timedOutAfterMs, taskId: lifecycle.taskId },
    )
    : claudeDetailText(
      isWorkflow ? 'asyncWorkflowLifecycleLaunch' : 'asyncAgentLifecycleLaunch',
      locale,
      { taskId: lifecycle.taskId },
    );
  const sections = [noticeSection('Lifecycle', launchText, terminal ? 'info' : 'warning')];
  for (const notification of notifications) {
    sections.push(noticeSection(
      'Completion',
      notification.summary,
      ['failed', 'error'].includes(notification.status) ? 'error' : 'info',
    ));
    if (isWorkflow) {
      sections.push(jsonSection('Workflow terminal', {
        status: notification.status,
        outputFile: notification.outputFile || '',
        result: notification.result || '',
        recovery: notification.recovery || '',
        usage: notification.usage,
        exitCode: notification.exitCode ?? null,
      }));
    } else {
      sections.push(markdownSection('Result', notification.result || ''));
      sections.push(jsonSection('Usage', notification.usage));
    }
  }
  sections.push(jsonSection('Lifecycle data', {
    kind: lifecycle.kind,
    phase: lifecycle.phase,
    taskId: lifecycle.taskId,
    timedOutAfterMs: lifecycle.timedOutAfterMs,
    terminalStatus: terminal?.status || '',
    exitCode: terminal?.exitCode ?? null,
    stops: notifications.map((notification) => ({
      status: notification.status,
      summary: notification.summary,
      ...(isWorkflow ? {
        outputFile: notification.outputFile || '',
        result: notification.result || '',
        recovery: notification.recovery || '',
      } : {}),
      usage: notification.usage,
      exitCode: notification.exitCode ?? null,
    })),
  }));
  return sections.filter(Boolean);
}

function toolSections(raws, event, locale) {
  const {
    call,
    resultRaw,
    result,
    resultBlock,
  } = toolRows(raws, event);
  const request = call?.input || {};
  const ownsResultMetadata = hasUniqueResultOwner(resultRaw, result);
  const resultText = blockText(resultBlock) || (ownsResultMetadata ? resultRaw?.output : '') || '';
  const structuredResult = uniquelyOwnedStructuredResult(resultRaw, result);
  const sections = [];

  if (['TaskCreate', 'TaskUpdate'].includes(call?.name)) {
    sections.push(taskToolPlanSection(call, structuredResult, locale));
    if (!sections[0]) sections.push(jsonSection('Request', request));
    sections.push(noticeSection(
      'Result',
      resultText,
      event.status === 'failed' ? 'error' : event.status === 'incomplete' ? 'warning' : 'info',
    ));
    return sections.filter(Boolean);
  }

  if (event.kind === 'command') {
    sections.push(codeSection('Command', request.command || stringifyValue(request), 'bash', 'command'));
    sections.push(terminalSection('stdout', structuredResult?.stdout || (event.lifecycle ? '' : resultText), 'stdout'));
    sections.push(terminalSection('stderr', structuredResult?.stderr, 'stderr'));
  } else if (event.kind === 'patch') {
    const file = request.file_path || request.filePath || request.path || request.notebook_path || '';
    const content = request.content || request.new_string || request.newString || '';
    const contentSection = codeSection(file || 'File content', content, '', '');
    sections.push(file && contentSection ? { ...contentSection, sourceOwnedTitle: true } : contentSection);
    sections.push(jsonSection('Request', request));
    sections.push(noticeSection(
      'Result',
      resultText || fileChangeFallback(event.status, locale),
      event.status === 'failed' ? 'error' : event.status === 'declined' || event.status === 'incomplete' ? 'warning' : 'info',
    ));
  } else {
    sections.push(jsonSection('Request', request));
    if (structuredResult && typeof structuredResult === 'object') {
      sections.push(jsonSection(event.lifecycle ? 'Launch result' : 'Structured result', structuredResult));
    }
    if (!event.lifecycle) {
      sections.push(terminalSection('Result', resultText, event.status === 'failed' ? 'stderr' : 'stdout'));
    }
  }
  sections.push(...lifecycleSections(event, locale));
  return sections.filter(Boolean);
}

function compactionSections(raws) {
  const boundary = raws.find((raw) => raw.recordType === 'system' && raw.payloadType === 'compact_boundary');
  const summary = raws.find((raw) => raw.isCompactSummary);
  return [
    jsonSection('Compaction metadata', boundary?.parsed?.compactMetadata),
    markdownSection('Compaction summary', summary?.messageText),
  ].filter(Boolean);
}

function rawTimelineSections(raw, locale) {
  const sections = [];
  if (raw.messageText) {
    sections.push(markdownSection(
      raw.payloadType === 'thinking' ? 'Reasoning' : 'Message',
      raw.messageText,
      { hideTitle: true },
    ));
  }
  if (raw.toolCalls?.length) {
    for (const call of raw.toolCalls) {
      if (String(call.name).toLowerCase() === 'bash') {
        sections.push(codeSection('Command', call.input?.command || stringifyValue(call.input), 'bash', 'command'));
      } else {
        sections.push(jsonSection(toolRequestTitle(call.name, locale), call.input));
      }
    }
  }
  if (raw.toolResults?.length) {
    sections.push(terminalSection(
      'Tool result',
      raw.output || stringifyValue(raw.toolUseResult),
      raw.status === 'failed' ? 'stderr' : 'stdout',
    ));
    if (raw.toolUseResult && typeof raw.toolUseResult === 'object') {
      sections.push(jsonSection('Structured result', raw.toolUseResult));
    }
  }
  if (raw.recordType === 'system') {
    sections.push(noticeSection(
      eventTitle(raw, locale),
      raw.parsed?.content || raw.preview,
      raw.parsed?.level === 'error' ? 'error' : raw.parsed?.level === 'warning' ? 'warning' : 'info',
    ));
    if (raw.parsed?.compactMetadata) sections.push(jsonSection('Compaction metadata', raw.parsed.compactMetadata));
  }
  if (!sections.length && raw.preview) sections.push(noticeSection(eventTitle(raw, locale), raw.preview));
  return sections.filter(Boolean);
}

function logicalTimelineSections(event, raws, locale) {
  if (['user_message', 'assistant_message', 'reasoning'].includes(event.kind)) {
    const raw = raws[0];
    const block = raw?.contentBlocks?.[event.blockIndex ?? 0];
    const text = blockText(block) || raw?.messageText || event.searchText;
    return [markdownSection(eventTitle(event, locale), text, { hideTitle: true })].filter(Boolean);
  }
  if (['command', 'read', 'patch', 'web_search', 'agent_coordination', 'mcp_call', 'other_tool_call'].includes(event.kind)) {
    return toolSections(raws, event, locale);
  }
  if (event.kind === 'proposed_plan') {
    const { call } = toolRows(raws, event);
    return [markdownSection('Proposed plan', call?.input?.plan || event.searchText)].filter(Boolean);
  }
  if (event.kind === 'plan_update') {
    return [planUpdateSection('', event.planSnapshot || [])].filter(Boolean);
  }
  if (event.kind === 'compaction') return compactionSections(raws);
  if (event.kind === 'goal') return lifecycleSections(event, locale);
  if (['error', 'warning', 'abort'].includes(event.kind)) {
    return [noticeSection(
      eventTitle(event, locale),
      event.searchText || event.preview,
      event.kind === 'error' ? 'error' : 'warning',
    )].filter(Boolean);
  }
  if (event.layer === 'protocol' && event.subtype === 'task_reminder') {
    return [planUpdateSection('', event.planSnapshot || [])].filter(Boolean);
  }
  if (event.layer === 'protocol' && event.subtype === 'away_summary') {
    return [markdownSection('Away summary', raws[0]?.parsed?.content || event.searchText, { hideTitle: true })].filter(Boolean);
  }
  if (event.layer === 'protocol' && ['plan_mode', 'plan_mode_exit'].includes(event.subtype)) {
    return [jsonSection('Plan mode', raws[0]?.parsed?.attachment || {})].filter(Boolean);
  }
  return [noticeSection(eventTitle(event, locale), event.preview || event.searchText)].filter(Boolean);
}

function buildClaudeEventDetail(session, eventId, layer = 'main', options = {}) {
  const locale = i18n.resolveLocale(options.locale);
  if (layer === 'raw') {
    const raw = session.rawEvents.find((candidate) => candidate.rawId === eventId);
    if (!raw) return null;
    return sanitizeClaudeDetailDto({
      id: raw.rawId,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      sourceKind: CLAUDE_SOURCE_KIND,
      kind: raw.payloadType || raw.recordType,
      subtype: raw.role || '',
      layer: 'raw',
      title: i18n.rawRecordLabel(raw.payloadType || raw.recordType, locale),
      sourceLocator: raw.sourceLocator,
      sourceRecordType: raw.recordType || '',
      sourceEventType: raw.payloadType || '',
      meta: rawMeta(raw),
      rawRefs: [claudeRawRef(raw)],
      timelineSections: localizeSections(rawTimelineSections(raw, locale), locale),
      inspectorSections: localizeSections([
        rawJsonSection('Raw JSON', raw.parseError ? {
          parseError: raw.parseError,
          rawText: raw.rawText,
        } : raw.parsed, true),
      ], locale),
    });
  }

  const event = session.logicalEvents.find((candidate) => candidate.id === eventId && candidate.layer === layer);
  if (!event) return null;
  const raws = rawEventsForLogicalEvent(session, event);
  return sanitizeClaudeDetailDto({
    id: event.id,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    sourceKind: CLAUDE_SOURCE_KIND,
    kind: event.kind,
    subtype: event.subtype,
    layer: event.layer,
    title: eventTitle(event, locale),
    sourceLocator: event.sourceLocator,
    meta: logicalMeta(event),
    rawRefs: event.rawRefs,
    timelineSections: localizeSections(logicalTimelineSections(event, raws, locale), locale),
    inspectorSections: localizeSections([
      rawJsonSection('Raw JSON', raws.map((raw) => raw.parsed)),
    ], locale),
  }, { omitObjectKeys: CLAUDE_LOGICAL_DETAIL_OMIT_OBJECT_KEYS });
}

module.exports = {
  buildClaudeEventDetail,
};
