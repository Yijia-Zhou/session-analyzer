'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { piAdapter, buildPiIndex, discoverPiProjects } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord,
  validateIndexOwnershipForCommit, supportedSourceKinds } = require('../src/source-adapters');
const { projectQueryProjectionDigestAsync, disposeProjectQueryStore } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');

const timestamp = '2026-10-22T12:00:00.000Z';
function entry(id, parentId, type, fields = {}) { return { type, id, parentId, timestamp, ...fields }; }
function message(id, parentId, role, content, fields = {}) {
  return entry(id, parentId, 'message', { message: { role, content, timestamp: Date.parse(timestamp), ...fields } });
}
function branchedRows() {
  return [
    message('u', null, 'user', 'SHARED_ORIGIN inspect the synthetic project'),
    message('call', 'u', 'assistant', [
      { type: 'thinking', thinking: 'Consider the saved evidence', thinkingSignature: 'SECRET_SIGNATURE_MARKER' },
      { type: 'toolCall', id: 'call-id', name: 'bash', arguments: { command: 'printf TOOL_INPUT_MARKER' } },
    ], { provider: 'synthetic', model: 'test-model', stopReason: 'toolUse' }),
    message('result', 'call', 'toolResult', [{ type: 'text', text: 'TOOL_OUTPUT_MARKER' }],
      { toolCallId: 'call-id', toolName: 'bash', isError: false }),
    message('a', 'result', 'user', 'BRANCH_ALPHA_ONLY'),
    message('a2', 'a', 'assistant', [{ type: 'text', text: 'Alpha answer' }], { stopReason: 'stop' }),
    message('b', 'result', 'user', 'BRANCH_BETA_ONLY'),
    message('b2', 'b', 'assistant', [{ type: 'text', text: 'Beta answer' }], { stopReason: 'stop' }),
  ];
}
async function fixture(t, rows = branchedRows(), extra = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-pi-contract-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'actual-project');
  const dir = path.join(home, 'sessions', '--deliberately-not-the-cwd--');
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(repoRoot);
  const file = path.join(dir, 'synthetic.jsonl');
  const header = { type: 'session', version: 3, id: 'native-session', timestamp, cwd: repoRoot, ...extra };
  const text = [header, ...rows].map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, text);
  return { sourceHome: home, repoRoot, file, text, header };
}
async function indexed(t, f) {
  const index = await buildPiIndex(f);
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  await validateIndexOwnershipForCommit(index);
  return index;
}
async function history(t, f) {
  const service = await createHistoryService({ repo: f.repoRoot, source: 'pi', piHome: f.sourceHome });
  t.after(() => service.close());
  return service;
}

test('pi is native indexed-materialized and project discovery follows header cwd', async (t) => {
  assert.ok(supportedSourceKinds().includes('pi'));
  assert.equal(piAdapter.sessionLifecycle, 'indexed-materialized-v1');
  assert.equal(piAdapter.homeOption, 'piHome');
  const f = await fixture(t);
  const projects = await discoverPiProjects({ sourceHome: f.sourceHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].repoRoot, f.repoRoot);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('pi exposes every branch with branch-local history, exact tool ownership and projection parity', async (t) => {
  const f = await fixture(t);
  const index = await indexed(t, f);
  assert.deepEqual(index.sessions.map((s) => s.id).sort(), ['pi:native-session:a2', 'pi:native-session:b2']);
  for (const stored of index.sessions) {
    assert.equal(stored.sourceSessionId, 'native-session');
    assert.ok(stored.title.includes(stored.sourceDerivedId));
    assert.equal(Object.hasOwn(stored, 'logicalEvents'), false, 'indexed session must not retain materialized messages');
    const session = await materializeSessionForIndex(index, stored);
    assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), stored.queryProjectionDigest);
    const content = session.logicalEvents.filter((e) => e.layer === 'main').map((e) => e.searchText).join('\n');
    assert.match(content, /SHARED_ORIGIN/);
    assert.match(content, stored.sourceDerivedId === 'a2' ? /BRANCH_ALPHA_ONLY/ : /BRANCH_BETA_ONLY/);
    assert.doesNotMatch(content, stored.sourceDerivedId === 'a2' ? /BRANCH_BETA_ONLY/ : /BRANCH_ALPHA_ONLY/);
    assert.equal(session.counts.toolCalls, 1);
    assert.equal(session.counts.reasoning, 1);
    const command = session.logicalEvents.find((e) => e.kind === 'command');
    assert.equal(command.status, 'success');
    assert.equal(command.rawRefs.length, 2);
    const detail = await buildEventDetailForSession(index, session, command.id, 'main');
    assert.match(JSON.stringify(detail), /TOOL_INPUT_MARKER/);
    assert.match(JSON.stringify(detail), /TOOL_OUTPUT_MARKER/);
    for (const ref of command.rawRefs) {
      const raw = await readIndexedRawRecord(index, session, ref.rawId);
      assert.equal(raw.sourceKind, 'pi');
      assert.equal(ref.sourceLocator.type, 'jsonl_line');
      assert.ok(ref.sourceLocator.line >= 3);
    }
  }
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text, 'reading must not invoke writer migration or alter source');
});

test('pi history search reaches both branches and returns verifiable Detail and Raw evidence', async (t) => {
  const f = await fixture(t);
  const service = await history(t, f);
  const status = await service.execute('status');
  assert.equal(status.coverage.source, 'pi');
  assert.equal(status.coverage.sessionCount, 2);
  const shared = await service.execute('search', { query: 'SHARED_ORIGIN' });
  assert.equal(shared.scan.matchedSessions, 2, 'shared prefix intentionally belongs to each branch');
  assert.equal(shared.scan.matchedEvents, 2);
  for (const [needle, leaf] of [['BRANCH_ALPHA_ONLY', 'a2'], ['BRANCH_BETA_ONLY', 'b2']]) {
    const result = await service.execute('search', { query: needle });
    assert.equal(result.scan.matchedSessions, 1);
    assert.equal(result.items[0].sessionId, `pi:native-session:${leaf}`);
    const detail = await service.execute('read', { refs: [result.items[0].ref], parts: ['message', 'raw'] });
    assert.match(JSON.stringify(detail), new RegExp(needle));
    assert.ok(detail.items[0].rawRefs.length > 0);
    const raw = await service.execute('read', { refs: detail.items[0].rawRefs, parts: ['raw'] });
    assert.match(JSON.stringify(raw), new RegExp(needle));
  }
});

test('pi context/configuration/extension records preserve searchable history without rewriting earlier messages', async (t) => {
  const rows = [
    message('u', null, 'user', 'ORIGINAL_CONTEXT_TEXT'),
    entry('m', 'u', 'model_change', { provider: 'synthetic-provider', modelId: 'synthetic-model' }),
    entry('think', 'm', 'thinking_level_change', { thinkingLevel: 'high' }),
    entry('usage', 'think', 'usage', { kind: 'cache_warm', provider: 'synthetic-provider', model: 'synthetic-model', usage: { input: 10, output: 0 } }),
    entry('custom', 'usage', 'custom', { customType: 'synthetic-extension', data: { note: 'EXTENSION_EVIDENCE' } }),
    entry('custommsg', 'custom', 'custom_message', { customType: 'note', content: 'CUSTOM_MESSAGE_EVIDENCE', display: false }),
    entry('summary', 'custommsg', 'branch_summary', { fromId: 'u', summary: 'BRANCH_SUMMARY_EVIDENCE' }),
    entry('edit', 'summary', 'context_edit', { targetId: 'u', replacement: null }),
    entry('compact', 'edit', 'compaction', { summary: 'COMPACTION_EVIDENCE', firstKeptEntryId: 'u', tokensBefore: 10 }),
    entry('label', 'compact', 'label', { targetId: 'u', label: 'saved point' }),
    entry('name', 'label', 'session_info', { name: 'Synthetic named branch' }),
  ];
  const f = await fixture(t, rows);
  const index = await indexed(t, f);
  assert.match(index.sessions[0].title, /Synthetic named branch/);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.ok(session.logicalEvents.some((e) => e.kind === 'user_message' && e.searchText === 'ORIGINAL_CONTEXT_TEXT'));
  for (const type of ['model_change', 'thinking_level_change', 'usage', 'custom', 'custom_message', 'branch_summary', 'context_edit', 'label', 'session_info']) {
    const raw = session.rawEvents.find((e) => e.recordType === type);
    assert.ok(raw, type);
    assert.ok(session.logicalEvents.some((e) => e.layer === 'protocol' && e.rawRefs.some((r) => r.rawId === raw.rawId)), `${type} must retain Protocol evidence`);
  }
  assert.ok(session.logicalEvents.some((e) => e.kind === 'compaction'));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('pi textual search excludes image payloads and signatures across Main, Protocol and Raw', async (t) => {
  const f = await fixture(t, [
    message('u', null, 'user', [{ type: 'text', text: 'Visible image caption' }, { type: 'image', mimeType: 'image/png', data: 'IMAGE_BYTES_SENTINEL' }]),
    message('a', 'u', 'assistant', [{ type: 'thinking', thinking: 'Visible thought', thinkingSignature: 'SIGNATURE_BYTES_SENTINEL' }]),
  ]);
  const service = await history(t, f);
  for (const layer of ['main', 'protocol', 'raw']) {
    for (const query of ['IMAGE_BYTES_SENTINEL', 'SIGNATURE_BYTES_SENTINEL']) {
      const result = await service.execute('search', { layer, query });
      assert.equal(result.scan.matchedEvents, 0, `${layer}: ${query}`);
    }
  }
  assert.equal((await service.execute('search', { query: 'Visible image caption' })).scan.matchedEvents, 1);
});

test('pi unsupported versions produce diagnostics and never trigger migration', async (t) => {
  const f = await fixture(t, [message('u', null, 'user', 'not admitted')], { version: 2 });
  const diagnostics = [];
  const index = await buildPiIndex({ ...f, onDiagnostic: (d) => diagnostics.push(d) });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  assert.equal(index.sessions.length, 0);
  assert.ok(diagnostics.some((d) => d.code === 'PI_SESSION_VERSION_UNSUPPORTED'));
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

async function json(base, endpoint, options = {}) {
  const response = await fetch(base + endpoint, { ...options, headers: { 'content-type': 'application/json' } });
  return { status: response.status, body: await response.json() };
}
test('pi uses source-neutral HTTP project, timeline, Detail and Raw routes', async (t) => {
  const f = await fixture(t);
  const server = createServer(null, 0, { source: 'pi', piHome: f.sourceHome });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const projects = await json(base, '/api/projects');
  assert.equal(projects.status, 200);
  assert.equal(projects.body.sourceKind, 'pi');
  assert.ok(projects.body.projects.some((p) => p.repoRoot === f.repoRoot));
  const start = await json(base, '/api/project', { method: 'POST', body: JSON.stringify({ repoRoot: f.repoRoot }) });
  assert.equal(start.status, 202);
  let state;
  for (let n = 0; n < 200; n++) {
    state = (await json(base, `/api/project/status?jobId=${encodeURIComponent(start.body.job.id)}`)).body;
    if (['succeeded', 'failed'].includes(state.job?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(state.job.status, 'succeeded');
  assert.equal(state.state.totals.sessionCount, 2);
  for (const leaf of ['a2', 'b2']) {
    const id = encodeURIComponent(`pi:native-session:${leaf}`);
    const timeline = await json(base, `/api/sessions/${id}/timeline?layer=main&limit=30`);
    assert.equal(timeline.status, 200);
    const event = timeline.body.events.find((e) => e.kind === 'command');
    assert.ok(event);
    const detail = await json(base, `/api/sessions/${id}/events/${encodeURIComponent(event.id)}/detail?layer=main`);
    assert.equal(detail.status, 200);
    assert.match(JSON.stringify(detail.body), /TOOL_OUTPUT_MARKER/);
    const raw = await json(base, `/api/sessions/${id}/raw/${encodeURIComponent(`pi:native-session:${leaf}:raw:4`)}`);
    assert.equal(raw.status, 200);
    assert.equal(raw.body.sourceKind, 'pi');
  }
});
