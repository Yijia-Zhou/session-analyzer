'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, parsePiSessionArtifact } = require('../src/pi');
const { readPiNavigation, createPiEntryReference, resolvePiEntryReference } = require('../src/pi-navigation');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');

const user = (id, parentId, content) => ({ type: 'message', id, parentId, message: { role: 'user', content } });
const assistant = (id, parentId, content) => ({ type: 'message', id, parentId, message: { role: 'assistant', content: [{ type: 'text', text: content }] } });
const serialize = (rows) => rows.map(JSON.stringify).join('\n') + '\n';

async function fixture(t, entries = []) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-nav-'));
  const file = path.join(home, 'sessions', 'history.jsonl');
  await fs.mkdir(path.dirname(file));
  const header = { type: 'session', version: 3, id: 'native', cwd: home };
  await fs.writeFile(file, serialize([header, ...entries]));
  const indexes = [];
  t.after(async () => { for (const index of indexes) await disposeProjectQueryStore(index.projectQueryStore); await fs.rm(home, { recursive: true, force: true }); });
  const rebuild = async () => { const index = await buildPiIndex({ sourceHome: home, repoRoot: home }); indexes.push(index); return index; };
  const index = await rebuild();
  return { home, file, header, index, rebuild };
}

async function eventReference(f, index, entryId, leafId, layer = 'main') {
  const session = index.sessions.find((candidate) => candidate.sourceDerivedId === leafId) || index.sessions[0];
  const projected = (await parsePiSessionArtifact(f.file, session.sourceFile)).find((candidate) => candidate.id === session.id);
  const raw = projected.rawEvents.find((candidate) => candidate.entryId === entryId);
  const event = layer === 'raw' ? raw : projected.logicalEvents.find((candidate) => candidate.layer === layer && candidate.source.line === raw.line);
  return createPiEntryReference(index, session, layer === 'raw' ? event.rawId : event.id, layer);
}

test('a native entry bookmark survives append and reindex, while branch choice remains explicit', async (t) => {
  const f = await fixture(t, [user('question', null, 'Why did we reject the first approach?'), assistant('decision', 'question', 'Use approach B')]);
  const ref = (await eventReference(f, f.index, 'decision')).reference;
  const before = await resolvePiEntryReference(f.index, ref);
  assert.equal(before.status, 'resolved');
  assert.equal(before.target.layer, 'main');
  await fs.appendFile(f.file, serialize([assistant('continued', 'decision', 'Continue B')]));
  assert.deepEqual((await resolvePiEntryReference(f.index, ref)).target, before.target, 'accepted snapshot does not mix in appended history');
  const next = await f.rebuild();
  const after = await resolvePiEntryReference(next, ref);
  assert.equal(after.status, 'resolved');
  assert.notEqual(after.target.sessionId, before.target.sessionId);
  assert.match(after.target.eventId, /:event:3:block:0$/);
  await fs.appendFile(f.file, serialize([assistant('alternative', 'decision', 'Explore C instead')]));
  const forked = await f.rebuild();
  const choice = await resolvePiEntryReference(forked, ref);
  assert.equal(choice.status, 'choose_branch');
  assert.equal(choice.branches.length, 2);
  assert.equal(choice.target, undefined);
  for (const branch of choice.branches) {
    const selected = await resolvePiEntryReference(forked, ref, { branchId: branch.sessionId });
    assert.equal(selected.status, 'resolved');
    assert.equal(selected.target.sessionId, branch.sessionId);
    assert.equal(selected.target.layer, 'main');
  }
  assert.equal((await resolvePiEntryReference(forked, ref, { branchId: 'unknown' })).status, 'unavailable');
});

test('normal branch summaries and labels navigate to abandoned siblings without broadening context-edit ownership', async (t) => {
  const rows = [user('root', null, 'Fix the URL normalizer'), assistant('failed', 'root', 'Approach A failed its check'),
    { type: 'branch_summary', id: 'summary', parentId: 'root', fromId: 'failed', summary: 'A failed; retain its lesson.' },
    assistant('success', 'summary', 'Approach B passed'),
    { type: 'label', id: 'mark', parentId: 'success', targetId: 'failed', label: 'Rejected approach' },
    { type: 'context_edit', id: 'invalid-edit', parentId: 'mark', targetId: 'failed', replacement: null }];
  const f = await fixture(t, rows);
  const session = f.index.sessions.find((candidate) => candidate.sourceDerivedId === 'invalid-edit');
  const summary = await eventReference(f, f.index, 'summary', 'invalid-edit', 'protocol');
  assert.equal(summary.relatedLabel, 'summarized_branch');
  const target = await resolvePiEntryReference(f.index, summary.relatedReference);
  assert.equal(target.status, 'resolved');
  assert.match(target.target.sessionId, /failed$/);
  assert.equal(target.target.layer, 'raw');
  const label = await eventReference(f, f.index, 'mark', 'invalid-edit', 'protocol');
  assert.equal(label.relatedReference, summary.relatedReference);
  const edit = await eventReference(f, f.index, 'invalid-edit', 'invalid-edit', 'protocol');
  assert.equal(edit.relatedReference, null);
  const overview = await readPiNavigation(f.index, session);
  assert.equal(overview.branchCount, 2);
  assert.equal(overview.labels[0].reference, summary.relatedReference);
  const sibling = overview.branches.find((branch) => branch.leafId === 'failed');
  assert.equal(sibling.divergence.entryId, 'root');
  assert.equal(sibling.tip, 'Approach A failed its check');
  assert.equal((await resolvePiEntryReference(f.index, sibling.divergence.reference)).status, 'choose_branch');
  assert.equal(await createPiEntryReference(f.index, session, target.target.eventId, 'raw'), null, 'caller cannot select a sibling through an owned event endpoint');
});

test('shared-entry branch choice pages every containing branch in bounded stable snapshot order', async (t) => {
  const f = await fixture(t, [user('root', null, 'Shared entry'),
    ...Array.from({ length: 205 }, (_, i) => assistant(`leaf-${i}`, 'root', `Branch ${i}`)),
    user('unrelated', null, 'Outside this entry')]);
  const ref = (await eventReference(f, f.index, 'root', 'leaf-0', 'raw')).reference;
  const seen = [];
  let offset = 0;
  for (const count of [100, 100, 5]) {
    const page = await resolvePiEntryReference(f.index, ref, { branchOffset: offset });
    assert.equal(page.status, 'choose_branch');
    assert.equal(page.branchCount, 205);
    assert.equal(page.branches.length, count);
    assert.equal(page.target, undefined);
    assert.equal(page.truncated, true);
    seen.push(...page.branches.map((branch) => branch.sessionId));
    offset += count;
    assert.equal(page.nextOffset, offset < 205 ? offset : null);
    if (offset === 100) await fs.appendFile(f.file, serialize([assistant('new-leaf', 'root', 'Appended later')]));
  }
  const expected = f.index.sessions.filter((session) => session.sourceDerivedId !== 'unrelated').map((session) => session.id);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 205);
  const last = await resolvePiEntryReference(f.index, ref, { branchId: seen.at(-1) });
  assert.equal(last.status, 'resolved');
  assert.equal(last.target.sessionId, seen.at(-1));
  assert.equal(last.branches[0].sessionId, seen.at(-1), 'explicit branch retains selected-first response semantics');
  assert.equal(last.branches.length, 100);
  assert.equal(last.nextOffset, null);
  assert.equal((await resolvePiEntryReference(f.index, ref, { branchId: 'pi:native:unrelated' })).status, 'unavailable');
  const exhausted = await resolvePiEntryReference(f.index, ref, { branchOffset: 999 });
  assert.deepEqual(exhausted.branches, []);
  assert.equal(exhausted.nextOffset, null);
  for (const branchOffset of [-1, 0.5, NaN, Infinity, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(resolvePiEntryReference(f.index, ref, { branchOffset }), { statusCode: 400 });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolvePiEntryReference(f.index, ref, { branchOffset: 100, signal: controller.signal }), { name: 'AbortError' });
});

test('native overview resolves whole-artifact names and labels, including clears, separately from historical titles', async (t) => {
  const f = await fixture(t, [user('root', null, 'Original question'), assistant('left', 'root', 'Left answer'),
    { type: 'session_info', id: 'name', parentId: 'left', name: 'Useful project name' },
    assistant('right', 'root', 'Right answer'),
    { type: 'label', id: 'mark', parentId: 'right', targetId: 'left', label: 'Investigate later' },
    { type: 'label', id: 'mark2', parentId: 'mark', targetId: 'root', label: 'Question' }]);
  const left = f.index.sessions.find((candidate) => candidate.sourceDerivedId === 'name');
  const overview = await readPiNavigation(f.index, left);
  assert.equal(overview.name, 'Useful project name');
  assert.equal(overview.totalLabels, 2);
  assert.equal(overview.branches.find((branch) => branch.leafId === 'mark2').tip, 'Right answer');
  assert.equal(overview.summaryTarget.layer, 'protocol');
  await fs.appendFile(f.file, serialize([
    { type: 'session_info', id: 'clear-name', parentId: 'mark2', name: '' },
    { type: 'label', id: 'clear1', parentId: 'clear-name', targetId: 'left', label: '' },
    { type: 'label', id: 'clear2', parentId: 'clear1', targetId: 'root' }]));
  const next = await f.rebuild();
  const cleared = await readPiNavigation(next, next.sessions.find((session) => session.sourceDerivedId === 'name'));
  assert.equal(cleared.name, '');
  assert.deepEqual(cleared.labels, []);
  assert.match(next.sessions.find((session) => session.sourceDerivedId === 'name').title, /Useful project name/, 'historical branch title does not mutate into global metadata');
});

test('bookmark identity refuses changed entries, moved artifacts, other roots, ambiguous IDs and malformed refs', async (t) => {
  const entries = [user('question', null, 'Exact original evidence')];
  const f = await fixture(t, entries);
  const ref = (await eventReference(f, f.index, 'question')).reference;
  const other = await fixture(t, entries);
  assert.equal((await resolvePiEntryReference(other.index, ref)).status, 'unavailable');
  for (const bad of ['', null, 'pi-entry-v1.%%%%', 'pi-entry-v1.' + 'a'.repeat(9000)]) {
    assert.equal((await resolvePiEntryReference(f.index, bad)).status, 'unavailable');
  }
  const value = JSON.parse(Buffer.from(ref.slice('pi-entry-v1.'.length), 'base64url'));
  value.artifact = '../../outside.jsonl';
  const forged = 'pi-entry-v1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.equal((await resolvePiEntryReference(f.index, forged)).status, 'unavailable');
  value.scope = { toString: {} };
  const structured = 'pi-entry-v1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.equal((await resolvePiEntryReference(f.index, structured)).status, 'unavailable');
  await fs.writeFile(f.file, serialize([f.header, user('question', null, 'Changed evidence')]));
  await assert.rejects(resolvePiEntryReference(f.index, ref), { code: 'INDEXED_SOURCE_STALE', statusCode: 409 });
  const changed = await f.rebuild();
  assert.equal((await resolvePiEntryReference(changed, ref)).status, 'unavailable');
  await fs.writeFile(f.file, serialize([f.header, ...entries]));
  const moved = path.join(path.dirname(f.file), 'moved.jsonl');
  await fs.rename(f.file, moved);
  assert.equal((await resolvePiEntryReference(await f.rebuild(), ref)).status, 'unavailable');
  await fs.copyFile(moved, f.file);
  const ambiguous = await f.rebuild();
  assert.equal(ambiguous.sessions.length, 0);
  assert.equal((await resolvePiEntryReference(ambiguous, ref)).status, 'unavailable');
});

test('stable tool-call references retain distinct sibling outcomes and fall back explicitly if an old projection disappears', async (t) => {
  const call = { type: 'message', id: 'call', parentId: null, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'bash', arguments: { command: 'npm test' } }] } };
  const result = (id, isError) => ({ type: 'message', id, parentId: 'call', message: { role: 'toolResult', toolCallId: 'c', toolName: 'bash', isError, content: [{ type: 'text', text: isError ? 'failed' : 'passed' }] } });
  const f = await fixture(t, [call, result('bad', true), result('good', false)]);
  const ref = (await eventReference(f, f.index, 'call', 'bad')).reference;
  const resolved = await resolvePiEntryReference(f.index, ref);
  assert.equal(resolved.status, 'choose_branch');
  for (const branch of resolved.branches) {
    const selection = await resolvePiEntryReference(f.index, ref, { branchId: branch.sessionId });
    assert.equal(selection.projectionUnavailable, false);
    assert.match(selection.target.eventId, /:block:0$/);
  }
  const value = JSON.parse(Buffer.from(ref.slice('pi-entry-v1.'.length), 'base64url'));
  value.projection = 'retired_projection';
  const retired = 'pi-entry-v1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
  const fallback = await resolvePiEntryReference(f.index, retired, { branchId: f.index.sessions[0].id });
  assert.equal(fallback.projectionUnavailable, true);
  assert.equal(fallback.target.layer, 'raw');
});

test('invalid trees never acquire navigation semantics, and navigation responds to cancellation', async (t) => {
  const f = await fixture(t, [user('orphan', 'missing', 'No invented ownership')]);
  assert.equal(await readPiNavigation(f.index, f.index.sessions[0]), null);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readPiNavigation(f.index, f.index.sessions[0], { signal: controller.signal }), { name: 'AbortError' });
});

test('pi navigation HTTP requires source/project/revision ownership and serves stale evidence explicitly', async (t) => {
  const f = await fixture(t, [user('question', null, 'Open this exact entry')]);
  const service = await createHistoryService({ source: 'pi', piHome: f.home, repo: f.home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(base + '/api/state')).json();
  const params = new URLSearchParams({ source: 'pi', repoRoot: f.home, indexRevision: String(state.indexRevision), sessionId: f.index.sessions[0].id });
  const overviewResponse = await fetch(base + '/api/pi/navigation?' + params);
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.branchCount, 1);
  const ref = (await eventReference(f, f.index, 'question')).reference;
  params.set('reference', ref);
  const selection = await (await fetch(base + '/api/pi/entry?' + params)).json();
  assert.equal(selection.status, 'resolved');
  for (const invalid of ['', '-1', '1.5', '1e2', 'Infinity', ' 1', '01', '9007199254740992']) {
    params.set('branchOffset', invalid);
    assert.equal((await fetch(base + '/api/pi/entry?' + params)).status, 400, `reject branchOffset=${JSON.stringify(invalid)}`);
  }
  params.set('branchOffset', '100');
  assert.equal((await fetch(base + '/api/pi/entry?' + params)).status, 200);
  params.delete('branchOffset');
  params.set('repoRoot', f.home + '-wrong');
  assert.equal((await fetch(base + '/api/pi/entry?' + params)).status, 404);
  params.set('repoRoot', f.home);
  params.set('indexRevision', String(state.indexRevision + 1));
  assert.equal((await fetch(base + '/api/pi/entry?' + params)).status, 409);
  params.delete('indexRevision');
  assert.equal((await fetch(base + '/api/pi/entry?' + params)).status, 400);
  params.set('indexRevision', String(state.indexRevision));
  await fs.truncate(f.file, 0);
  const stale = await fetch(base + '/api/pi/entry?' + params);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'INDEXED_SOURCE_STALE');
});
