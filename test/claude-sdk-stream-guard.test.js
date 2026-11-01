'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getSourceAdapter, materializeSessionForIndex } = require('../src/source-adapters');
const { sdkToolProgress, sdkTaskProgress, sdkResult } = require('./helpers/claude-sdk-fixture');
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

const standaloneEnvelopes = [
  ['tool progress', () => sdkToolProgress()],
  ['child tool progress', () => sdkToolProgress({ parent_tool_use_id: 'sdk-agent-call' })],
  ['task progress without parent_tool_use_id', () => sdkTaskProgress()],
  ['successful result', () => sdkResult()],
  // SDK subtype success may still report an API error through is_error.
  ['success-subtype API error result', () => sdkResult({ is_error: true })],
  ['startup failure result without init', () => sdkResult({
    subtype: 'error_during_execution', startup_failure_reason: 'temp_dir_unusable', result_index: 0,
  })],
  ...['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries']
    .map((subtype) => [subtype, () => sdkResult({ subtype })]),
];

for (const [mode, build] of [['complete', buildClaudeIndex], ['source-backed', buildClaudeSourceBackedIndex]]) {
  test(`Claude ${mode} reports progress/result-only roots without native project evidence`, async (t) => {
    const f = await fixture(t);
    for (const [n, [, record]] of standaloneEnvelopes.entries()) await write(f, `sdk-${n}`, [record()]);
    const index = await build(f);
    assert.equal(index.sessions.length, 0);
    assert.equal(index.totals.skippedFileCount, standaloneEnvelopes.length);
    assert.equal(index.totals.unknownFileCount, 0);
    assert.equal(index.sourceDiagnostics.counts.CLAUDE_SDK_STREAM_UNSUPPORTED, standaloneEnvelopes.length);
    const diagnostics = [];
    const projects = await getSourceAdapter('claude-code').discoverProjects({
      sourceHome: f.claudeHome, onDiagnostic: (entry) => diagnostics.push(entry),
    });
    assert.deepEqual(projects, []);
    assert.equal(diagnostics.length, standaloneEnvelopes.length);
    assert.ok(diagnostics.every((entry) => entry.code === 'CLAUDE_SDK_STREAM_UNSUPPORTED'));
  });

  for (const [label, record] of standaloneEnvelopes) {
    test(`Claude ${mode} rejects standalone and mixed SDK ${label} on cold index and reindex`, async (t) => {
      const f = await fixture(t);
      for (const id of ['native', 'standalone', 'mixed']) await write(f, id, [native(f.repoRoot, id)]);
      const before = await build(f);
      assert.equal(before.sessions.length, 3);
      const control = before.sessions.find((session) => session.sourceSessionId === 'native');
      const expected = mode === 'source-backed' ? await materializeSessionForIndex(before, control) : control;

      await write(f, 'standalone', [record()]);
      await fsp.appendFile(path.join(f.container, 'mixed.jsonl'), `${JSON.stringify(record())}\n`);
      for (const index of [await build(f), await build({ ...f, previousIndex: before })]) {
        assert.deepEqual(index.sessions.map((session) => session.sourceSessionId), ['native']);
        assert.equal(index.totals.skippedFileCount, 2);
        assert.equal(index.sourceDiagnostics.counts.CLAUDE_SDK_STREAM_UNSUPPORTED, 2);
        assert.equal(JSON.stringify(index.sourceDiagnostics).includes('Private synthetic'), false);
        const readable = mode === 'source-backed'
          ? await materializeSessionForIndex(index, index.sessions[0]) : index.sessions[0];
        assert.deepEqual(readable.rawEvents, expected.rawEvents);
        assert.deepEqual(readable.logicalEvents, expected.logicalEvents);
      }
      const diagnostics = [];
      const projects = await discoverClaudeProjects({ ...f, onDiagnostic: (entry) => diagnostics.push(entry) });
      assert.equal(projects.length, 1);
      assert.equal(projects[0].sessionCount, 1);
      assert.equal(diagnostics.length, 2);
      assert.ok(diagnostics.every((entry) => entry.code === 'CLAUDE_SDK_STREAM_UNSUPPORTED'));
    });
  }

  test(`Claude ${mode} retains native progress/result lookalikes and incomplete SDK signatures`, async (t) => {
    const f = await fixture(t);
    const nativeRecords = [native(f.repoRoot), ...standaloneEnvelopes.map(([, record]) => ({
      ...record(), sessionId: 'native',
    })), { type: 'unknown_future_record', sessionId: 'native', data: sdkTaskProgress() }];
    nativeRecords[0].message.content[0].text = JSON.stringify(sdkResult());
    await write(f, 'native', nativeRecords);
    const lookalikes = [
      { type: 'result', subtype: 'success', session_id: 'foreign-reference', result: 'Extension result.' },
      { type: 'tool_progress', session_id: 'foreign-reference', tool_name: 'Read', elapsed_time_seconds: 1 },
      { type: 'system', subtype: 'task_progress', session_id: 'foreign-reference', task_id: 'extension-task' },
      sdkToolProgress({ parent_tool_use_id: 7 }),
      sdkToolProgress({ elapsed_time_seconds: '1' }),
      sdkTaskProgress({ usage: [] }),
      sdkResult({ usage: [] }),
      sdkResult({ subtype: 'error_future_extension' }),
      ...[sdkToolProgress(), sdkTaskProgress(), sdkResult()].map((record) => {
        delete record.session_id;
        return record;
      }),
    ];
    for (const [n, record] of lookalikes.entries()) await write(f, `lookalike-${n}`, [record]);
    const index = await build(f);
    assert.equal(index.sessions.length, lookalikes.length + 1);
    assert.equal(index.sourceDiagnostics.totalCount, 0);
    assert.equal(index.totals.skippedFileCount, 0);
    for (const session of index.sessions) {
      const readable = mode === 'source-backed' ? await materializeSessionForIndex(index, session) : session;
      assert.equal(readable.rawEvents.length, session.sourceSessionId === 'native' ? nativeRecords.length : 1);
      if (session.sourceSessionId !== 'native') {
        assert.equal(readable.counts.userMessages, 0);
        assert.deepEqual(readable.logicalEvents.map((event) => event.kind), ['protocol']);
      }
    }
  });

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
