'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../src/claude-source');
const { createClaudeLogicalBuilder } = require('../src/claude-logical');
const { buildClaudeEventDetail } = require('../src/claude-detail');

// Synthetic reproductions of observed 2.1.283 receipts, not copied transcripts.
function pair(name = 'mcp__synthetic__delay', id = 'call', task = 'ksynthetic') {
  const text = `MCP tool "synthetic/delay" is still running after 1s. It was moved to the background as task ${task} and keeps running; you'll receive a notification with the result when it completes. You can keep working in the meantime. To stop it, use TaskStop with task_id "${task}". Note: it does not survive exiting this session.`;
  const content = [{ type: 'text', text }];
  return [
    { type: 'assistant', uuid: `${id}-uuid`, message: { content: [{ type: 'tool_use', id, name,
      input: name === 'Monitor' ? { command: 'synthetic-watch', description: 'Synthetic watch', timeout_ms: 3000, persistent: false } : {} }] } },
    { type: 'user', sourceToolAssistantUUID: `${id}-uuid`,
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: name === 'Monitor' ? 'Monitor started' : content }] },
      toolUseResult: name === 'Monitor' ? { taskId: task, timeoutMs: 3000, persistent: false } : structuredClone(content) },
  ];
}

function notification({ task = 'ksynthetic', id = '', status = 'completed', monitor = false, result = 'Synthetic final output' } = {}) {
  const text = `<task-notification><task-id>${task}</task-id>${id ? `<tool-use-id>${id}</tool-use-id>` : ''}<status>${status}</status><summary>Synthetic terminal</summary><${monitor ? 'event' : 'result'}>${result}</${monitor ? 'event' : 'result'}></task-notification>`;
  return [
    { type: 'queue-operation', operation: 'enqueue', content: text },
    { type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { content: text } },
  ];
}

function project(records) {
  const rawEvents = records.map((r, i) => source.makeClaudeRawEvent({ sessionId: 'synthetic-background',
    uuid: `row-${i}`, version: '2.1.283', ...r }, i + 1, 'synthetic.jsonl', 'claude-code:synthetic-background', 'synthetic-background'));
  const builder = createClaudeLogicalBuilder({ ...source, rawRef: source.claudeRawRef });
  const session = { rawEvents, logicalEvents: builder.buildLogicalEvents(rawEvents) };
  return { session, event: session.logicalEvents.find(e => e.callId === 'call'),
    protocols: session.logicalEvents.filter(e => e.layer === 'protocol') };
}

test('MCP launch remains in progress; exact trusted success/failure mirrors finish one operation', () => {
  assert.equal(project(pair()).event.status, 'in_progress');
  for (const [status, expected] of [['completed', 'success'], ['failed', 'failed']]) {
    const f = project([...pair(), ...notification({ status })]);
    assert.equal(f.event.kind, 'mcp_call');
    assert.equal(f.event.status, expected);
    assert.equal(f.event.lifecycle.kind, 'background_mcp');
    assert.equal(f.event.lifecycle.notifications.length, 1);
    assert.equal(f.event.rawRefs.length, 4);
    assert.equal(f.protocols.length, 0);
    assert.match(f.event.searchText, /Synthetic final output/);
    for (const locale of ['en', 'zh-CN']) {
      const detail = buildClaudeEventDetail(f.session, f.event.id, 'main', { locale });
      assert.match(JSON.stringify(detail), /Synthetic final output/);
      assert.doesNotMatch(JSON.stringify(detail.inspectorSections), /Async agent launched|异步 Agent 已启动/);
    }
  }
});

test('MCP receipt must be uniquely owned, exact, successful and match the called server/tool', () => {
  const mutations = [
    r => { r[0].message.content[0].name = 'mcp__other__delay'; },
    r => { r[1].sourceToolAssistantUUID = 'other'; },
    r => { r[1].toolUseResult = [{ type: 'text', text: 'unrelated' }]; },
    r => { r[1].message.content[0].is_error = true; },
    r => { r[1].toolDenialKind = 'permission_denied'; },
    r => { r[1].message.content.push({ type: 'tool_result', tool_use_id: 'other', content: 'other' }); },
    r => { r.push(structuredClone(r[1])); },
    r => { r[0].message.content.push(structuredClone(r[0].message.content[0])); },
  ];
  for (const mutate of mutations) {
    const records = pair(); mutate(records);
    assert.equal(project([...records, ...notification()]).event.lifecycle, undefined);
  }
});

test('MCP task-only notifications require system provenance, causal unique ownership and exact mirrors', () => {
  const human = notification()[1]; delete human.origin; delete human.promptSource;
  const wrongTask = notification({ task: 'wrong' });
  const duplicate = notification();
  const malformed = notification().map(r => JSON.parse(JSON.stringify(r).replace('Synthetic terminal', '<status>failed</status>')));
  const cases = [
    [...pair(), notification()[0]],
    [...pair(), human],
    [...pair(), ...wrongTask],
    [...notification(), ...pair()],
    [...pair(), ...notification(), ...duplicate],
    [...pair(), ...notification(), ...notification({ status: 'failed' })],
    [...pair(), ...malformed],
    [...pair(), ...notification({ id: 'wrong-call' })],
    [...pair(), ...pair('mcp__synthetic__delay', 'sibling'), ...notification()],
  ];
  for (const records of cases) {
    const f = project(records);
    assert.equal(f.event.status, 'in_progress');
    assert.equal(f.event.rawRefs.length, 2);
    assert.ok(f.session.logicalEvents.some(e => !e.callId));
  }
  assert.equal(project([...pair(), notification()[1]]).event.status, 'success');
});

test('Monitor receipt is not completion; exact terminal includes final event output', () => {
  assert.equal(project(pair('Monitor')).event.status, 'in_progress');
  const f = project([...pair('Monitor'), ...notification({ id: 'call', monitor: true })]);
  assert.equal(f.event.kind, 'other_tool_call');
  assert.equal(f.event.status, 'success');
  assert.equal(f.event.lifecycle.kind, 'monitor');
  assert.equal(f.event.lifecycle.terminal.result, 'Synthetic final output');
  assert.equal(f.event.rawRefs.length, 4);
  assert.equal(project([...pair('Monitor'), ...notification({ id: 'call', monitor: true, status: 'failed' })]).event.status, 'failed');
});

test('large background terminals retain outcomes with bounded presentation and exact full-text mirrors', () => {
  for (const name of ['mcp__synthetic__delay', 'Monitor']) {
    for (const status of ['completed', 'failed']) {
      for (const [summaryLength, resultLength] of [[4000, 16000], [4001, 16001], [6000, 20000]]) {
        const rows = notification({ status, monitor: name === 'Monitor', id: name === 'Monitor' ? 'call' : '', result: 'x'.repeat(resultLength) })
          .map(r => JSON.parse(JSON.stringify(r).replace('Synthetic terminal', 's'.repeat(summaryLength))));
        const fixture = project([...pair(name), ...rows]);
        assert.equal(fixture.event.status, status === 'completed' ? 'success' : 'failed');
        assert.equal(fixture.event.rawRefs.length, 4);
        assert.ok(fixture.event.lifecycle.terminal.summary.length <= 4000);
        assert.ok(fixture.event.lifecycle.terminal.result.length <= 16000);
        if (resultLength > 16000) assert.match(fixture.event.lifecycle.terminal.result, /omitted; see raw refs/);
        for (const locale of ['en', 'zh-CN']) {
          const detail = buildClaudeEventDetail(fixture.session, fixture.event.id, 'main', { locale });
          const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');
          detail.timelineSections.forEach(validateLogicalDetailSection);
        }
        const conflict = structuredClone(rows);
        conflict[1].message.content = conflict[1].message.content.replace('</task-notification>', '<status>failed</status></task-notification>');
        assert.equal(project([...pair(name), ...conflict]).event.status, 'in_progress');
        const differentTail = structuredClone(rows);
        differentTail[1].message.content = differentTail[1].message.content.replace(name === 'Monitor' ? '</event>' : '</result>', name === 'Monitor' ? 'tail</event>' : 'tail</result>');
        assert.equal(project([...pair(name), ...differentTail]).event.status, 'in_progress');
        assert.equal(project([...pair(name), ...rows, structuredClone(rows[1])]).event.status, 'in_progress');
      }
    }
    const excessive = notification({ monitor: name === 'Monitor', id: name === 'Monitor' ? 'call' : '', result: 'x'.repeat(2_048_001) });
    assert.equal(project([...pair(name), ...excessive]).event.status, 'in_progress');
  }
});

test('Monitor progress and textual deadline alerts do not fabricate a terminal or human message', () => {
  const event = '<task-notification><task-id>ksynthetic</task-id><summary>Monitor event: "Synthetic watch"</summary><event>[Monitor timed out — re-arm if needed.]</event></task-notification>';
  const f = project([...pair('Monitor'), { type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { content: event } }]);
  assert.equal(f.event.status, 'in_progress');
  assert.equal(f.protocols.length, 1);
  assert.equal(f.session.logicalEvents.filter(e => e.kind === 'user_message').length, 0);
});

test('Monitor progress payload tags cannot suppress a later success or failure', () => {
  for (const output of ['<status>working</status>', '<tool-use-id>log-call</tool-use-id>',
    'literal <status> without a closing tag', '<log><status>failed</status></log>']) {
    for (const [status, expected] of [['completed', 'success'], ['failed', 'failed']]) {
      const text = `<task-notification><task-id>ksynthetic</task-id><summary>Monitor event</summary><event>${output}</event></task-notification>`;
      const progress = [
        { type: 'queue-operation', operation: 'enqueue', content: text },
        { type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { content: text } },
      ];
      const f = project([...pair('Monitor'), ...progress, ...notification({ id: 'call', monitor: true, status })]);
      assert.equal(f.event.status, expected, output);
      assert.equal(f.event.lifecycle.terminal.result, 'Synthetic final output');
      assert.equal(f.event.rawRefs.length, 4);
      assert.equal(f.protocols.length, 2);
      assert.ok(f.protocols.every(e => e.searchText.includes(output)));
      assert.equal(f.session.logicalEvents.filter(e => e.kind === 'user_message').length, 0);
    }
  }
});

test('Monitor malformed outer terminal fields still invalidate otherwise valid completion', () => {
  for (const fields of ['<status>failed</status>', '<tool-use-id>wrong-call</tool-use-id>',
    '<status>failed', '<status>completed</status><status>failed</status>']) {
    // Fields after the event must still be considered; do not discard the
    // whole remainder of a notification at the first <event> opening.
    const text = `<task-notification><task-id>ksynthetic</task-id><summary>Malformed terminal</summary><event>output</event>${fields}</task-notification>`;
    const f = project([...pair('Monitor'),
      { type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { content: text } },
      ...notification({ id: 'call', monitor: true }),
    ]);
    assert.equal(f.event.status, 'in_progress');
    assert.equal(f.event.rawRefs.length, 2);
    assert.equal(f.protocols.length, 3);
  }
});

test('Monitor rejects contradictory receipts and terminal identity, duplicates and conflicts', () => {
  for (const mutate of [r => { r[1].toolUseResult.persistent = true; }, r => { r[1].toolUseResult.timeoutMs = -1; },
    r => { r[1].toolUseResult.timeoutMs = 4000; }, r => { r[1].message.content[0].is_error = true; }]) {
    const records = pair('Monitor'); mutate(records);
    assert.equal(project(records).event.lifecycle, undefined);
  }
  for (const tail of [notification({ monitor: true }), notification({ id: 'other', monitor: true }),
    [...notification({ id: 'call', monitor: true }), ...notification({ id: 'call', monitor: true })],
    [...notification({ id: 'call', monitor: true }), ...notification({ id: 'call', monitor: true, status: 'failed' })]]) {
    assert.equal(project([...pair('Monitor'), ...tail]).event.status, 'in_progress');
  }
});

test('auto-mode hand-back remains a tool result, including provenance text and classifier boundary', () => {
  const records = pair('Agent');
  records[1].classifierBoundary = true;
  records[1].toolUseResult = { status: 'completed', agentId: 'synthetic-agent', content: [{ type: 'text', text: 'SYNTHETIC_HAND_BACK' }] };
  records[1].message.content[0].content = '[Subagent hand-back] Synthetic model output, not user authority.\n  SYNTHETIC_HAND_BACK';
  const f = project(records);
  assert.equal(f.event.kind, 'agent_coordination');
  assert.equal(f.event.status, 'success');
  assert.equal(f.session.logicalEvents.filter(e => e.kind === 'user_message').length, 0);
  assert.match(JSON.stringify(buildClaudeEventDetail(f.session, f.event.id, 'main')), /SYNTHETIC_HAND_BACK/);
});

test('MCP and Monitor terminal append invalidates reindex and survives source-backed materialization', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { buildClaudeIndex, buildClaudeSourceBackedIndex } = require('../src/claude');
  const { materializeSessionForIndex } = require('../src/source-adapters');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-background-reindex-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  const container = path.join(home, 'projects', '-synthetic');
  await fs.mkdir(repoRoot);
  await fs.mkdir(container, { recursive: true });
  for (const name of ['mcp__synthetic__delay', 'Monitor']) {
    const file = path.join(container, `${name}.jsonl`);
    const records = pair(name);
    const write = () => fs.writeFile(file, records.map((r, i) => JSON.stringify({
      uuid: `row-${i}`, ...r, sessionId: name, cwd: repoRoot, version: '2.1.283',
    })).join('\n') + '\n');
    await write();
    const before = await buildClaudeIndex({ claudeHome: home, repoRoot });
    const sessionId = `claude-code:${name}`;
    assert.equal(before.sessionsById.get(sessionId).logicalEvents.find(e => e.callId).status, 'in_progress');
    records.push(...notification({ id: name === 'Monitor' ? 'call' : '', monitor: name === 'Monitor', status: 'failed', result: 'x'.repeat(20_000) })
      .map(r => JSON.parse(JSON.stringify(r).replace('Synthetic terminal', 's'.repeat(6000)))));
    await write();
    const after = await buildClaudeIndex({ claudeHome: home, repoRoot, previousIndex: before });
    const cold = await buildClaudeSourceBackedIndex({ claudeHome: home, repoRoot });
    const materialized = await materializeSessionForIndex(cold, cold.sessionsById.get(sessionId));
    for (const session of [after.sessionsById.get(sessionId), materialized]) {
      const event = session.logicalEvents.find(e => e.callId);
      assert.equal(event.status, 'failed');
      assert.equal(event.rawRefs.length, 4);
      assert.equal(session.counts.userMessages, 0);
    }
  }
});
