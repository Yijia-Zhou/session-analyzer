'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, piAdapter } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { projectQueryProjectionDigestAsync, disposeProjectQueryStore } = require('../src/project-query-store');
const { branchUsageSummary } = require('../src/pi-recorded-state');

test('pi file changes and shared tool outcomes remain branch-scoped through indexing, search, activity and Raw', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-file-accounting-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', 'branches.jsonl');
  const rows = [{ type: 'session', version: 3, id: 'file-branches', cwd: home }];
  const message = (id, parentId, value) => rows.push({ type: 'message', id, parentId, message: value });
  const call = (id, parentId, name, args, extra = {}) => message(id, parentId, {
    role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], ...extra,
  });
  const result = (id, parentId, callId, toolName, isError, details = {}) => message(id, parentId, {
    role: 'toolResult', toolCallId: callId, toolName, isError, content: [{ type: 'text', text: `${id} receipt` }], details,
  });
  call('read', null, 'read', { path: 'src/a.js', offset: 1, limit: 2 });
  result('read-result', 'read', 'read', 'read', false);
  call('write', 'read-result', 'write', { path: 'src/a.js', content: 'recorded requested rewrite' });
  result('write-result', 'write', 'write', 'write', false);
  call('edit', 'write-result', 'edit', { path: 'src/a.js', edits: [{ oldText: 'before', newText: 'after' }] }, { usage: { input: 7 } });
  const patch = '--- src/a.js\n+++ src/a.js\n@@ -1,2 +1,2 @@\n-before\n+after\n PATCH_ONLY_CONTEXT\n';
  result('success', 'edit', 'edit', 'edit', false, { patch });
  result('failure', 'edit', 'edit', 'edit', true, { patch });
  result('contradictory', 'edit', 'edit', 'edit', false, { patch: patch.replace('+1,2 @@', '+20,2 @@') });
  rows.push({ type: 'label', id: 'pending', parentId: 'edit', targetId: 'edit', label: 'Unfinished path' });
  const original = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, original);
  const index = await buildPiIndex({ sourceHome: home, repoRoot: home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  assert.equal(index.sessions.length, 4, 'one native artifact has four independently selectable branch Sessions');
  const sharedCallLocators = [];
  for (const stored of index.sessions) {
    const success = stored.sourceDerivedId === 'success';
    assert.equal(stored.counts.toolCalls, 3);
    assert.equal(stored.counts.patches, success ? 1 : 0);
    assert.equal(stored.bytes, Buffer.byteLength(original), 'bytes describe the artifact, not a branch allocation');
    const session = await materializeSessionForIndex(index, stored);
    assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), stored.queryProjectionDigest);
    assert.deepEqual(session.counts, stored.counts);
    assert.deepEqual(session.analysis.patchedFiles, success ? [{ file: 'src/a.js', count: 1 }] : []);
    const event = session.logicalEvents.find((candidate) => candidate.pi?.callId === 'edit');
    assert.equal(event.kind, success ? 'patch' : 'other_tool_call');
    assert.equal(event.status, stored.sourceDerivedId === 'pending' ? 'incomplete' : stored.sourceDerivedId === 'failure' ? 'failed' : 'success');
    assert.equal(event.rawRefs.length, stored.sourceDerivedId === 'pending' ? 1 : 2);
    sharedCallLocators.push(event.rawRefs[0].sourceLocator);
    const detail = await buildEventDetailForSession(index, session, event.id, 'main');
    assert.equal(detail.timelineSections.filter((section) => section.type === 'patch').length, success ? 1 : 0);
    if (!success) assert.match(JSON.stringify(detail), /no successful valid unified patch/);
    const activity = await piAdapter.query.getFileActivity(index, session, 'src/a.js');
    assert.equal(activity.total, 3, 'read, successful write and edit request all have recorded file activity');
    assert.equal(activity.events.filter((item) => item.association === 'patch_record').length, success ? 1 : 0);
    assert.equal(activity.events.filter((item) => item.association === 'recorded_path').length, success ? 2 : 3);
    for (const ref of event.rawRefs) {
      const raw = await readIndexedRawRecord(index, session, ref.rawId);
      assert.equal(raw.raw, JSON.stringify(rows[ref.sourceLocator.line - 1]));
      if (ref !== event.rawRefs[0]) assert.equal(JSON.parse(raw.raw).id, stored.sourceDerivedId, 'only this branch owns the paired result');
    }
    const usage = branchUsageSummary(session.rawEvents);
    assert.equal(usage.assistant.fields.input.recordedSum, 7, 'shared physical usage is a path observation, not one fourth of a native total');
  }
  assert.ok(sharedCallLocators.every((locator) => JSON.stringify(locator) === JSON.stringify(sharedCallLocators[0])), 'different leaf event IDs point to the same physical call');
  const changes = await piAdapter.query.filterSessions(index, { layer: 'main', q: 'PATCH_ONLY_CONTEXT', limit: 20, offset: 0 });
  assert.equal(changes.matchingEventTotal, 1, 'only the confirmed, coherent patch enters Main patch search');
  const common = await piAdapter.query.filterSessions(index, { layer: 'main', q: 'recorded requested rewrite', limit: 20, offset: 0 });
  assert.equal(common.matchingEventTotal, 4, 'project search intentionally reports shared requests once per containing branch');
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
