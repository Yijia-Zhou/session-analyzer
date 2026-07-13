'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { fileSuggestions, filterSessions, getTimeline } = require('../src/codex');

function logicalEvent(id, options = {}) {
  const line = options.line || 1;
  return {
    id,
    schemaVersion: 1,
    sourceKind: 'codex',
    layer: options.layer || 'main',
    kind: options.kind || 'command',
    subtype: options.subtype || options.kind || 'command',
    label: options.label || 'Command',
    timestamp: options.timestamp || '2026-06-29T10:00:00.000Z',
    turnId: '',
    role: '',
    preview: options.preview || '',
    searchText: options.searchText ?? options.preview ?? '',
    severity: 'normal',
    status: options.status || 'success',
    toolName: options.toolName || '',
    hasLongOutput: false,
    hasReadableReasoning: false,
    tags: [],
    touchedFiles: options.touchedFiles || [],
    outputStats: {},
    source: { file: `${id}.jsonl`, line },
    sourceLocator: { type: 'jsonl_line', file: `${id}.jsonl`, line },
    rawRefs: [{ file: `${id}.jsonl`, line, rawId: `${id}:raw` }],
    channels: ['event_msg'],
  };
}

function rawEvent(id, options = {}) {
  const line = options.line || 1;
  return {
    rawId: id,
    timestamp: options.timestamp || '2026-06-29T10:00:00.000Z',
    turnId: '',
    recordType: 'event_msg',
    payloadType: options.payloadType || 'exec_command_end',
    role: '',
    preview: options.preview || '',
    searchText: options.searchText ?? options.preview ?? '',
    status: options.status || 'success',
    toolName: '',
    touchedFiles: options.touchedFiles || [],
    exitCode: 0,
    durationMs: 0,
    source: { file: `${id}.jsonl`, line },
  };
}

function session(id, logicalEvents, rawEvents = []) {
  return {
    id,
    title: `Session ${id}`,
    sourceFile: `${id}.jsonl`,
    bytes: 100,
    lineCount: 10,
    cwdSet: new Set(['G:\\repo']),
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    agentNickname: '',
    startedAt: '2026-06-29T08:00:00.000Z',
    updatedAt: logicalEvents.at(-1)?.timestamp || '2026-06-29T08:00:00.000Z',
    counts: { failedCommands: logicalEvents.filter((event) => event.status === 'failed').length },
    analysis: { toolUsage: [], failedCommands: [], patchedFiles: [], protocolStats: [] },
    logicalEvents,
    rawEvents,
  };
}

function searchIndex() {
  const first = session('first', [
    logicalEvent('first-main-success', {
      timestamp: '2026-06-29T09:00:00.000Z',
      preview: 'alpha appears only on a successful event',
      status: 'success',
      touchedFiles: ['G:\\repo\\src\\success.js'],
    }),
    logicalEvent('first-earlier', {
      timestamp: '2026-06-29T10:00:00.000Z',
      preview: 'Earlier alpha alpha match',
      status: 'failed',
      touchedFiles: ['G:\\repo\\src\\a.js', 'G:\\repo\\src\\a.js'],
    }),
    logicalEvent('first-latest-hit', {
      timestamp: '2026-06-29T12:00:00.000Z',
      preview: 'Latest alpha\n\t target in the event',
      status: 'failed',
      touchedFiles: ['G:\\repo\\src\\a.js', 'G:\\repo\\src\\b.js'],
    }),
    logicalEvent('first-latest-structural', {
      timestamp: '2026-06-29T14:00:00.000Z',
      preview: 'A failed event without the phrase',
      status: 'failed',
      touchedFiles: ['G:\\repo\\src\\b.js'],
    }),
    logicalEvent('first-protocol', {
      layer: 'protocol',
      kind: 'protocol',
      subtype: 'warning',
      label: 'Warning',
      timestamp: '2026-06-29T15:00:00.000Z',
      preview: 'protocol-only alpha target',
      status: 'failed',
      touchedFiles: ['G:\\repo\\src\\protocol.js'],
    }),
  ], [
    rawEvent('first-raw-1', { touchedFiles: ['G:\\repo\\src\\raw.js', 'G:\\repo\\src\\raw.js'] }),
    rawEvent('first-raw-2', { touchedFiles: ['G:\\repo\\src\\raw.js'] }),
  ]);
  const second = session('second', [
    logicalEvent('second-hit', {
      timestamp: '2026-06-29T11:00:00.000Z',
      preview: 'Second preview without the phrase',
      searchText: 'Second alpha target in canonical search text',
      status: 'failed',
      touchedFiles: ['G:\\repo\\src\\a.js'],
    }),
  ]);
  const split = session('split', [
    logicalEvent('split-query', {
      timestamp: '2026-06-29T13:00:00.000Z',
      preview: 'alpha target on the wrong event',
      status: 'success',
    }),
    logicalEvent('split-filter', {
      timestamp: '2026-06-29T16:00:00.000Z',
      preview: 'failed but no matching phrase',
      status: 'failed',
    }),
  ]);
  const sessions = [first, second, split];
  return {
    repoRoot: 'G:\\repo',
    sessions,
    sessionsById: new Map(sessions.map((item) => [item.id, item])),
  };
}

test('project search intersects query and filters per event and returns deterministic match metadata', () => {
  const index = searchIndex();
  assert.ok(index.sessions.every((item) => !Object.hasOwn(item, 'searchText')));
  const result = filterSessions(index, {
    q: 'alpha target',
    file: 'src/a.js',
    kind: 'command',
    status: 'failed',
    layer: 'main',
    sort: 'latest-match-desc',
    locale: 'en',
  });

  assert.equal(result.total, 2);
  assert.equal(result.matchingEventTotal, 2);
  assert.deepEqual(result.sessions.map((item) => item.id), ['first', 'second']);
  assert.equal(result.sessions.some((item) => item.id === 'split'), false);
  assert.deepEqual(result.sessions[0].searchMatch, {
    eventCount: 1,
    latestEvent: {
      id: 'first-latest-hit',
      timestamp: '2026-06-29T12:00:00.000Z',
      label: 'Command',
      snippet: 'Latest alpha target in the event',
      timelineIndex: 1,
    },
  });
});

test('project search supports filter-only results, layer isolation, and localized labels', () => {
  const index = searchIndex();
  const filterOnly = filterSessions(index, { q: '', status: 'failed', layer: 'main', locale: 'en' });
  assert.equal(filterOnly.total, 3);
  assert.equal(filterOnly.matchingEventTotal, 5);
  assert.equal(filterOnly.sessions[0].id, 'split');
  assert.equal(filterOnly.sessions[0].searchMatch.latestEvent.snippet, 'failed but no matching phrase');

  assert.equal(filterSessions(index, { q: 'protocol-only', layer: 'main' }).total, 0);
  const protocol = filterSessions(index, { q: 'protocol-only', layer: 'protocol', locale: 'zh-CN' });
  assert.equal(protocol.total, 1);
  assert.equal(protocol.sessions[0].searchMatch.latestEvent.id, 'first-protocol');
  assert.equal(protocol.sessions[0].searchMatch.latestEvent.label, '警告');

  const sensitiveEvent = index.sessionsById.get('second').logicalEvents[0];
  sensitiveEvent.preview = 'alpha target data:image/png;base64,QUJD';
  sensitiveEvent.searchText = sensitiveEvent.preview;
  const sanitized = filterSessions(index, { q: 'alpha target', layer: 'main', locale: 'en' });
  const sensitiveSnippet = sanitized.sessions.find((item) => item.id === 'second').searchMatch.latestEvent.snippet;
  assert.match(sensitiveSnippet, /\[embedded data URL omitted; see raw refs\]/);
  assert.doesNotMatch(sensitiveSnippet, /QUJD/);

  const ordinary = filterSessions(index, { q: '', layer: 'protocol', sort: 'updated-desc' });
  assert.equal(ordinary.total, 3);
  assert.deepEqual(ordinary.sessions.map((item) => item.id), ['split', 'first', 'second']);
  assert.equal(Object.hasOwn(ordinary, 'matchingEventTotal'), false);
  assert.equal(Object.hasOwn(ordinary.sessions[0], 'searchMatch'), false);
});

test('timeline reports matching events separately from phrase occurrences without filtering membership', () => {
  const index = searchIndex();
  const timeline = getTimeline(index, 'first', {
    offset: 0,
    limit: 100,
    q: 'alpha',
    kind: '',
    status: 'failed',
    tool: '',
    file: '',
    layer: 'main',
    locale: 'en',
  });

  assert.equal(timeline.total, 3);
  assert.equal(timeline.events.length, 3);
  assert.equal(timeline.searchEventCount, 2);
  assert.equal(timeline.searchMatchCount, 3);
  assert.deepEqual(timeline.events.map((event) => event.hasSearchHit), [true, true, false]);
});

test('file suggestions respect session and layer boundaries and count events once per file', () => {
  const index = searchIndex();
  assert.deepEqual(fileSuggestions(index, { layer: 'main', sessionId: 'first' }), [
    { file: 'src/a.js', count: 2 },
    { file: 'src/b.js', count: 2 },
    { file: 'src/success.js', count: 1 },
  ]);
  assert.deepEqual(fileSuggestions(index, { layer: 'main' }).slice(0, 2), [
    { file: 'src/a.js', count: 3 },
    { file: 'src/b.js', count: 2 },
  ]);
  assert.deepEqual(fileSuggestions(index, { layer: 'protocol' }), [
    { file: 'src/protocol.js', count: 1 },
  ]);
  assert.deepEqual(fileSuggestions(index, { layer: 'raw', sessionId: 'first' }), [
    { file: 'src/raw.js', count: 2 },
  ]);
});

test('HTTP search and suggestion routes expose the additive backend contracts', async () => {
  const index = searchIndex();
  const server = createServer(index, 1);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const resultsResponse = await fetch(`http://127.0.0.1:${address.port}/api/sessions?q=alpha%20target&status=failed&layer=main&sort=latest-match-desc`);
    assert.equal(resultsResponse.status, 200);
    const results = await resultsResponse.json();
    assert.equal(results.total, 2);
    assert.equal(results.matchingEventTotal, 2);
    assert.equal(results.sessions[0].searchMatch.latestEvent.timelineIndex, 1);

    const suggestionsResponse = await fetch(`http://127.0.0.1:${address.port}/api/file-suggestions?layer=protocol&sessionId=first`);
    assert.equal(suggestionsResponse.status, 200);
    assert.deepEqual(await suggestionsResponse.json(), { files: [{ file: 'src/protocol.js', count: 1 }] });

    const timelineResponse = await fetch(`http://127.0.0.1:${address.port}/api/sessions/first/timeline?q=alpha&status=failed&layer=main&offset=0&limit=100`);
    assert.equal(timelineResponse.status, 200);
    const timeline = await timelineResponse.json();
    assert.equal(timeline.total, 3);
    assert.equal(timeline.searchEventCount, 2);
    assert.equal(timeline.searchMatchCount, 3);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
