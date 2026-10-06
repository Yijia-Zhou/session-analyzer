'use strict';

// Synthetic native format-4 records; shell renderer contract pinned at 639ed015.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { buildDeepSeekIndex, deepSeekAdapter, readDeepSeekRawRecord } = require('../src/deepseek-harness');
const { materializeSessionForIndex, buildEventDetailForSession, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

const guidance = 'The command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.';
const cases = [
  { name: 'exit-seven', text: 'output\n[exit code: 7]', status: 'failed', exitCode: 7 },
  { name: 'empty-failure', text: '(no output)\n[exit code: 1]', status: 'failed', exitCode: 1 },
  { name: 'success', text: 'ordinary output', status: 'success' },
  { name: 'signal', text: 'output\n[killed by signal: SIGTERM]', status: 'failed' },
  { name: 'timeout', text: 'output\n[timed out after 50ms]', status: 'failed' },
  { name: 'timeout-exit', text: 'output\n[timed out after 50ms]\n[exit code: 143]', status: 'failed', exitCode: 143 },
  { name: 'stopped', text: 'output\n[stopped: user]\n[killed by signal: SIGTERM]', status: 'interrupted' },
  { name: 'promoted', text: `[still running after 50ms; moved to background job job-one]\n${guidance}`, status: 'incomplete' },
  { name: 'background', text: 'background acknowledgement\n[exit code: 7]', status: 'incomplete', background: true },
  { name: 'infra-error', text: 'spawn failed\n[exit code: 7]', status: 'failed', isError: true },
  { name: 'interior-marker', text: 'output\n[exit code: 7]\nmore output', status: 'success' },
  { name: 'bare-marker', text: '[exit code: 7]', status: 'success' },
  { name: 'trailing-newline', text: 'output\n[exit code: 7]\n', status: 'success' },
  { name: 'unsafe-code', text: 'output\n[exit code: 9007199254740992]', status: 'completed' },
  { name: 'unknown-code', text: 'output\n[exit code: null]', status: 'completed' },
  { name: 'foreign-tool', text: 'output\n[exit code: 7]', status: 'success', tool: 'read' },
];

for (const compressed of [false, true]) test(`native shell outcomes agree across direct/PTC and readback (compressed=${compressed})`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-shell-result-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const sourceHome = path.join(root, 'sessions');
  const directory = path.join(sourceHome, 'project', 'synthetic-shell');
  await fs.mkdir(repoRoot);
  await fs.mkdir(directory, { recursive: true });
  const rows = [{ type: 'session', version: 4, id: 'synthetic-shell', createdAt: 1, cwd: repoRoot, isSeeded: false, delegationDepth: 0 }];
  const push = (type, data) => { const seq = rows.length - 1; rows.push({ type, seq, time: 1000 + seq, data }); };
  const content = text => [{ type: 'text', text }];
  const result = (id, text, isError = false) => {
    push('tool/result', { turn: 1, step: 1, message: {
      id: `result-${id}`, role: 'tool', source: { kind: 'tool', callId: id }, toolCallId: id, isError, content: content(text),
    } });
    rows.at(-1).surfaceOp = 'append';
  };
  push('tool/call', { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{"code":"synthetic dispatches"}' });
  for (const [position, c] of cases.entries()) {
    const tool = c.tool || (position % 2 ? 'bash' : 'pwsh');
    const args = { command: `synthetic ${c.name}`, ...(c.background ? { run_in_background: true } : {}) };
    push('tool/call', { turn: 1, step: 1, callId: `direct-${c.name}`, name: tool, arguments: JSON.stringify(args) });
    result(`direct-${c.name}`, c.text, c.isError || false);
    const dispatch = { rootCallId: 'outer', parentCallId: 'outer', subCallId: `nested-${c.name}`, name: tool, arguments: args };
    push('tool/ptc-dispatch-start', dispatch);
    push('tool/ptc-dispatch', { ...dispatch, isError: c.isError || false, content: content(c.text) });
  }
  result('outer', 'synthetic dispatches complete');
  const bytes = rows.map(row => Buffer.from(`${JSON.stringify(row)}\n`));
  await fs.writeFile(path.join(directory, `session.v4.jsonl${compressed ? '.zstd' : ''}`), Buffer.concat(compressed ? bytes.map(value => zstdCompressSync(value)) : bytes));
  const index = await buildDeepSeekIndex({ repoRoot, sourceHome });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  await validateIndexOwnershipForCommit(index);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  for (const c of cases) for (const prefix of ['direct', 'nested']) {
    const id = `${prefix}-${c.name}`;
    const event = session.logicalEvents.find(e => e.id.endsWith(`:${id}`));
    assert.ok(event, id);
    assert.equal(event.status, c.status, id);
    assert.equal(event.outputStats.exitCode, c.exitCode, id);
    assert.equal(event.kind, c.tool ? 'other_tool_call' : 'command', id);
    const detail = await buildEventDetailForSession(index, session, event.id, 'main');
    if (c.exitCode !== undefined) assert.ok(detail.inspectorSections.some(s => s.entries?.some(entry => entry.fact === 'exitCode' && entry.value === String(c.exitCode))), `${id} detail exit`);
    const raw = session.rawEvents.find(r => r.rawId === event.rawRefs.at(-1).rawId);
    const source = await readDeepSeekRawRecord(index, session, raw);
    assert.equal(source.raw, JSON.stringify(rows[raw.sourceLocator.recordOrdinal]), `${id} exact Raw`);
  }
  const failedCount = cases.filter(c => c.status === 'failed' && !c.tool).length * 2;
  assert.equal(session.counts.failedCommands, failedCount);
  assert.equal(index.sessions[0].counts.failedCommands, failedCount);
  assert.equal((await deepSeekAdapter.query.filterSessions(index, { layer: 'main', kind: 'command', status: 'failed' })).matchingEventTotal, failedCount);
  assert.equal((await deepSeekAdapter.query.getTimelineAsync(index, session, { layer: 'main', kind: 'command', status: 'failed' })).total, failedCount);
  assert.equal((await deepSeekAdapter.query.filterSessions(index, { layer: 'main', kind: 'command', status: 'failed', q: 'synthetic exit-seven' })).matchingEventTotal, 2);
  assert.equal((await deepSeekAdapter.query.getTimelineAsync(index, session, { layer: 'main', kind: 'command', status: 'failed', q: 'synthetic exit-seven' })).searchEventCount, 2);
});
