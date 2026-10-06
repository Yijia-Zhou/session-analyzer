'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRetrievalArtifact, mayContainRetrievalArtifact } = require('../src/history-artifacts');
const { makeClaudeRawEvent } = require('../src/claude-source');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { requireSourceAdapter, materializeSessionForIndex } = require('../src/source-adapters');

function codexSession(command, toolName = 'exec_command') {
  const call = {
    rawId: 's:raw:1', sourceKind: 'codex',
    parsed: { type: 'response_item', payload: {
      type: 'function_call', name: toolName, call_id: 'c1',
      arguments: JSON.stringify({ cmd: command }),
    } },
  };
  const output = {
    rawId: 's:raw:2', sourceKind: 'codex',
    parsed: { type: 'response_item', payload: {
      type: 'function_call_output', call_id: 'c1',
      output: '{"producer":"session-analyzer","operation":"history.search","schemaVersion":1,"hits":[]}',
    } },
  };
  const event = { id: 's:logical:1', kind: 'other_tool_call', toolName,
    rawRefs: [{ rawId: call.rawId }, { rawId: output.rawId }] };
  return { rawEvents: [call, output], logicalEvents: [event] };
}

test('direct retrieval invocation and explicitly paired raw output are artifacts', () => {
  for (const operation of ['status', 'search', 'context', 'read']) {
    for (const prefix of ['session-analyzer', 'session-analyzer.cmd', 'npx --yes session-analyzer', 'npx -y session-analyzer@0.2.0']) {
      const session = codexSession(`${prefix} history ${operation} --query "old decision"`);
      assert.equal(classifyRetrievalArtifact(session, session.logicalEvents[0]).recognized, true);
      assert.equal(classifyRetrievalArtifact(session, session.rawEvents[1], 'raw').recognized, true);
    }
  }
});

test('quoted shell punctuation is literal while ambiguous or mixed invocations remain searchable', () => {
  const literal = codexSession('session-analyzer history search --query "a; b | c"');
  assert.equal(classifyRetrievalArtifact(literal, literal.logicalEvents[0]).recognized, true);
  for (const command of [
    'cd /repo && session-analyzer history search --query example',
    'session-analyzer history search --query example; npm test',
    'session-analyzer history search --query example | cat',
    'session-analyzer history search --query example > out.json',
    'session-analyzer history search --query $(danger)',
    'session-analyzer history search --query `danger`',
    'session-analyzer history search\nnpm test',
    'session-analyzer history search --query "unclosed',
    'npx --package another-package session-analyzer history search',
    'echo "session-analyzer history search --query old"',
    'node -e "session-analyzer history search"',
    'npm test -- session-analyzer history search',
    'session-analyzer --help',
  ]) {
    const session = codexSession(command);
    assert.equal(classifyRetrievalArtifact(session, session.logicalEvents[0]).recognized, false, command);
  }
});

test('a marker, documentation mention, or code-mode script never suffices', () => {
  const session = codexSession('cat README.md');
  assert.deepEqual(classifyRetrievalArtifact(session, session.logicalEvents[0]), { recognized: false, reason: null });
  assert.equal(classifyRetrievalArtifact(session, session.rawEvents[1], 'raw').recognized, false);
  const direct = codexSession('session-analyzer history search --query old');
  const message = { kind: 'assistant_message', searchText: 'session-analyzer history search', rawRefs: direct.logicalEvents[0].rawRefs };
  assert.equal(classifyRetrievalArtifact(direct, message).recognized, false);
  const code = { ...direct.logicalEvents[0], kind: 'code_mode_operation', toolName: 'exec' };
  assert.equal(classifyRetrievalArtifact(direct, code).recognized, false);
});

test('unpaired or ambiguous call identities are never attributed', () => {
  const session = codexSession('session-analyzer history search --query old');
  session.rawEvents[1].parsed.payload.call_id = 'missing';
  assert.equal(classifyRetrievalArtifact(session, session.rawEvents[1], 'raw').recognized, false);
  assert.equal(classifyRetrievalArtifact(session, session.logicalEvents[0]).recognized, false);
  const ambiguous = codexSession('session-analyzer history search --query old');
  ambiguous.rawEvents.push({ ...ambiguous.rawEvents[0], rawId: 'duplicate-call' });
  assert.equal(classifyRetrievalArtifact(ambiguous, ambiguous.rawEvents[1], 'raw').recognized, false);
});

test('immutable materialized-session evidence indexes are built only once', () => {
  const session = codexSession('session-analyzer history search --query old');
  let reads = 0;
  for (const raw of session.rawEvents) {
    const parsed = raw.parsed;
    Object.defineProperty(raw, 'parsed', { get() { reads += 1; return parsed; } });
  }
  assert.equal(classifyRetrievalArtifact(session, session.logicalEvents[0]).recognized, true);
  const initialReads = reads;
  for (let index = 0; index < 20; index += 1) {
    assert.equal(classifyRetrievalArtifact(session, session.rawEvents[index % 2], 'raw').recognized, true);
  }
  assert.equal(reads, initialReads, 'candidate classification must not rescan parsed raw records');
});

test('Claude parsed call blocks isolate logical operations but not mixed raw envelopes', () => {
  const call = makeClaudeRawEvent({ type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'session-analyzer history context --ref example' } },
    { type: 'tool_use', id: 'c2', name: 'Bash', input: { command: 'npm test' } },
  ] } }, 1, 'fixture.jsonl', 's', 's');
  const output = makeClaudeRawEvent({ type: 'user', uuid: 'b', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'c1', content: 'retrieved historical evidence' },
  ] } }, 2, 'fixture.jsonl', 's', 's');
  const session = { rawEvents: [call, output] };
  const event = { kind: 'command', toolName: 'Bash', callId: 'c1', rawRefs: [{ rawId: call.rawId }, { rawId: output.rawId }] };
  assert.equal(classifyRetrievalArtifact(session, event).recognized, true);
  assert.equal(classifyRetrievalArtifact(session, { ...event, callId: 'c2' }).recognized, false);
  assert.equal(classifyRetrievalArtifact(session, call, 'raw').recognized, false);
  assert.equal(classifyRetrievalArtifact(session, output, 'raw').recognized, true);
});

test('source parsing must preserve an actual tool request; message fixtures stay searchable', () => {
  const raw = makeClaudeRawEvent({ type: 'assistant', uuid: 'doc', message: { role: 'assistant', content: [
    { type: 'text', text: 'Example: session-analyzer history search --query old' },
  ] } }, 1, 'fixture.jsonl', 's', 's');
  assert.equal(classifyRetrievalArtifact({ rawEvents: [raw] }, raw, 'raw').recognized, false);
  const noParsed = { rawId: 'r', sourceKind: 'deepseek-harness', commandText: 'session-analyzer history search --query old' };
  assert.equal(classifyRetrievalArtifact({ rawEvents: [noParsed] }, noParsed, 'raw').recognized, false);
});

test('cheap hint includes output-only rows and does not claim classification', () => {
  assert.equal(mayContainRetrievalArtifact({ payloadType: 'function_call_output' }), true);
  assert.equal(mayContainRetrievalArtifact({ toolName: 'Bash' }), true);
  assert.equal(mayContainRetrievalArtifact({ kind: 'assistant_message', recordType: 'assistant' }), true);
  assert.equal(mayContainRetrievalArtifact({ kind: 'user_message', searchText: 'session-analyzer history search' }), false);
});

for (const source of ['codex', 'claude-code']) {
  test(`${source} source-backed indexing and materialization retain classifiable request evidence`, async (t) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-artifact-integration-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const repo = path.join(home, 'repo');
    await fs.mkdir(repo);
    const id = '55555555-5555-4555-8555-555555555555';
    const timestamp = '2026-09-01T00:00:00.000Z';
    const command = 'session-analyzer history search --query ANCESTOR_EVIDENCE';
    let file;
    let rows;
    if (source === 'codex') {
      file = path.join(home, 'sessions', '2026', '09', '01', `rollout-2026-09-01T00-00-00-${id}.jsonl`);
      rows = [
        { type: 'session_meta', payload: { id, cwd: repo, originator: 'codex_cli' } },
        { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'echo', arguments: JSON.stringify({ cmd: command }) } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'echo', output: 'ANCESTOR_EVIDENCE in old result' } },
      ].map((row) => ({ timestamp, ...row }));
    } else {
      file = path.join(home, 'projects', 'synthetic-project', `${id}.jsonl`);
      const base = { sessionId: id, cwd: repo, version: '2.1.220', isSidechain: false, timestamp };
      rows = [
        { ...base, type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'echo', name: 'Bash', input: { command } },
        ] } },
        { ...base, type: 'user', uuid: 'b', parentUuid: 'a', message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'echo', content: 'ANCESTOR_EVIDENCE in old result' },
        ] } },
      ];
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const adapter = requireSourceAdapter(source);
    const index = await adapter.buildIndex({ repoRoot: repo, sourceHome: home });
    assert.equal(index.sessions.length, 1);
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    const event = session.logicalEvents.find((item) => ['exec_command', 'Bash'].includes(item.toolName));
    assert.ok(event);
    assert.equal(classifyRetrievalArtifact(session, event).recognized, true);
    const result = session.rawEvents.find((raw) => source === 'codex'
      ? raw.payloadType === 'function_call_output' : raw.parsed?.type === 'user');
    assert.ok(result);
    assert.equal(classifyRetrievalArtifact(session, result, 'raw').recognized, true);
    if (source === 'codex') assert.equal(Object.hasOwn(result, 'parsed'), false, 'exercise actual compact rows');
  });
}
