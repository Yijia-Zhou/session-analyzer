'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodexSearch } = require('../src/codex-search');
const { codeModePresentationContextMap } = require('../src/codex-presentation-context');

test('Code Mode presentation context map retains unique parents and omits ambiguous or malformed references', () => {
  const parent = {
    id: 'code-mode-parent',
    subtype: 'code_mode_operation',
    codeModeOperation: { eventRefs: ['nested-event', 'nested-event'] },
  };

  const unique = codeModePresentationContextMap([parent]);
  assert.deepEqual(unique.get('nested-event'), {
    relation: 'enclosed_by_code_mode_operation',
    codeModeParentId: 'code-mode-parent',
  });
  assert.equal(unique.has('unreferenced'), false);

  const ambiguous = codeModePresentationContextMap([
    parent,
    {
      id: 'second-code-mode-parent',
      subtype: 'code_mode_operation',
      codeModeOperation: { eventRefs: ['nested-event'] },
    },
  ]);
  assert.equal(ambiguous.has('nested-event'), false);

  const malformed = codeModePresentationContextMap([{
    id: 'malformed-parent',
    subtype: 'code_mode_operation',
    codeModeOperation: { eventRefs: 'nested-event' },
  }]);
  assert.equal(malformed.size, 0);
});

test('only Main logical DTO responses build one reverse context map when needed', () => {
  let mapBuilds = 0;
  const search = createCodexSearch({
    canonicalSchemaVersion: 1,
    codeModePresentationContextMap(logicalEvents) {
      mapBuilds += 1;
      return codeModePresentationContextMap(logicalEvents);
    },
    codexSourceKind: 'codex',
    codexSourceLocator: (source) => source,
    defaultLocale: 'en',
    derivedSessionKind: () => '',
    displayProjectFile: (file) => file,
    eventKindCatalog: () => ({ main: [], protocol: [], raw: [] }),
    localizedLogicalLabel: (event) => event.label,
    normalizeSearchPath: (value) => String(value || ''),
    rawRecordLabel: (raw) => raw.payloadType || raw.recordType,
    rawRef: (raw) => raw,
    resolveLocale: (locale) => locale || 'en',
    sanitizeLogicalEnvelopeValue: (value) => value,
    sanitizeLogicalEventDto: (dto) => dto,
  });
  const logicalEvents = [
    {
      id: 'code-mode-parent',
      layer: 'main',
      kind: 'other_tool_call',
      subtype: 'code_mode_operation',
      label: 'Code Mode operation',
      codeModeOperation: { eventRefs: ['nested-event'] },
      rawRefs: [],
    },
    {
      id: 'nested-event',
      layer: 'main',
      kind: 'mcp_call',
      subtype: 'mcp_tool_call_end',
      label: 'MCP call',
      rawRefs: [],
    },
    {
      id: 'protocol-event',
      layer: 'protocol',
      kind: 'protocol',
      subtype: 'task_started',
      label: 'Task started',
      rawRefs: [],
    },
  ];
  const session = {
    id: 'presentation-context-session',
    title: 'Presentation context',
    sourceFile: 'presentation-context.jsonl',
    bytes: 1,
    lineCount: 1,
    cwdSet: new Set(),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: '',
    updatedAt: '',
    counts: {},
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents,
    rawEvents: [{
      rawId: 'raw-event',
      timestamp: '',
      turnId: '',
      recordType: 'event_msg',
      payloadType: 'token_count',
      role: '',
      preview: '',
      searchText: '',
      status: '',
      toolName: '',
      touchedFiles: [],
      exitCode: 0,
      durationMs: 0,
      source: { file: 'presentation-context.jsonl', line: 1 },
    }],
  };
  const index = {
    repoRoot: '',
    sessions: [session],
    sessionsById: new Map([[session.id, session]]),
  };

  const timeline = search.getTimeline(index, session.id, {
    layer: 'main', offset: 0, limit: 100, locale: 'en', q: '',
  });
  assert.equal(mapBuilds, 1);
  assert.equal(timeline.events.length, 2);
  assert.deepEqual(timeline.events[1].presentationContext, {
    relation: 'enclosed_by_code_mode_operation',
    codeModeParentId: 'code-mode-parent',
  });

  const protocolTimeline = search.getTimeline(index, session.id, {
    layer: 'protocol', offset: 0, limit: 100, locale: 'en', q: '',
  });
  assert.equal(protocolTimeline.events.length, 1);
  assert.equal(mapBuilds, 1);
  assert.equal(search.getEvent(index, session.id, 'protocol-event', { layer: 'protocol', locale: 'en' }).id, 'protocol-event');
  assert.equal(mapBuilds, 1);

  const rawTimeline = search.getTimeline(index, session.id, {
    layer: 'raw', offset: 0, limit: 100, locale: 'en', q: '',
  });
  assert.equal(rawTimeline.events.length, 1);
  assert.equal(mapBuilds, 1);
  assert.equal(search.getEvent(index, session.id, 'raw-event', { layer: 'raw', locale: 'en' }).id, 'raw-event');
  assert.equal(mapBuilds, 1);

  const emptyMainPage = search.getTimeline(index, session.id, {
    layer: 'main', offset: 100, limit: 100, locale: 'en', q: '',
  });
  assert.equal(emptyMainPage.events.length, 0);
  assert.equal(mapBuilds, 1);

  assert.deepEqual(search.getEvent(index, session.id, 'nested-event', { layer: 'main', locale: 'en' }).presentationContext, {
    relation: 'enclosed_by_code_mode_operation',
    codeModeParentId: 'code-mode-parent',
  });
  assert.equal(mapBuilds, 2);
});
