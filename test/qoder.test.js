'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildQoderIndex, discoverQoderProjects, qoderAdapter } = require('../src/qoder');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');
const timestamp = '2026-11-01T00:00:00.000Z';
const message = (type, uuid, parentUuid, content, extra = {}) => ({ type, uuid, parentUuid, timestamp, version: '1.1.79-hotfix.19',
  isSidechain: false, message: { role: type, content }, ...extra });
const user = () => message('user', 'u', null, [{ type: 'text', text: 'USER_MARKER' }]);
const call = () => message('assistant', 'c', 'u', [{ type: 'tool_use', id: 'call1', name: 'Bash', input: { command: 'printf INPUT_MARKER' } }]);
const result = () => message('user', 'r', 'c', [{ type: 'tool_result', tool_use_id: 'call1', content: 'OUTPUT_MARKER', is_error: false }]);
async function fixture(t, rows = [user(), call(), result()]) {
  const sourceHome = await fs.mkdtemp(path.join(os.tmpdir(), 'qoder-test-'));
  t.after(() => fs.rm(sourceHome, { recursive: true, force: true }));
  const repoRoot = path.join(sourceHome, 'actual-project'); await fs.mkdir(repoRoot);
  const dir = path.join(sourceHome, 'projects', 'opaque-container'); await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'native-session.jsonl');
  const text = rows.map((row) => typeof row === 'string' ? row : JSON.stringify({ cwd: repoRoot, sessionId: 'native-session', ...row })).join('\n') + '\n';
  await fs.writeFile(file, text); return { sourceHome, repoRoot, file, text };
}
async function indexed(t, f) {
  const index = await buildQoderIndex(f); t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  await validateIndexOwnershipForCommit(index); return index;
}
async function materialized(t, f) {
  const index = await indexed(t, f); assert.equal(index.sessions.length, 1);
  return { index, session: await materializeSessionForIndex(index, index.sessions[0]) };
}

test('Qoder native discovery and materialization agree without retaining transcript bodies in the index', async (t) => {
  const f = await fixture(t); const projects = await discoverQoderProjects(f);
  assert.equal(projects.length, 1); assert.equal(projects[0].repoRoot, f.repoRoot); assert.equal(projects[0].sessionCount, 1);
  const { index, session } = await materialized(t, f);
  assert.equal(index.sourceKind, 'qoder'); assert.equal(Object.hasOwn(index.sessions[0], 'rawEvents'), false);
  assert.equal(await projectQueryProjectionDigestAsync(session, qoderAdapter.query.projectQueryPresentation), index.sessions[0].queryProjectionDigest);
  assert.equal(session.counts.userMessages, 1); assert.equal(session.counts.toolCalls, 1);
  const command = session.logicalEvents.find((e) => e.kind === 'command'); assert.ok(command); assert.equal(command.rawRefs.length, 2);
  const detail = await buildEventDetailForSession(index, session, command.id, 'main');
  assert.match(JSON.stringify(detail.timelineSections), /INPUT_MARKER/); assert.match(JSON.stringify(detail.timelineSections), /OUTPUT_MARKER/);
  const raw = session.rawEvents.find((e) => e.line === 2);
  assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, f.text.split('\n')[1]);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('Qoder physical child sessions retain parent identity, and duplicate native ids in other containers do not collide', async (t) => {
  const f = await fixture(t); const childDir = path.join(path.dirname(f.file), 'native-session', 'subagents');
  await fs.mkdir(childDir, { recursive: true }); await fs.writeFile(path.join(childDir, 'agent-child.jsonl'), f.text);
  const second = path.join(f.sourceHome, 'projects', 'another'); await fs.mkdir(second); await fs.writeFile(path.join(second, 'native-session.jsonl'), f.text);
  const index = await indexed(t, f); assert.equal(index.sessions.length, 3); assert.equal(new Set(index.sessions.map((s) => s.id)).size, 3);
  const child = index.sessions.find((s) => s.parentSessionId); assert.ok(child);
  const parent = index.sessionsById.get(child.parentSessionId); assert.equal(parent.sourceFile, 'opaque-container/native-session.jsonl');
  assert.equal(child.primarySessionMetaKind, 'subagent');
});

test('accepted-prefix Raw and warm Detail survive append but reject rewrite, truncation and replacement', async (t) => {
  const f = await fixture(t); const { index, session } = await materialized(t, f); const raw = session.rawEvents[0];
  const event = session.logicalEvents.find((e) => e.kind === 'user_message');
  await fs.appendFile(f.file, JSON.stringify({ type: 'active-leaf', leafUuid: 'r' }) + '\n');
  assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, f.text.split('\n')[0]);
  await fs.writeFile(f.file, f.text.replace('USER_MARKER', 'EVIL_MARKER'));
  await assert.rejects(readIndexedRawRecord(index, session, raw.rawId), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(buildEventDetailForSession(index, session, event.id, 'main'), { code: 'INDEXED_SOURCE_STALE' });
  await fs.writeFile(f.file, f.text.slice(0, 12));
  await assert.rejects(readIndexedRawRecord(index, session, raw.rawId), { code: 'INDEXED_SOURCE_STALE' });
  await fs.rename(f.file, f.file + '.old'); await fs.writeFile(f.file, f.text);
  await assert.rejects(readIndexedRawRecord(index, session, raw.rawId), { code: 'INDEXED_SOURCE_STALE' });
});

test('torn tails, malformed committed lines, root diagnostics and cancellation are explicit', async (t) => {
  const f = await fixture(t, [user(), '{"broken":']); await fs.appendFile(f.file, '{"inflight":true}');
  const index = await indexed(t, f); assert.ok(index.sourceDiagnostics.counts.QODER_TORN_TAIL);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(session.rawEventCount, 2); const malformed = session.rawEvents.find((r) => r.parseError);
  assert.equal((await readIndexedRawRecord(index, session, malformed.rawId)).raw, '{"broken":');
  const absent = await indexed(t, { ...f, sourceHome: path.join(f.sourceHome, 'absent') });
  assert.equal(absent.sessions.length, 0); assert.ok(absent.sourceDiagnostics.counts.SOURCE_ROOT_NOT_FOUND);
  await fs.writeFile(f.file, JSON.stringify({ type: 'transport-event', sessionId: 'native-session', cwd: f.repoRoot }) + '\n');
  const invalid = await indexed(t, f); assert.equal(invalid.sessions.length, 0); assert.ok(invalid.sourceDiagnostics.counts.QODER_TRANSCRIPT_INVALID);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildQoderIndex({ ...f, signal: controller.signal }), { name: 'AbortError' });
});

test('symlink artifacts and arbitrary subtrees are not native session inputs', async (t) => {
  const f = await fixture(t); const arbitrary = path.join(path.dirname(f.file), 'other', 'nested');
  await fs.mkdir(arbitrary, { recursive: true }); await fs.writeFile(path.join(arbitrary, 'x.jsonl'), f.text);
  try { await fs.symlink(f.file, path.join(path.dirname(f.file), 'linked.jsonl')); } catch (e) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) throw e; }
  assert.equal((await indexed(t, f)).sessions.length, 1);
});

test('saved Qoder image previews are snapshot-bound and never expose payloads through search or Detail', async (t) => {
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZwoAAAAASUVORK5CYII=';
  const f = await fixture(t, [message('user', 'u', null, [{ type: 'text', text: 'Image prompt' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data, path: '/never-open/source.png' } }])]);
  const { index, session } = await materialized(t, f); const image = session.logicalEvents.find((e) => e.qoder?.imageMessage);
  assert.ok(image); assert.doesNotMatch(session.rawEvents[0].searchText, /iVBORw0KGgo/);
  const detail = await buildEventDetailForSession(index, session, image.id, image.layer);
  assert.doesNotMatch(JSON.stringify(detail), /iVBORw0KGgo/);
  const section = detail.timelineSections.find((s) => s.type === 'image_preview'); assert.equal(section.images.length, 1);
  const preview = await qoderAdapter.readImagePreview(index, session, image.id, section.images[0].previewId);
  assert.equal(preview.mimeType, 'image/png'); assert.deepEqual(preview.bytes, Buffer.from(data, 'base64'));
  assert.equal((await qoderAdapter.readImagePreview(index, session, image.id, 'unknown')).statusCode, 404);
  await fs.writeFile(f.file, f.text.replace('Image prompt', 'Other prompt'));
  assert.equal((await qoderAdapter.readImagePreview(index, session, image.id, section.images[0].previewId)).statusCode, 409);
});

test('history CLI search and read use the same Qoder tool request/result/Raw evidence', async (t) => {
  const f = await fixture(t); const service = await createHistoryService({ repo: f.repoRoot, source: 'qoder', qoderHome: f.sourceHome });
  t.after(() => service.close()); const found = await service.execute('search', { query: 'OUTPUT_MARKER' });
  assert.equal(found.scan.matchedSessions, 1); assert.equal(found.scan.matchedEvents, 1);
  const detail = await service.execute('read', { refs: [found.items[0].ref], parts: ['request', 'result', 'raw'] });
  assert.match(JSON.stringify(detail), /INPUT_MARKER/); assert.match(JSON.stringify(detail), /OUTPUT_MARKER/);
});

test('Qoder child navigation requires unique parent call plus native child identity evidence', async (t) => {
  const agentCall = message('assistant', 'c', 'u', [{ type: 'tool_use', id: 'spawn1', name: 'Agent', input: { prompt: 'CHILD_PROMPT', subagent_type: 'general-purpose' } }]);
  const f = await fixture(t, [user(), agentCall]);
  const childDir = path.join(path.dirname(f.file), 'native-session', 'subagents'); await fs.mkdir(childDir, { recursive: true });
  const childText = JSON.stringify({ ...user(), sessionId: 'native-session', cwd: f.repoRoot, agentId: 'child', parent_tool_use_id: 'spawn1', isSidechain: true }) + '\n';
  const childFile = path.join(childDir, 'agent-child.jsonl'); await fs.writeFile(childFile, childText);
  let index = await indexed(t, f); let parent = index.sessions.find((s) => !s.parentSessionId);
  let session = await materializeSessionForIndex(index, parent); let event = session.logicalEvents.find((e) => e.toolName === 'Agent');
  let detail = await buildEventDetailForSession(index, session, event.id, 'main', { indexRevision: 7 });
  let link = detail.inspectorSections.find((s) => s.type === 'collaboration').targetLinks[0];
  assert.equal(link.status, 'resolved'); assert.equal(link.target.indexRevision, 7);
  assert.equal(index.sessionsById.get(link.target.sessionId).parentSessionId, parent.id);
  await fs.writeFile(childFile, childText.replace('"agentId":"child"', '"agentId":"conflict"'));
  index = await indexed(t, f); parent = index.sessions.find((s) => !s.parentSessionId); session = await materializeSessionForIndex(index, parent);
  event = session.logicalEvents.find((e) => e.toolName === 'Agent'); detail = await buildEventDetailForSession(index, session, event.id, 'main');
  assert.equal(detail.inspectorSections.some((s) => s.type === 'collaboration'), false);
});

test('native task variants, file diff, usage and runtime records have structured Detail', async (t) => {
  const rows = [user(),
    message('assistant', 'c', 'u', [{ type: 'tool_use', id: 'edit1', name: 'Edit', input: { file_path: 'file.txt', old_string: 'old', new_string: 'new' } }]),
    message('user', 'r', 'c', [{ type: 'tool_result', tool_use_id: 'edit1', content: 'Edited file', is_error: false }],
      { toolUseResult: { success: true, file_path: 'file.txt', diff: '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new', additions: 1, deletions: 1 } }),
    { type: 'runtime-config', model: 'synthetic-model', reasoningEffort: null, contextWindow: 120000, timestamp },
    { type: 'attachment', uuid: 'tasks', parentUuid: 'r', attachment: { type: 'task_reminder', itemCount: 1, content: [{ subject: 'TASK_TITLE', status: 'completed' }] } },
    message('assistant', 'final', 'tasks', [{ type: 'text', text: 'Done' }], { message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }], usage: { input_tokens: 0, output_tokens: 0, credits: 2 } } })];
  const f = await fixture(t, rows); const { index, session } = await materialized(t, f);
  const edit = session.logicalEvents.find((e) => e.toolName === 'Edit');
  const editDetail = await buildEventDetailForSession(index, session, edit.id, 'main');
  assert.ok(editDetail.timelineSections.some((s) => s.type === 'diff' && s.text.includes('+new')));
  const reminder = session.logicalEvents.find((e) => e.rawRefs[0].line === 5);
  const taskDetail = await buildEventDetailForSession(index, session, reminder.id, reminder.layer);
  assert.ok(taskDetail.timelineSections.some((s) => s.type === 'plan_update' && s.steps[0].step === 'TASK_TITLE'));
  const usage = session.logicalEvents.find((e) => e.subtype === 'qoder_usage');
  const usageDetail = await buildEventDetailForSession(index, session, usage.id, 'protocol');
  assert.match(JSON.stringify(usageDetail.timelineSections), /credits/);
  assert.deepEqual(usage.tokenUsage, [], 'native credit/zero token fields do not fabricate shared accounting');
});

test('inline MCP result images preview their own bytes while remote URLs remain unfetched', async (t) => {
  const f = await fixture(t, [user(), call(), message('user', 'r', 'c', [{ type: 'tool_result', tool_use_id: 'call1', is_error: false,
    content: [{ type: 'image', source: { type: 'url', url: 'https://example.invalid/saved.png' } }] }],
  { toolUseResult: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }] })]);
  const { index, session } = await materialized(t, f); const event = session.logicalEvents.find((e) => e.toolName);
  const detail = await buildEventDetailForSession(index, session, event.id, 'main');
  assert.doesNotMatch(JSON.stringify(detail), /aW1hZ2U=/);
  const section = detail.timelineSections.find((s) => s.type === 'image_preview'); assert.equal(section.images.length, 1);
  assert.match(section.notice, /unsupported/);
  const preview = await qoderAdapter.readImagePreview(index, session, event.id, section.images[0].previewId);
  assert.equal(preview.bytes.toString(), 'image');
});

test('malformed content blocks retain readable Protocol Detail instead of crashing image inspection', async (t) => {
  const f = await fixture(t, [message('user', 'u', null, [{ type: 'text', text: 'Readable' }, null, 42, { type: 'future' }])]);
  const { index, session } = await materialized(t, f);
  for (const event of session.logicalEvents) assert.ok(await buildEventDetailForSession(index, session, event.id, event.layer));
});

test('conflicting native agent identities cannot pair a result even with matching call and source UUID', async (t) => {
  const f = await fixture(t, [user(), { ...call(), agentId: 'agent-a' }, { ...result(), agentId: 'agent-b', sourceToolAssistantUUID: 'c' }]);
  const { session } = await materialized(t, f); const command = session.logicalEvents.find((e) => e.toolName === 'Bash');
  assert.equal(command.status, 'incomplete'); assert.equal(command.rawRefs.length, 1);
  assert.ok(session.logicalEvents.some((e) => e.subtype.startsWith('qoder_unpaired_tool_result')));
});

test('duplicate call IDs across different tools cannot create a resolved child navigation link', async (t) => {
  const f = await fixture(t, [user(), message('assistant', 'c', 'u', [
    { type: 'tool_use', id: 'shared', name: 'Agent', input: { prompt: 'Child prompt' } },
    { type: 'tool_use', id: 'shared', name: 'Bash', input: { command: 'true' } },
  ])]);
  const dir = path.join(path.dirname(f.file), 'native-session', 'subagents'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'agent-child.jsonl'), JSON.stringify({ ...user(), cwd: f.repoRoot,
    sessionId: 'native-session', agentId: 'child', parent_tool_use_id: 'shared' }) + '\n');
  const index = await indexed(t, f); const parent = index.sessions.find((s) => !s.parentSessionId);
  const session = await materializeSessionForIndex(index, parent); const event = session.logicalEvents.find((e) => e.toolName === 'Agent');
  const detail = await buildEventDetailForSession(index, session, event.id, 'main');
  const link = detail.inspectorSections.find((s) => s.type === 'collaboration').targetLinks[0];
  assert.equal(link.status, 'ambiguous'); assert.equal(Object.hasOwn(link, 'target'), false);
});

test('malformed saved-image MIME types remain unavailable without breaking Detail', async (t) => {
  const f = await fixture(t, [message('user', 'u', null, [{ type: 'image', source: { type: 'base64', media_type: ['image/png'], data: 'aW1hZ2U=' } }])]);
  const { index, session } = await materialized(t, f); const event = session.logicalEvents.find((e) => e.qoder?.imageMessage);
  const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
  const images = detail.timelineSections.find((s) => s.type === 'image_preview');
  assert.equal(images.images.length, 0); assert.match(images.notice, /unsupported/);
  const preview = await qoderAdapter.readImagePreview(index, session, event.id, 'image-1-0'); assert.equal(preview.statusCode, 422);
});

test('Protocol-only native call competitors prevent resolved child navigation', async (t) => {
  const f = await fixture(t, [user(), message('assistant', 'c', 'u', [
    { type: 'tool_use', id: 'shared', name: 'Agent', input: { prompt: 'Child prompt' } },
  ]), message('assistant', 'meta', 'c', [{ type: 'tool_use', id: 'shared', name: 'Bash', input: { command: 'true' } }], { isMeta: true })]);
  const dir = path.join(path.dirname(f.file), 'native-session', 'subagents'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'agent-child.jsonl'), JSON.stringify({ ...user(), cwd: f.repoRoot,
    sessionId: 'native-session', agentId: 'child', parent_tool_use_id: 'shared' }) + '\n');
  const index = await indexed(t, f); const parent = index.sessions.find((s) => !s.parentSessionId);
  const session = await materializeSessionForIndex(index, parent); const event = session.logicalEvents.find((e) => e.toolName === 'Agent');
  assert.equal(event.qoder.uniqueCallIdentity, false);
  const detail = await buildEventDetailForSession(index, session, event.id, 'main');
  const link = detail.inspectorSections.find((s) => s.type === 'collaboration').targetLinks[0];
  assert.equal(link.status, 'ambiguous'); assert.equal(Object.hasOwn(link, 'target'), false);
});
