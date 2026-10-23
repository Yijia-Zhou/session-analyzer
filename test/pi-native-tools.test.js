'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { nativeEditPatch, nativeTool } = require('../src/pi-native-tools');
const { buildPiIndex, piAdapter } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const patch = '--- src/a.js\n+++ src/a.js\n@@ -1,3 +1,3 @@\n-old\n+new\n context\n-last\n+final\n';
const edits = [{ oldText: 'old', newText: 'new' }, { oldText: 'last', newText: 'final' }];
test('native edit patch validates paths, complete hunk accounting and multi-edit line numbers', () => {
  const section = nativeEditPatch(patch, 'src/a.js');
  assert.equal(section.files[0].additions, 2);
  assert.equal(section.files[0].deletions, 2);
  assert.equal(section.files[0].hunks[0].lines.at(-1).newLine, 3);
  for (const invalid of [patch.replace('@@ -1,3', '@@ -1,4'), patch + 'garbage\n', patch.replace('+++ src/a.js', '+++ other.js'), patch.replace('+final\n', '')]) assert.equal(nativeEditPatch(invalid, 'src/a.js'), null);
});
test('native admission requires valid request shape and confirms edits only on successful recorded patches', () => {
  const args = { path: 'src/a.js', edits };
  assert.ok(nativeTool('edit', args, { details: { patch } }, 'success').patch);
  for (const status of ['failed', 'incomplete']) assert.equal(nativeTool('edit', args, { details: { patch } }, status).patch, null);
  assert.equal(nativeTool('edit', { path: 'src/a.js', edits: 'unmodeled' }, {}, 'success'), null);
  assert.equal(nativeTool('bash', { command: {} }, {}, 'success'), null);
  assert.equal(nativeTool('write', { path: 'src/a.js' }, {}, 'success'), null);
  assert.equal(nativeTool('powershell', { command: 'Get-Content a' }, {}, 'success').language, 'powershell');
  for (const name of ['grep', 'find']) assert.equal(nativeTool(name, { path: 'src', pattern: 'needle' }, {}, 'success').path, 'src');
});
test('native edits retain indexed/materialized parity, canonical detail, counts and honest fallbacks', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-native-tools-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'sessions', 'synthetic'), { recursive: true });
  const rows = [{ type: 'session', id: 'tools', version: 3, cwd: home, timestamp: '2026-10-23T00:00:00Z' }];
  let parentId = null;
  const add = (id, message) => { rows.push({ type: 'message', id, parentId, message }); parentId = id; };
  const cases = [
    ['edit', { path: 'src/a.js', edits }, false, { patch, diff: '-1 old\n+1 new', firstChangedLine: 1 }],
    ['edit', { path: 'src/a.js', edits }, true, { patch }],
    ['edit', { path: 'src/a.js', edits }, false, { patch: patch.slice(0, -8) }],
    ['edit', { path: 'src/a.js', edits: 'unknown' }, false, { patch }],
    ['write', { path: 'out.txt', content: 'hello' }, false, {}],
    ['read', { path: 'input.txt', offset: 3, limit: 2 }, false, { truncation: { truncated: true }, fullOutputPath: '/fake/output' }],
    ['powershell', { command: 'Get-ChildItem' }, false, {}],
    ['grep', { path: 'src', pattern: 'needle' }, false, { matchLimitReached: 100 }],
  ];
  for (const [i, [name, args, isError, details]] of cases.entries()) {
    add(`call${i}`, { role: 'assistant', content: [{ type: 'toolCall', id: `c${i}`, name, arguments: args }] });
    add(`result${i}`, { role: 'toolResult', toolName: name, toolCallId: `c${i}`, isError, content: [{ type: 'text', text: 'recorded output' }], details });
  }
  await fs.writeFile(path.join(home, 'sessions', 'synthetic', 'tools.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  const index = await buildPiIndex({ repoRoot: home, sourceHome: home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  const stored = index.sessions[0];
  const session = await materializeSessionForIndex(index, stored);
  assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), stored.queryProjectionDigest);
  assert.equal(session.counts.patches, 1);
  assert.equal(session.counts.toolCalls, cases.length);
  assert.deepEqual(session.analysis.patchedFiles, [{ file: 'src/a.js', count: 1 }]);
  const events = session.logicalEvents.filter((e) => e.layer === 'main');
  assert.equal(events[0].kind, 'patch');
  assert.equal(events[0].rawRefs.length, 2);
  const patchSearch = await piAdapter.query.filterSessions(index, { layer: 'main', q: 'context', limit: 20, offset: 0 });
  assert.equal(patchSearch.matchingEventTotal, 1, 'result-owned diff context is searchable only for the admitted successful patch');
  assert.equal(events[1].status, 'failed');
  for (const e of events.slice(1, 4)) assert.equal(e.kind, 'other_tool_call');
  assert.deepEqual(events[3].touchedFiles, []);
  const detail = await buildEventDetailForSession(index, session, events[0].id, 'main');
  assert.equal(detail.timelineSections.find((s) => s.type === 'patch').files[0].additions, 2);
  const write = await buildEventDetailForSession(index, session, events[4].id, 'main');
  assert.match(JSON.stringify(write), /created or overwritten/);
  const read = await buildEventDetailForSession(index, session, events[5].id, 'main');
  assert.match(JSON.stringify(read), /truncated/);
  assert.match(JSON.stringify(read), /fake\/output/);
  assert.equal(events[6].kind, 'command');
  assert.deepEqual(events[7].touchedFiles, ['src']);
});

test('large valid patches keep typed detail structures bounded and preserve complete change counts', async (t) => {
  const { nativePatchSections } = require('../src/pi-native-tools');
  const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');
  const longPatch = '--- src/a.js\n+++ src/a.js\n@@ -1,220 +1,220 @@\n'
    + Array.from({ length: 220 }, (_, i) => `-old${i}\n+new${i}\n`).join('');
  const manyHunks = '--- src/a.js\n+++ src/a.js\n'
    + Array.from({ length: 220 }, (_, i) => `@@ -${i * 3 + 1} +${i * 3 + 1} @@\n-old${i}\n+new${i}\n`).join('');
  for (const [label, source] of [['long', longPatch], ['many', manyHunks]]) {
    const parsed = nativeEditPatch(source, 'src/a.js');
    assert.ok(parsed);
    const sections = nativePatchSections(parsed);
    assert.equal(sections[0].files[0].additions, 220);
    assert.equal(sections[0].files[0].deletions, 220);
    assert.match(sections[1].text, /omitted/);
    assert.ok(sections[0].files[0].hunks.length <= 24);
    assert.ok(sections[0].files[0].hunks.flatMap((h) => h.lines).length <= 80);
    const home = await fs.mkdtemp(path.join(os.tmpdir(), `pi-large-${label}-`));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    await fs.mkdir(path.join(home, 'sessions', 'synthetic'), { recursive: true });
    const rows = [
      { type: 'session', id: label, version: 3, cwd: home },
      { type: 'message', id: 'call', parentId: null, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'edit', name: 'edit', arguments: { path: 'src/a.js', edits } }] } },
      { type: 'message', id: 'result', parentId: 'call', message: { role: 'toolResult', toolName: 'edit', toolCallId: 'edit', isError: false, content: [{ type: 'text', text: 'Edited' }], details: { patch: source } } },
    ];
    await fs.writeFile(path.join(home, 'sessions', 'synthetic', 'tools.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
    const index = await buildPiIndex({ repoRoot: home, sourceHome: home });
    t.after(() => disposeProjectQueryStore(index.projectQueryStore));
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    const event = session.logicalEvents.find((e) => e.kind === 'patch');
    const detail = await buildEventDetailForSession(index, session, event.id, 'main');
    validateStructuredLogicalDetailDto(detail);
    const file = detail.timelineSections.find((s) => s.type === 'patch').files[0];
    assert.equal(file.additions, 220);
    assert.equal(file.deletions, 220);
    assert.ok(file.hunks.every((h) => typeof h === 'object' && h.lines.every((line) => typeof line === 'object')));
    assert.match(JSON.stringify(detail.timelineSections), /Patch display omitted/);
    const raw = await readIndexedRawRecord(index, session, event.rawRefs[1].rawId);
    assert.equal(JSON.parse(raw.raw).message.details.patch, source);
  }
});

test('native hunk arithmetic rejects unsafe line range boundaries', () => {
  const unsafe = '--- src/a.js\n+++ src/a.js\n@@ -9007199254740991 +1 @@\n-old\n+new\n';
  assert.equal(nativeEditPatch(unsafe, 'src/a.js'), null);
});
