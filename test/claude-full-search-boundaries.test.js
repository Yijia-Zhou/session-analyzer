'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../src/claude-source');
const { createClaudeLogicalBuilder } = require('../src/claude-logical');

function project(records) {
  const raws = records.map((record, index) => source.makeClaudeRawEvent({ sessionId: 'full-search',
    uuid: `row-${index}`, version: '2.1.283', ...record }, index + 1, 'synthetic.jsonl',
  'claude-code:full-search', 'full-search'));
  return { raws, events: createClaudeLogicalBuilder({ ...source, rawRef: source.claudeRawRef }).buildLogicalEvents(raws) };
}

for (const role of ['user', 'assistant']) {
  test(`Claude ${role} text after a display-sized whitespace prefix remains Main`, () => {
    const f = project([{ type: role, message: { content: [{ type: 'text', text: ' '.repeat(17000) + 'LATE_VISIBLE' }] } }]);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].layer, 'main');
    assert.match(f.events[0].searchText, /LATE_VISIBLE/);
    assert.match(f.raws[0].searchText, /LATE_VISIBLE/);
  });
}

test('Claude unknown Protocol stays searchable while opaque reasoning and signatures stay excluded', () => {
  const blocks = [{ type: 'redacted_thinking', data: 'x'.repeat(17000) + 'SECRET_OPAQUE' },
    { type: 'unknown_extension', text: 'x'.repeat(17000) + 'VISIBLE_EXTENSION',
      encrypted_content: 'SECRET_ENCRYPTED', signature: 'SECRET_SIGNATURE',
      nested: { type: 'redacted_thinking', data: 'SECRET_NESTED' } }];
  const f = project([{ type: 'assistant', message: { content: blocks } }]);
  assert.equal(f.events.length, 2);
  assert.ok(f.events.every(event => event.layer === 'protocol'));
  assert.match(f.events[1].searchText, /VISIBLE_EXTENSION/);
  for (const event of f.events) assert.doesNotMatch(event.searchText, /SECRET_/);
  assert.doesNotMatch(source.stringifySearchValue(blocks), /SECRET_/);
});

for (const monitor of [false, true]) {
  test(`Claude admitted ${monitor ? 'Monitor' : 'MCP'} terminal searches full text with bounded Detail facts`, () => {
    const task = 'ksynthetic';
    const name = monitor ? 'Monitor' : 'mcp__synthetic__delay';
    const receipt = `MCP tool "synthetic/delay" is still running after 1s. It was moved to the background as task ${task} and keeps running; you'll receive a notification with the result when it completes. You can keep working in the meantime. To stop it, use TaskStop with task_id "${task}". Note: it does not survive exiting this session.`;
    const content = [{ type: 'text', text: receipt }];
    const notice = `<task-notification><task-id>${task}</task-id>${monitor ? '<tool-use-id>call</tool-use-id>' : ''}<status>completed</status><summary>${'s'.repeat(5000)}SUMMARY_TAIL</summary><${monitor ? 'event' : 'result'}>${'r'.repeat(17000)}RESULT_TAIL</${monitor ? 'event' : 'result'}></task-notification>`;
    const f = project([
      { type: 'assistant', uuid: 'call-uuid', message: { content: [{ type: 'tool_use', id: 'call', name,
        input: monitor ? { command: 'watch', timeout_ms: 3000, persistent: false } : {} }] } },
      { type: 'user', sourceToolAssistantUUID: 'call-uuid', message: { content: [{ type: 'tool_result',
        tool_use_id: 'call', content: monitor ? 'Monitor started' : content }] },
      toolUseResult: monitor ? { taskId: task, timeoutMs: 3000, persistent: false } : structuredClone(content) },
      { type: 'queue-operation', operation: 'enqueue', content: notice },
      { type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { content: notice } },
    ]);
    assert.equal(f.events.length, 1);
    const event = f.events[0];
    assert.equal(event.status, 'success');
    assert.equal(event.rawRefs.length, 4);
    assert.match(event.searchText, /SUMMARY_TAIL/);
    assert.match(event.searchText, /RESULT_TAIL/);
    assert.ok(event.lifecycle.terminal.summary.length <= 4000);
    assert.ok(event.lifecycle.terminal.result.length <= 16000);
    assert.equal(Object.hasOwn(event.lifecycle, 'notificationSearchText'), false);
  });
}
