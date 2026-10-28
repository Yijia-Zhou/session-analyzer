'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getSourceAdapter } = require('../src/source-adapters');
const {
  buildClaudeIndex,
  buildClaudeSourceBackedIndex,
  discoverClaudeProjects,
} = require('../src/claude');

async function fixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-sdk-guard-'));
  const repoRoot = path.join(home, 'repo');
  const container = path.join(home, 'projects', 'synthetic');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(container, { recursive: true });
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  return { claudeHome: home, repoRoot, container };
}

async function write(f, name, records) {
  await fsp.writeFile(path.join(f.container, `${name}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function native(cwd, id = 'native') {
  return {
    type: 'user', sessionId: id, cwd, uuid: `${id}-user`,
    timestamp: '2026-10-01T00:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'Inspect a synthetic example.' }] },
  };
}

function sdkInit(cwd) {
  return { type: 'system', subtype: 'init', cwd, session_id: 'sdk-session',
    model: 'synthetic-model', tools: ['Agent'], claude_code_version: '2.1.282' };
}

function sdkChild() {
  return { type: 'user', session_id: 'sdk-session', uuid: 'sdk-child-prompt',
    parent_tool_use_id: 'sdk-agent-call', message: { role: 'user',
      content: [{ type: 'text', text: 'Private synthetic child task; not a human prompt.' }] } };
}

for (const [mode, build] of [['complete', buildClaudeIndex], ['source-backed', buildClaudeSourceBackedIndex]]) {
  test(`Claude ${mode} index excludes SDK streams and retains unrelated native transcripts`, async (t) => {
    const f = await fixture(t);
    await write(f, 'native', [native(f.repoRoot)]);
    await write(f, 'sdk', [sdkInit(f.repoRoot), sdkChild()]);
    const projects = await discoverClaudeProjects(f);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].sessionCount, 1);
    const index = await build(f);
    assert.deepEqual(index.sessions.map((session) => session.sourceSessionId), ['native']);
    assert.equal(index.totals.skippedFileCount, 1);
    assert.equal(index.totals.unknownFileCount, 0);
    assert.equal(index.sourceDiagnostics.counts.CLAUDE_SDK_STREAM_UNSUPPORTED, 1);
    assert.match(index.sourceDiagnostics.samples[0].message, /native Claude Code project JSONL/);
    assert.equal(JSON.stringify(index.sourceDiagnostics).includes('Private synthetic'), false);
    const reused = await build({ ...f, previousIndex: index });
    assert.deepEqual(reused.sourceDiagnostics, index.sourceDiagnostics);
    assert.deepEqual(reused.totals, { ...index.totals, reusedFileCount: 1 });
  });

  test(`Claude ${mode} guard recognizes headerless SDK children and mixed exports`, async (t) => {
    const f = await fixture(t);
    await write(f, 'headerless', [sdkChild()]);
    await write(f, 'mixed', [native(f.repoRoot, 'mixed'), sdkChild()]);
    const index = await build(f);
    assert.equal(index.sessions.length, 0);
    assert.equal(index.totals.skippedFileCount, 2);
    assert.equal(index.sourceDiagnostics.counts.CLAUDE_SDK_STREAM_UNSUPPORTED, 2);
    assert.deepEqual(await discoverClaudeProjects(f), []);
  });

  test(`Claude ${mode} rejects top-level and partial SDK output without a header`, async (t) => {
    const f = await fixture(t);
    await write(f, 'top-level', [{ type: 'assistant', session_id: 'sdk-top',
      parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'SDK output.' }] } }]);
    await write(f, 'partial', [{ type: 'stream_event', session_id: 'sdk-partial',
      parent_tool_use_id: null, event: { type: 'message_start', message: {} } }]);
    const index = await build(f);
    assert.equal(index.sessions.length, 0);
    assert.equal(index.sourceDiagnostics.counts.CLAUDE_SDK_STREAM_UNSUPPORTED, 2);
  });

  test(`Claude ${mode} reindex removes a native file replaced by an SDK stream`, async (t) => {
    const f = await fixture(t);
    await write(f, 'replace', [native(f.repoRoot, 'replace')]);
    const before = await build(f);
    assert.equal(before.sessions.length, 1);
    await write(f, 'replace', [sdkInit(f.repoRoot), sdkChild()]);
    const after = await build({ ...f, previousIndex: before });
    assert.equal(after.sessions.length, 0);
    assert.equal(after.totals.reusedFileCount, 0);
    assert.equal(after.totals.skippedFileCount, 1);
    assert.equal(after.sourceDiagnostics.counts.CLAUDE_SDK_STREAM_UNSUPPORTED, 1);
    assert.deepEqual(after.totals, (await build(f)).totals);
  });

  test(`Claude ${mode} preserves native foreign-session evidence and unknown records`, async (t) => {
    const f = await fixture(t);
    const user = native(f.repoRoot);
    user.session_id = 'foreign-source';
    user.parent_tool_use_id = null;
    user.message.content[0].text = JSON.stringify(sdkChild());
    await write(f, 'native', [user, { type: 'unknown_future_record', sessionId: 'native',
      session_id: 'foreign-source', parent_tool_use_id: 'quoted-only', data: sdkInit(f.repoRoot) }]);
    const index = await build(f);
    assert.equal(index.sessions.length, 1);
    assert.equal(index.sessions[0].sourceSessionId, 'native');
    assert.equal(index.sourceDiagnostics.totalCount, 0);
    assert.equal(index.totals.rawEventCount, 2);
    assert.equal(index.totals.skippedFileCount, 0);
  });
}

test('Claude SDK diagnostics are bounded and rejection clears after a native rewrite', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 23; n += 1) await write(f, `sdk-${n}`, [sdkInit(f.repoRoot)]);
  const index = await buildClaudeSourceBackedIndex(f);
  assert.equal(index.sourceDiagnostics.totalCount, 23);
  assert.equal(index.sourceDiagnostics.samples.length, 20);
  assert.equal(index.sourceDiagnostics.truncatedCount, 3);
  await write(f, 'sdk-0', [native(f.repoRoot, 'repaired')]);
  const next = await buildClaudeSourceBackedIndex({ ...f, previousIndex: index });
  assert.equal(next.sessions.length, 1);
  assert.equal(next.sessions[0].sourceSessionId, 'repaired');
  assert.equal(next.sourceDiagnostics.totalCount, 22);
  assert.equal(next.totals.skippedFileCount, 22);
});


test('Claude adapter discovery reports SDK-only roots through the shared diagnostic callback', async (t) => {
  const f = await fixture(t);
  await write(f, 'sdk', [sdkInit(f.repoRoot), sdkChild()]);
  const diagnostics = [];
  const projects = await getSourceAdapter('claude-code').discoverProjects({
    sourceHome: f.claudeHome, onDiagnostic: (entry) => diagnostics.push(entry),
  });
  assert.deepEqual(projects, []);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'CLAUDE_SDK_STREAM_UNSUPPORTED');
  assert.match(diagnostics[0].message, /not a supported persisted project transcript/);
});
