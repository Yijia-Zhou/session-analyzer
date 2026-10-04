'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const codex = require('../src/codex');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

const receipt = (status, body = 'synthetic output') => `Chunk ID: synthetic\nWall time: 1.2500 seconds\nProcess ${status}\nOriginal token count: 2\nOutput:\n${body}`;
const cases = [
  { id: 'failed', output: receipt('exited with code 7'), status: 'failed', exitCode: 7 },
  { id: 'success', output: receipt('exited with code 0'), status: 'success', exitCode: 0 },
  { id: 'empty-output', output: receipt('exited with code 0', ''), status: 'success', exitCode: 0, empty: true },
  { id: 'running', output: receipt('running with session ID 1234'), status: 'incomplete' },
  { id: 'unknown', output: 'ordinary unrecognized output', status: 'completed' },
  { id: 'lookalike', output: `ordinary output\n${receipt('exited with code 7')}`, status: 'completed' },
  { id: 'unsafe-code', output: receipt('exited with code 9007199254740992'), status: 'completed' },
  { id: 'pending', status: 'incomplete' },
  { id: 'namespace', namespace: 'functions', output: receipt('exited with code 7'), status: 'failed', exitCode: 7 },
  { id: 'qualified', name: 'functions.exec_command', output: receipt('exited with code 0'), status: 'success', exitCode: 0 },
  { id: 'foreign', namespace: 'foreign', output: receipt('exited with code 7'), status: 'completed', fallback: true },
  { id: 'invalid-command', arguments: '{"cmd":7}', output: receipt('exited with code 7'), status: 'completed', fallback: true },
  { id: 'duplicate-key', arguments: '{"cmd":"first","cmd":"second"}', output: receipt('exited with code 7'), status: 'completed', fallback: true },
  { id: 'duplicate-output', output: receipt('exited with code 7'), status: 'completed', fallback: true, repeatOutput: true },
  { id: 'conflicting-request', output: receipt('exited with code 7'), status: 'completed', fallback: true, conflictCall: true },
  { id: 'conflicting-output', output: receipt('exited with code 7'), status: 'completed', fallback: true, conflictOutput: true },
  { id: 'cross-turn', output: receipt('exited with code 7'), status: 'completed', fallback: true, crossTurn: true },
  { id: 'old-format', output: 'Exit code: 7\nWall time: 1s\nOutput:\nsynthetic old output', status: 'failed', exitCode: 7, old: true },
  { id: 'lifecycle-success', output: receipt('exited with code 7'), status: 'success', exitCode: 0, lifecycleExit: 0 },
  { id: 'lifecycle-failure', output: receipt('exited with code 0'), status: 'failed', exitCode: 8, lifecycleExit: 8 },
  { id: 'lifecycle-completed', output: receipt('running with session ID 1234'), status: 'success', exitCode: 0, lifecycleExit: 0 },
];

for (const compressed of [false, true]) test(`durable exec_command has command semantics with exact result evidence (compressed=${compressed})`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-durable-command-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(repoRoot); await fs.mkdir(path.join(root, 'sessions'));
  const id = 'aaaaaaaa-1004-4004-8004-aaaaaaaaaaaa';
  const rows = [{ type: 'session_meta', payload: { id, session_id: id, cwd: repoRoot, cli_version: '0.160.0', originator: 'codex_cli_rs', source: 'cli', history_mode: 'legacy' } }];
  for (const c of cases) {
    rows.push({ type: 'response_item', payload: { type: 'function_call', name: c.name || 'exec_command', call_id: c.id,
      ...(c.namespace ? { namespace: c.namespace } : {}), arguments: c.arguments || JSON.stringify({ cmd: `synthetic ${c.id}`, workdir: repoRoot }) } });
    if (c.conflictCall) rows.push({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'foreign_tool', call_id: c.id, input: 'synthetic conflicting request' } });
    if (c.lifecycleExit !== undefined) rows.push({ type: 'event_msg', payload: { type: 'exec_command_end', call_id: c.id,
      command: `synthetic ${c.id}`, cwd: repoRoot, exit_code: c.lifecycleExit, duration: { secs: 2, nanos: 0 }, status: 'completed' } });
    if (c.output !== undefined) {
      if (c.crossTurn) rows.push({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'different-turn' } });
      const output = { type: 'response_item', payload: { type: 'function_call_output', call_id: c.id, output: c.output } };
      rows.push(output);
      if (c.repeatOutput) rows.push(structuredClone(output));
      if (c.conflictOutput) rows.push({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: c.id, output: '{"output":"synthetic conflicting result"}' } });
    }
  }
  const body = Buffer.from(`${rows.map(JSON.stringify).join('\n')}\n`);
  await fs.writeFile(path.join(root, 'sessions', `synthetic.jsonl${compressed ? '.zst' : ''}`), compressed ? zstdCompressSync(body) : body);
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome: root });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  await validateIndexOwnershipForCommit(index);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  for (const c of cases) {
    const event = session.logicalEvents.find(e => e.id.endsWith(`:${c.id}`));
    assert.ok(event, c.id);
    assert.equal(event.kind, c.fallback ? 'other_tool_call' : 'command', c.id);
    assert.equal(event.status, c.status, c.id);
    assert.equal(event.outputStats.exitCode, c.exitCode, c.id);
    const detail = await codex.buildHydratedEventDetail(index, session, event.id, 'main');
    if (!c.fallback) assert.ok(detail.timelineSections.some(s => s.type === 'code' && s.code === `synthetic ${c.id}`), `${c.id} readable command`);
    if (c.empty) assert.equal(detail.timelineSections.some(s => s.type === 'terminal'), false, 'empty stdout does not display the receipt header as output');
    if (c.exitCode !== undefined && !c.old) assert.equal(event.outputStats.durationMs, c.lifecycleExit !== undefined ? 2000 : 1250, c.id);
    for (const ref of event.rawRefs) {
      const raw = session.rawEvents.find(r => r.rawId === ref.rawId);
      const source = await codex.readIndexedCodexRawRecord(index, session, raw);
      assert.equal(source.raw, JSON.stringify(rows[raw.line - 1]), `${c.id} exact Raw`);
    }
  }
  assert.equal(session.counts.failedCommands, 4);
  assert.equal(index.sessions[0].counts.failedCommands, 4);
  assert.equal((await codex.query.filterSessions(index, { layer: 'main', kind: 'command', status: 'failed' })).matchingEventTotal, 4);
  assert.equal((await codex.query.getTimelineAsync(index, session, { layer: 'main', kind: 'command', status: 'failed' })).total, 4);
  assert.equal((await codex.query.filterSessions(index, { layer: 'main', kind: 'command', status: 'failed', q: 'synthetic namespace' })).matchingEventTotal, 1);
  const searched = await codex.query.getTimelineAsync(index, session, { layer: 'main', kind: 'command', status: 'failed', q: 'synthetic namespace' });
  assert.equal(searched.searchEventCount, 1);
  assert.equal(searched.events.find(event => event.hasSearchHit).id.endsWith(':namespace'), true);
});
