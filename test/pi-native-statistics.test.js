'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { nativeStatistics, iteratePiPhysicalContributors } = require('../src/pi-native-statistics');
const { parsePiDocument } = require('../src/pi-storage');
const { branchUsageSummary, recordedUsageSummary } = require('../src/pi-recorded-state');
const { buildPiIndex, piAdapter } = require('../src/pi');
const { readPiNavigation } = require('../src/pi-navigation');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');

const header = { type: 'session', version: 3, id: 'native-statistics', cwd: '/synthetic-project' };
const entry = (type, id, parentId, rest = {}) => ({ type, id, parentId, ...rest });
const message = (id, parentId, role, rest = {}) => entry('message', id, parentId, { message: { role, ...rest } });
const call = (id = 'call') => ({ type: 'toolCall', id, name: 'edit', arguments: { path: 'a.js', edits: [{ oldText: 'a', newText: 'b' }] } });
const serialize = (rows) => rows.map((row) => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n';
const document = (entries) => parsePiDocument({ lines: serialize([header, ...entries]).trimEnd().split('\n') });
const summary = (entries) => nativeStatistics(document(entries), 'history.jsonl');

async function fixture(t, entries, tail = '') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-native-statistics-'));
  const file = path.join(home, 'sessions', 'history.jsonl');
  await fs.mkdir(path.dirname(file));
  const localHeader = { ...header, cwd: home };
  await fs.writeFile(file, serialize([localHeader, ...entries]) + tail);
  const indexes = [];
  t.after(async () => {
    for (const index of indexes) await disposeProjectQueryStore(index.projectQueryStore);
    await fs.rm(home, { recursive: true, force: true });
  });
  const rebuild = async () => {
    const index = await buildPiIndex({ sourceHome: home, repoRoot: home });
    indexes.push(index);
    return index;
  };
  return { home, file, header: localHeader, rebuild, index: await rebuild() };
}

test('native physical counts distinguish messages, request blocks, shell records and unlinked evidence', () => {
  const entries = [
    message('u', null, 'user', { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }], usage: { input: 999 } }),
    message('a', 'u', 'assistant', { content: [call(), call(), call(''), { type: 'toolCall' }, { type: 'thinking', thinking: 'why' }], usage: { input: 7 } }),
    message('image', 'a', 'assistant', { content: [{ type: 'image', data: 'opaque' }] }),
    message('empty', 'image', 'assistant', { content: [] }),
    message('system', 'empty', 'system', { usage: { input: 999 } }),
    message('result', 'system', 'toolResult', { toolCallId: 'call', usage: { input: 4 } }),
    message('custom', 'result', 'custom'),
    entry('message', 'unsupported', 'custom', { message: null }),
    message('shell', 'unsupported', 'bashExecution', { command: 'false', exitCode: 1, usage: { input: 999 } }),
    message('cancelled', 'shell', 'bashExecution', { cancelled: true, excludeFromContext: true }),
    { type: 'message', message: { role: 'assistant', content: [call()], usage: { input: 999 } } },
    entry('message', '', null, { message: { role: 'user' } }),
    '{malformed',
    null,
    '',
  ];
  const result = summary(entries);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'scope', 'basis', 'sourceSessionId', 'sourceFile', 'counts', 'usageByCategory']);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scope, 'native_session');
  assert.equal(result.basis, 'accepted_physical_records');
  assert.equal(result.sourceSessionId, header.id);
  assert.equal(result.sourceFile, 'history.jsonl');
  assert.deepEqual(result.counts, { rawRecords: 15, entryRecords: 14, malformedRecords: 1, unlinkedRecords: 4,
    userMessages: 1, assistantMessages: 3, systemMessages: 1, toolResultMessages: 1, otherMessages: 2,
    assistantToolRequests: 4, directShellExecutions: 2 });
  assert.equal(result.usageByCategory.assistant.fields.input.recordedSum, 7);
  assert.equal(result.usageByCategory.assistant.missingUsageRecords, 2);
  assert.equal(result.usageByCategory.tool_nested_model_work.fields.input.recordedSum, 4);
  assert.deepEqual(Object.keys(result.usageByCategory).sort(), ['assistant', 'tool_nested_model_work']);
  assert.equal(result.counts.patches, undefined);
  assert.equal(result.counts.failedCommands, undefined);
  const contributors = [...iteratePiPhysicalContributors(document(entries))];
  assert.equal(new Set(contributors.map((item) => item.line)).size, 14);
  assert.equal(contributors.filter((item) => item.admitted).length, 10);
});

test('native category partial sums preserve zero, absent and malformed receipts, invalid fields and overflow', () => {
  const entries = [
    message('a', null, 'assistant', { usage: { input: 0, output: '0', reasoning: 2, cacheWrite: 8, cacheWrite1h: 3 } }),
    message('b', 'a', 'assistant'),
    message('c', 'b', 'assistant', { usage: null }),
    message('d', 'c', 'toolResult', { usage: { input: 4, cost: { total: 5 } } }),
    message('e', 'd', 'toolResult'),
    entry('usage', 'f', 'e', { kind: '__proto__', usage: { input: Number.MAX_VALUE, totalTokens: -1 } }),
    entry('usage', 'g', 'f', { kind: 'different', usage: { input: Number.MAX_VALUE } }),
    entry('usage', 'h', 'g', { kind: 'different', usage: { input: 1 } }),
    entry('compaction', 'i', 'h'),
    entry('branch_summary', 'j', 'i', { usage: { output: 0 } }),
  ];
  const categories = summary(entries).usageByCategory;
  assert.deepEqual(Object.keys(categories).sort(), ['assistant', 'branch_summary', 'compaction', 'tool_nested_model_work', 'usage']);
  assert.deepEqual(categories.assistant, { eligibleRecords: 3, missingUsageRecords: 1, receipts: 2, fields: {
    input: { recordedSum: 0, recordedCount: 1, missingCount: 1, invalidCount: 0 },
    output: { recordedSum: null, recordedCount: 0, missingCount: 1, invalidCount: 1 },
    cacheRead: { recordedSum: null, recordedCount: 0, missingCount: 2, invalidCount: 0 },
    cacheWrite: { recordedSum: 8, recordedCount: 1, missingCount: 1, invalidCount: 0 },
    cacheWrite1h: { recordedSum: 3, recordedCount: 1, missingCount: 1, invalidCount: 0 },
    reasoning: { recordedSum: 2, recordedCount: 1, missingCount: 1, invalidCount: 0 },
    totalTokens: { recordedSum: null, recordedCount: 0, missingCount: 2, invalidCount: 0 },
  } });
  assert.deepEqual(categories.compaction, { eligibleRecords: 1, missingUsageRecords: 1, receipts: 0, fields: {} });
  assert.deepEqual(categories.usage.fields.input, { recordedSum: null, recordedCount: 3, missingCount: 0, invalidCount: 0, overflow: true });
  assert.equal(categories.usage.fields.totalTokens.invalidCount, 1);
  assert.equal(categories.branch_summary.fields.output.recordedSum, 0);
  assert.equal(categories.tool_nested_model_work.fields.input.recordedSum, 4);
  assert.equal(categories.tool_nested_model_work.cost, undefined, 'native sums do not invent cost aggregation');
  assert.deepEqual(recordedUsageSummary(entries), branchUsageSummary(entries));
  assert.deepEqual(categories, branchUsageSummary(entries));
});

test('every containing branch receives one native census while preserving distinct outcomes, branch usage and query digests', async (t) => {
  const f = await fixture(t, [
    message('root', null, 'user', { content: 'Fix this' }),
    message('request', 'root', 'assistant', { content: [call()], usage: { input: 7 } }),
    message('success', 'request', 'toolResult', { toolCallId: 'call', toolName: 'edit', isError: false, content: [], usage: { input: 2 } }),
    message('failure', 'request', 'toolResult', { toolCallId: 'call', toolName: 'edit', isError: true, content: [], usage: { input: 3 } }),
    entry('label', 'pending', 'request', { targetId: 'request', label: 'Still open' }),
    message('mismatch', 'request', 'toolResult', { toolCallId: 'call', toolName: 'other', isError: false, usage: { input: 4 } }),
    entry('label', 'success-branch', 'success', { targetId: 'success', label: 'Valid unique result' }),
    message('duplicate', 'success', 'toolResult', { toolCallId: 'call', toolName: 'edit', isError: false, usage: { input: 5 } }),
  ]);
  const before = await fs.readFile(f.file);
  const baseline = f.index.sessions.map((item) => ({ id: item.id, counts: structuredClone(item.counts), digest: item.queryProjectionDigest }));
  let expected;
  for (const indexed of f.index.sessions) {
    const navigation = await readPiNavigation(f.index, indexed);
    expected ||= navigation.nativeStatistics;
    assert.deepEqual(navigation.nativeStatistics, expected);
    const session = await materializeSessionForIndex(f.index, indexed);
    assert.deepEqual(session.counts, indexed.counts);
    assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), indexed.queryProjectionDigest);
    const request = session.logicalEvents.find((item) => item.pi?.callId === 'call');
    assert.equal(request.status, indexed.sourceDerivedId === 'failure' ? 'failed'
      : indexed.sourceDerivedId === 'success-branch' ? 'success' : 'incomplete');
    assert.equal(branchUsageSummary(session.rawEvents).assistant.fields.input.recordedSum, 7);
    assert.equal(request.rawRefs.length, ['failure', 'success-branch'].includes(indexed.sourceDerivedId) ? 2 : 1,
      'duplicate results on one path and mismatched siblings never complete each other');
  }
  assert.equal(f.index.sessions.length, 5);
  assert.equal(expected.counts.assistantToolRequests, 1);
  assert.equal(expected.counts.toolResultMessages, 4);
  assert.equal(expected.usageByCategory.assistant.fields.input.recordedSum, 7);
  assert.equal(expected.usageByCategory.tool_nested_model_work.fields.input.recordedSum, 14);
  assert.deepEqual(f.index.sessions.map((item) => ({ id: item.id, counts: item.counts, digest: item.queryProjectionDigest })), baseline);
  assert.deepEqual(await fs.readFile(f.file), before);
});

test('native totals include leaves beyond the 100-branch overview and do not multiply a shared prefix', async (t) => {
  const shared = [message('root', null, 'assistant', { content: [call()], usage: { input: 9, output: 0 } })];
  const f = await fixture(t, [...shared, ...Array.from({ length: 105 }, (_, index) =>
    message(`leaf-${index}`, 'root', 'toolResult', { toolCallId: 'call', toolName: 'edit', isError: false, usage: { input: index } }))]);
  const first = await readPiNavigation(f.index, f.index.sessions[0]);
  const last = await readPiNavigation(f.index, f.index.sessions.at(-1));
  assert.equal(first.branches.length, 100);
  assert.equal(first.truncated, true);
  assert.equal(first.nativeStatistics.counts.rawRecords, 107);
  assert.equal(first.nativeStatistics.counts.assistantToolRequests, 1);
  assert.equal(first.nativeStatistics.counts.toolResultMessages, 105);
  assert.equal(first.nativeStatistics.usageByCategory.assistant.fields.input.recordedSum, 9);
  assert.equal(first.nativeStatistics.usageByCategory.tool_nested_model_work.fields.input.recordedSum, 5460);
  assert.deepEqual(last.nativeStatistics, first.nativeStatistics);
  for (const leaves of [2, 16, 105]) {
    const result = summary([...shared, ...Array.from({ length: leaves }, (_, index) => entry('label', `mark-${index}`, 'root'))]);
    assert.equal(result.counts.assistantToolRequests, 1);
    assert.equal(result.usageByCategory.assistant.fields.input.recordedSum, 9);
  }
});

test('header-only history has physical evidence and no invented usage observations', () => {
  const result = summary([]);
  assert.equal(result.counts.rawRecords, 1);
  assert.equal(result.counts.entryRecords, 0);
  assert.equal(result.counts.assistantMessages, 0);
  assert.deepEqual(result.usageByCategory, {});
});

test('navigation retains complete malformed and loose physical rows while excluding their semantic contributions', async (t) => {
  const f = await fixture(t, [
    message('admitted', null, 'assistant', { content: 'Saved evidence', usage: { input: 3 } }),
    { type: 'message', message: { role: 'assistant', content: [call()], usage: { input: 999 } } },
    '{broken',
    '',
  ]);
  const result = (await readPiNavigation(f.index, f.index.sessions[0])).nativeStatistics;
  assert.equal(result.counts.rawRecords, 4);
  assert.equal(result.counts.entryRecords, 3);
  assert.equal(result.counts.unlinkedRecords, 2);
  assert.equal(result.counts.malformedRecords, 1);
  assert.equal(result.counts.assistantMessages, 1);
  assert.equal(result.counts.assistantToolRequests, 0);
  assert.equal(result.usageByCategory.assistant.fields.input.recordedSum, 3);
  const session = await materializeSessionForIndex(f.index, f.index.sessions[0]);
  assert.equal(session.rawEventCount, 4, 'excluded semantic contributors remain accessible physical evidence');
  assert.deepEqual(session.counts, f.index.sessions[0].counts);
  assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), f.index.sessions[0].queryProjectionDigest);
});

test('invalid trees acquire neither a native summary nor navigation semantics', async (t) => {
  for (const entries of [
    [message('orphan', 'missing', 'assistant', { usage: { input: 100 } })],
    [message('same', null, 'assistant'), message('same', null, 'assistant')],
    [message('cycle-a', 'cycle-b', 'assistant'), message('cycle-b', 'cycle-a', 'assistant')],
  ]) {
    assert.equal(nativeStatistics(document(entries), 'history.jsonl'), null);
  }
  const f = await fixture(t, [message('orphan', 'missing', 'assistant', { usage: { input: 100 } })]);
  assert.equal(await readPiNavigation(f.index, f.index.sessions[0]), null);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => nativeStatistics(document([]), 'history.jsonl', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(readPiNavigation(f.index, f.index.sessions[0], { signal: controller.signal }), { name: 'AbortError' });
});

test('torn tails and appends stay outside native counts until rebuild; stale accepted evidence fails closed', async (t) => {
  const later = message('later', 'a', 'assistant', { content: 'new', usage: { input: 5 } });
  const f = await fixture(t, [message('a', null, 'assistant', { usage: { input: 2 } })], JSON.stringify(later));
  assert.ok(f.index.sourceDiagnostics.totalCount > 0);
  const original = (await readPiNavigation(f.index, f.index.sessions[0])).nativeStatistics;
  assert.equal(original.counts.entryRecords, 1);
  await fs.appendFile(f.file, '\n');
  assert.deepEqual((await readPiNavigation(f.index, f.index.sessions[0])).nativeStatistics, original);
  const next = await f.rebuild();
  const updated = (await readPiNavigation(next, next.sessions[0])).nativeStatistics;
  assert.equal(updated.counts.entryRecords, 2);
  assert.equal(updated.usageByCategory.assistant.fields.input.recordedSum, 7);
  const content = await fs.readFile(f.file, 'utf8');
  await fs.writeFile(f.file, content.replace('"input":2', '"input":3'));
  await assert.rejects(readPiNavigation(next, next.sessions[0]), { code: 'INDEXED_SOURCE_STALE', statusCode: 409 });
});

test('ambiguous native identities are excluded rather than merging their physical contributors', async (t) => {
  const f = await fixture(t, [message('a', null, 'assistant', { usage: { input: 3 } })]);
  await fs.copyFile(f.file, path.join(path.dirname(f.file), 'duplicate.jsonl'));
  const next = await f.rebuild();
  assert.equal(next.sessions.length, 0);
  assert.ok(next.sourceDiagnostics.totalCount > 0);
  await assert.rejects(readPiNavigation(next, f.index.sessions[0]), { code: 'INDEXED_SOURCE_STALE' });
});

test('navigation HTTP returns scope-bound native counts and refuses a mismatched source/project/revision', async (t) => {
  const f = await fixture(t, [message('a', null, 'assistant', { usage: { input: 0 } })]);
  const service = await createHistoryService({ source: 'pi', piHome: f.home, repo: f.home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(base + '/api/state')).json();
  const params = new URLSearchParams({ source: 'pi', repoRoot: f.home, indexRevision: state.indexRevision, sessionId: f.index.sessions[0].id });
  const get = () => fetch(base + '/api/pi/navigation?' + params);
  const response = await get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.indexRevision, state.indexRevision);
  assert.deepEqual(body.nativeStatistics, (await readPiNavigation(f.index, f.index.sessions[0])).nativeStatistics);
  params.set('repoRoot', f.home + '-other');
  assert.equal((await get()).status, 404);
  params.set('repoRoot', f.home);
  params.set('source', 'codex');
  assert.equal((await get()).status, 400);
  params.set('source', 'pi');
  params.set('indexRevision', String(state.indexRevision + 1));
  assert.equal((await get()).status, 409);
  params.set('indexRevision', state.indexRevision);
  await fs.truncate(f.file, 0);
  const stale = await get();
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'INDEXED_SOURCE_STALE');
});
