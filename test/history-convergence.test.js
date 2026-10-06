'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRows } = require('../scripts/measure-history-convergence');

const identity = { condition: 'api', trial: 'synthetic', corpus: { corpusHash: 'abc' } };
const event = (ref, hitOffset, text) => ({ ref, sessionId: 's1', layer: 'main', eventId: 'e1',
  excerpt: { representation: 'search_projection', hitOffset, text, truncated: true } });
const row = (operation, result, extra = {}) => ({ identity, phase: 'retrieval', args: ['server.js', 'history', operation, ...(extra.refs ? ['--refs', extra.refs] : [])],
  deliveredStdout: result === null ? '' : JSON.stringify({ operation: `history.${operation}`, contextRef: 'ctx', items: result }),
  exitCode: 0, executed: true, ...extra });

test('distinguishes hit positions and repeated excerpts from unique events, and resolves compact read handle', () => {
  const rows = [
    row('search', [event('hr1.namespace.0', 4, 'first excerpt')]),
    row('search', [event('hr1.namespace.1', 19, 'second excerpt')]),
    row('search', [event('hr1.namespace.0', 4, 'first excerpt')]),
    row('read', [{ ref: 'hr1.namespace.0', evidenceRef: 'er2.scope.session.snapshot.main.e.event.4',
      parts: [{ part: 'projection', text: 'full material', available: true }] }], { refs: 'hr1.namespace.0' })
  ];
  const result = analyzeRows(rows);
  assert.equal(result.metrics.searchHits, 3);
  assert.equal(result.metrics.uniqueSearchEvents, 1);
  assert.equal(result.metrics.distinctKnownMatchPositions, 2);
  assert.equal(result.metrics.searchesBeforeFirstRead, 3);
  assert.equal(result.metrics.independentQueriesBeforeFirstRead, 3);
  assert.equal(result.metrics.searchEventsRead, 1);
  assert.equal(result.metrics.searchToReadConversion, 1);
  assert.equal(result.metrics.unknownReadRequests, 0);
  assert.equal(result.metrics.returnedExcerptBytes, Buffer.byteLength('first excerptsecond excerptfirst excerpt'));
  assert.equal(result.metrics.repeatedIdenticalExcerptBytes, Buffer.byteLength('first excerpt'));
  assert.equal(result.metrics.incompleteExcerptCount, 3);
  assert.equal(result.annotation.answerSupported, null);
});

test('durable read aliases ignore hit offsets while preserving source scope and snapshot', () => {
  const ref = 'er2.scope.session.snapshot.main.e.event.4';
  const changedOffset = 'er2.scope.session.snapshot.main.e.event.200';
  const changedSnapshot = 'er2.scope.session.other.main.e.event.200';
  const changedScope = 'er2.other.session.snapshot.main.e.event.200';
  const result = analyzeRows([
    row('search', [event(ref, 4, 'clue')]),
    row('read', [{ ref: changedOffset, parts: [] }], { refs: changedOffset }),
    row('read', [{ ref: changedSnapshot, parts: [] }], { refs: changedSnapshot }),
    row('read', [{ ref: changedScope, parts: [] }], { refs: changedScope }),
  ]);
  assert.equal(result.metrics.searchEventsRead, 1);
  assert.equal(result.metrics.uniqueReadEvents, 3);
  assert.equal(result.metrics.uniqueShownEvents, 3);
  assert.equal(result.metrics.searchToReadConversion, 1);
});

test('CLI help is not discovery or reading while literal help-shaped clues remain searches', () => {
  const result = analyzeRows([
    row('search', null, { args: ['server.js', 'history', 'search', '--help'], deliveredStdout: 'Usage: history search' }),
    row('read', null, { args: ['server.js', 'history', 'read', '--help'], deliveredStdout: 'Usage: history read' }),
    row('search', [event('hr1.namespace.0', 0, '--help')], { args: ['server.js', 'history', 'search', '--query', '--help'] }),
    row('read', [{ ref: 'hr1.namespace.0', parts: [] }], { refs: 'hr1.namespace.0' }),
  ]);
  assert.equal(result.metrics.searchRequests, 1);
  assert.equal(result.metrics.readAttempts, 1);
  assert.equal(result.metrics.searchesBeforeFirstRead, 1);
  assert.deepEqual(result.calls.map((call) => call.operation), ['help', 'help', 'search', 'read']);
});

test('grouped search counts independent queries and only returned group excerpts', () => {
  const grouped = { operation: 'history.search', contextRef: 'ctx', items: [], groups: [
    { id: 'a', queryIdentity: 'qa', state: 'complete', scan: { complete: true },
      items: [event('hr1.namespace.0', 4, 'same'), event('hr1.namespace.1', 7, 'different')] },
    { id: 'b', queryIdentity: 'qb', state: 'complete', scan: { complete: true },
      items: [event('hr1.namespace.0', 4, 'same')] },
    { id: 'c', queryIdentity: 'qc', state: 'results_omitted', scan: { complete: true }, items: [] },
    { id: 'd', queryIdentity: 'qd', state: 'not_executed', scan: { complete: false }, items: [] }
  ] };
  const rows = [{ ...row('search', []), deliveredStdout: JSON.stringify(grouped) },
    row('read', [{ ref: 'hr1.namespace.0', evidenceRef: 'er2.scope.session.snapshot.main.e.event.4', parts: [] }],
      { args: ['server.js', 'history', 'read', '--input', JSON.stringify({ refs: ['hr1.namespace.0'] })] })];
  const result = analyzeRows(rows);
  assert.equal(result.metrics.searchRequests, 1);
  assert.equal(result.metrics.independentQueriesRequested, 4);
  assert.equal(result.metrics.independentQueriesExecuted, 3);
  assert.equal(result.metrics.independentQueriesNotExecuted, 1);
  assert.equal(result.metrics.independentQueryResultsOmitted, 1);
  assert.equal(result.metrics.independentQueriesBeforeFirstRead, 4);
  assert.equal(result.metrics.searchHits, 3);
  assert.equal(result.metrics.uniqueSearchEvents, 1);
  assert.equal(result.metrics.distinctKnownMatchPositions, 2);
  assert.equal(result.metrics.repeatedIdenticalExcerptBytes, Buffer.byteLength('same'));
  assert.equal(result.metrics.knownReadRequests, 1);
  assert.equal(result.metrics.searchEventsRead, 1);
});

test('opaque refs are not split on commas; unclassifiable exec calls remain unknown', () => {
  const rows = [row('read', [], { refs: 'hr1.namespace,withcomma.0' }),
    { identity, phase: 'retrieval', command: 'pwsh.exe', args: ['-File', 'opaque.ps1'],
      executed: true, stdout: '', exitCode: 0 }];
  const result = analyzeRows(rows);
  assert.equal(result.metrics.unknownReadRequests, 1);
  assert.equal(result.metrics.unclassifiedExecCalls, 1);
  assert.equal(result.calls[1].operation, null);
});

test('denied and failed reads do not end discovery before a successful read', () => {
  const denied = { ...row('read', null, { refs: 'hr1.namespace.0' }), executed: false,
    exitCode: null, error: { code: 'RETRIEVAL_BUDGET_EXCEEDED', message: 'denied' } };
  const failed = { ...row('read', [], { refs: 'hr1.namespace.0' }), exitCode: 1,
    error: { code: 'READ_FAILED', message: 'failed' } };
  const rows = [denied, row('search', [event('hr1.namespace.0', 4, 'clue')]),
    failed, row('search', [event('hr1.namespace.0', 4, 'clue')]),
    row('read', [{ ref: 'hr1.namespace.0', evidenceRef: 'er2.scope.session.snapshot.main.e.event.4', parts: [] }],
      { refs: 'hr1.namespace.0' })];
  const result = analyzeRows(rows);
  assert.equal(result.metrics.readAttempts, 3);
  assert.equal(result.metrics.executedReadRequests, 2);
  assert.equal(result.metrics.successfulReadRequests, 1);
  assert.equal(result.metrics.firstReadStep, 5);
  assert.equal(result.metrics.searchesBeforeFirstRead, 2);
  assert.equal(result.metrics.searchRequests, 2);
  assert.equal(result.metrics.executedSearchRequests, 2);
  assert.equal(result.metrics.unknownReadRequests, 1);
  assert.equal(result.calls[0].error.code, 'RETRIEVAL_BUDGET_EXCEEDED');
  assert.equal(result.calls[2].exitCode, 1);
});

test('denied search is an attempt but not an executed search before first read', () => {
  const denied = { ...row('search', null), executed: false, exitCode: null,
    error: { code: 'RETRIEVAL_BUDGET_EXCEEDED', message: 'denied' } };
  const result = analyzeRows([denied, row('read', [], { refs: 'er2.scope.session.snapshot.main.e.event.0' })]);
  assert.equal(result.metrics.searchRequests, 1);
  assert.equal(result.metrics.executedSearchRequests, 0);
  assert.equal(result.metrics.searchesBeforeFirstRead, 0);
  assert.equal(result.metrics.firstReadStep, 2);
});

test('keeps failed and truncated calls, unknown references, and no-read correctness unscored', () => {
  const rows = [
    row('search', [{ ref: 'hr1.unknown.0', excerpt: { text: 'brief' } }]),
    { ...row('read', null, { refs: 'hr1.unknown.0' }), deliveredStdout: '{bad', exitCode: 1,
      error: { code: 'TIMEOUT', message: 'timed out' }, captureComplete: false, outputTruncated: true },
    row('search', [])
  ];
  const result = analyzeRows(rows);
  assert.equal(result.metrics.unknownSearchHits, 1);
  assert.equal(result.metrics.unknownReadRequests, 1);
  assert.equal(result.calls[1].error.code, 'TIMEOUT');
  assert.equal(result.calls[1].captureComplete, false);
  assert.equal(result.calls[1].parsed, false);
  assert.equal(result.annotation.answerSupported, null);
  const noRead = analyzeRows([row('search', [])], { provenance: 'human-reviewed answer, 2026-09-26', answerSupported: true, evidenceUsed: false });
  assert.equal(noRead.metrics.searchesBeforeFirstRead, null);
  assert.equal(noRead.metrics.searchesWithoutObservedRead, 1);
  assert.equal(noRead.annotation.answerSupported, true);
  assert.equal(noRead.metrics.searchToReadConversion, null);
});

test('rejects an annotation without provenance or with invented score type', () => {
  const rows = [row('search', [])];
  assert.throws(() => analyzeRows(rows, { answerSupported: true }), /provenance/u);
  assert.throws(() => analyzeRows(rows, { provenance: 'review', answerSupported: 'yes' }), /boolean/u);
});
