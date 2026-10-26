'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, piAdapter } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');

const timestamp = '2026-10-23T12:00:00.000Z';
const entry = (id, parentId, type, extra) => ({ type, id, parentId, timestamp, ...extra });
const message = (id, parentId, role, fields) => entry(id, parentId, 'message', {
  message: { role, timestamp: Date.parse(timestamp), ...fields },
});
async function fixture(t, rows) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-workflow-edges-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'sessions'));
  const text = [{ type: 'session', version: 3, id: 'workflows', cwd: home, timestamp }, ...rows]
    .map(JSON.stringify).join('\n') + '\n';
  const file = path.join(home, 'sessions', 'synthetic.jsonl');
  await fs.writeFile(file, text);
  const index = await buildPiIndex({ repoRoot: home, sourceHome: home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  return { index, text, file };
}
const contextValue = (detail, key) => detail.inspectorSections.flatMap((section) => section.entries || [])
  .find((item) => item.key === key)?.value;
const detailFor = (index, session, event) => buildEventDetailForSession(index, session, event.id, event.layer);

test('direct user bash workflows preserve success, failure, cancellation and !! context exclusion as history', async (t) => {
  // These are recorded commands only. The reader must never execute them or
  // open fullOutputPath. The fake path deliberately does not exist.
  const cases = [
    { id: 'success', command: 'printf DIRECT_SUCCESS', output: 'SUCCESS_OUTPUT', exitCode: 0, cancelled: false, truncated: false },
    { id: 'failure', command: 'exit 7 # DIRECT_FAILURE', output: 'FAILURE_OUTPUT', exitCode: 7, cancelled: false, truncated: false },
    { id: 'cancel', command: 'recorded-cancel DIRECT_CANCEL', output: 'CANCELLED_OUTPUT', cancelled: true, truncated: false },
    // pi persists the !! prefix as excludeFromContext, not as command text.
    { id: 'excluded', command: 'printf DIRECT_EXCLUDED', output: 'EXCLUDED_HISTORY_OUTPUT', exitCode: 0,
      cancelled: false, truncated: true, excludeFromContext: true, fullOutputPath: '/synthetic/never-open/full-output.txt' },
  ];
  let parent = 'user';
  const rows = [message('user', null, 'user', { content: 'Inspect recorded shell history' })];
  for (const { id, ...fields } of cases) { rows.push(message(id, parent, 'bashExecution', fields)); parent = id; }
  const f = await fixture(t, rows);
  const stored = f.index.sessions[0];
  const session = await materializeSessionForIndex(f.index, stored);
  assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), stored.queryProjectionDigest);
  const events = session.logicalEvents.filter((event) => event.subtype === 'pi_bash_execution');
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((event) => event.status), ['success', 'failed', 'cancelled', 'success']);
  // Existing source-neutral accounting includes every command in toolCalls,
  // even a user shell command with no assistant call/result pair.
  assert.equal(session.counts.toolCalls, 4);
  assert.equal(session.counts.failedCommands, 1, 'user cancellation is not a failed command');
  assert.equal(session.counts.assistantMessages, 0);
  assert.ok(session.logicalEvents.every((event) => event.subtype !== 'pi_unpaired_tool_result'));
  for (const [i, event] of events.entries()) {
    const saved = cases[i];
    assert.equal(event.kind, 'command');
    assert.equal(event.rawRefs.length, 1, 'direct commands must not fabricate an assistant request');
    assert.equal(event.outputStats.exitCode, saved.exitCode ?? null);
    const detail = await detailFor(f.index, session, event);
    assert.ok(detail.timelineSections.some((section) => section.code === saved.command));
    assert.ok(detail.timelineSections.some((section) => section.text === saved.output));
    assert.equal(contextValue(detail, 'Cancelled'), String(saved.cancelled));
    assert.equal(contextValue(detail, 'Truncated'), String(saved.truncated));
    assert.equal(contextValue(detail, 'Excluded from model context'), String(saved.excludeFromContext === true));
    const raw = await readIndexedRawRecord(f.index, session, event.rawRefs[0].rawId);
    assert.deepEqual(JSON.parse(raw.raw), rows[i + 1]);
  }
  const excluded = await piAdapter.query.filterSessions(f.index, { layer: 'main', q: 'EXCLUDED_HISTORY_OUTPUT', limit: 20, offset: 0 });
  assert.equal(excluded.total, 1, '!! exclusion affects model context, not historical search');
  assert.equal(excluded.matchingEventTotal, 1);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('label deletion and empty labels retain clearing evidence and exact earlier target navigation', async (t) => {
  const labels = [
    entry('set', 'user', 'label', { targetId: 'user', label: 'bookmark' }),
    entry('clear-omitted', 'set', 'label', { targetId: 'user' }),
    entry('set-again', 'clear-omitted', 'label', { targetId: 'user', label: 'replacement' }),
    entry('clear-empty', 'set-again', 'label', { targetId: 'user', label: '' }),
  ];
  const f = await fixture(t, [message('user', null, 'user', { content: 'ORIGINAL_LABEL_TARGET' }), ...labels]);
  const session = await materializeSessionForIndex(f.index, f.index.sessions[0]);
  for (const saved of labels) {
    const event = session.logicalEvents.find((item) => item.subtype === 'pi_label'
      && session.rawEvents.find((raw) => raw.rawId === item.rawRefs[0].rawId)?.entryId === saved.id);
    assert.ok(event);
    const detail = await detailFor(f.index, session, event);
    assert.equal(contextValue(detail, 'Recorded label'), saved.label || '(label cleared)');
    assert.equal(contextValue(detail, 'Label target entry id'), 'user');
    const links = detail.inspectorSections.filter((section) => section.type === 'event_refs').flatMap((section) => section.items);
    assert.equal(links.length, 1);
    const target = await readIndexedRawRecord(f.index, session, links[0].id);
    assert.equal(JSON.parse(target.raw).id, 'user');
    const raw = await readIndexedRawRecord(f.index, session, event.rawRefs[0].rawId);
    assert.deepEqual(JSON.parse(raw.raw), saved, 'omitted and empty labels remain distinguishable in Raw');
  }
});

test('session name clearing is branch local and falls back to the original user title', async (t) => {
  const f = await fixture(t, [
    message('user', null, 'user', { content: 'ORIGINAL_TITLE_FALLBACK' }),
    entry('named', 'user', 'session_info', { name: 'TEMPORARY_NAME' }),
    entry('cleared', 'named', 'session_info', { name: '' }),
    message('continued', 'cleared', 'user', { content: 'A later user message' }),
    entry('sibling', 'named', 'session_info', { name: 'SIBLING_NAME' }),
  ]);
  assert.equal(f.index.sessions.length, 2);
  for (const stored of f.index.sessions) {
    const session = await materializeSessionForIndex(f.index, stored);
    assert.equal(session.title, stored.title);
    if (session.sourceDerivedId === 'continued') {
      assert.match(session.title, /ORIGINAL_TITLE_FALLBACK/);
      assert.doesNotMatch(session.title, /TEMPORARY_NAME|SIBLING_NAME|A later user message/);
      const raw = session.rawEvents.find((item) => item.entryId === 'cleared');
      assert.equal(JSON.parse((await readIndexedRawRecord(f.index, session, raw.rawId)).raw).name, '');
    } else assert.match(session.title, /SIBLING_NAME/);
  }
});

test('writer-shaped branch summary points at the abandoned sibling without importing its conversation', async (t) => {
  const savedSummary = entry('summary', 'origin', 'branch_summary', {
    fromId: 'abandoned-answer', summary: 'RECORDED_BRANCH_SUMMARY', fromHook: false,
    details: { synthetic: 'retained details' }, usage: { input: 3, output: 1 },
  });
  const f = await fixture(t, [
    message('origin', null, 'user', { content: 'SHARED_ORIGIN' }),
    message('abandoned-question', 'origin', 'user', { content: 'ABANDONED_QUESTION_ONLY' }),
    message('abandoned-answer', 'abandoned-question', 'assistant', { content: [{ type: 'text', text: 'ABANDONED_ANSWER_ONLY' }] }),
    savedSummary,
    message('resumed', 'summary', 'user', { content: 'RESUMED_BRANCH_ONLY' }),
  ]);
  assert.equal(f.index.sessions.length, 2);
  const stored = f.index.sessions.find((item) => item.sourceDerivedId === 'resumed');
  const session = await materializeSessionForIndex(f.index, stored);
  assert.ok(session.rawEvents.every((raw) => !raw.entryId?.startsWith('abandoned-')));
  assert.doesNotMatch(session.logicalEvents.map((event) => event.searchText).join('\n'), /ABANDONED_(QUESTION|ANSWER)_ONLY/);
  const summary = session.logicalEvents.find((event) => event.subtype === 'pi_branch_summary');
  const detail = await detailFor(f.index, session, summary);
  assert.equal(contextValue(detail, 'Summarized branch entry id'), 'abandoned-answer');
  assert.match(JSON.stringify(detail), /RECORDED_BRANCH_SUMMARY/);
  assert.match(JSON.stringify(detail), /retained details/);
  // Same-session event_refs only resolve selected ancestors. Cross-branch
  // navigation must use the physical entry resolver instead of invented refs.
  assert.ok(detail.inspectorSections.every((section) => section.type !== 'event_refs'));
  const raw = await readIndexedRawRecord(f.index, session, summary.rawRefs[0].rawId);
  assert.deepEqual(JSON.parse(raw.raw), savedSummary);
  const result = await piAdapter.query.filterSessions(f.index, { layer: 'main', q: 'ABANDONED_ANSWER_ONLY', limit: 20, offset: 0 });
  assert.equal(result.total, 1, 'abandoned history belongs to its own selected leaf');
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});
