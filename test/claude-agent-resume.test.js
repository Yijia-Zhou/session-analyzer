'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../src/claude-source');
const { createClaudeLogicalBuilder } = require('../src/claude-logical');
const { buildClaudeEventDetail } = require('../src/claude-detail');

// Synthetic 2.1.283 SendMessage resume receipt and trusted task notifications.
const AGENT = 'synthetic-agent';

function pair(id, resume = false) {
  return [
    { type: 'assistant', message: { content: [{
      type: 'tool_use', id, name: resume ? 'SendMessage' : 'Agent',
      input: resume ? { to: AGENT, summary: 'Read another line', message: 'Continue the synthetic task' }
        : { prompt: 'Read a synthetic line', run_in_background: true },
    }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Receipt' }] },
      toolUseResult: resume ? {
        success: true, message: 'Resuming synthetic agent', resumedAgentId: AGENT,
        pin: { id: AGENT, name: AGENT, ref: 'synthetic-reference' },
      } : { isAsync: true, status: 'async_launched', agentId: AGENT },
    },
  ];
}

function notification(id, status = 'completed', taskId = AGENT) {
  return {
    type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system',
    message: { content: `<task-notification><task-id>${taskId}</task-id><tool-use-id>${id}</tool-use-id><status>${status}</status><summary>Synthetic ${id} ${status}</summary><result>Result ${id}</result></task-notification>` },
  };
}

function project(records) {
  const rawEvents = records.map((record, index) => source.makeClaudeRawEvent({
    version: '2.1.283', sessionId: 'synthetic-resume', uuid: `row-${index}`,
    parentUuid: index ? `row-${index - 1}` : null, ...record,
  }, index + 1, 'synthetic-resume.jsonl', 'claude-code:synthetic-resume', 'synthetic-resume'));
  const builder = createClaudeLogicalBuilder({ ...source, rawRef: source.claudeRawRef });
  const session = { rawEvents, logicalEvents: builder.buildLogicalEvents(rawEvents) };
  return {
    session,
    event: (id) => session.logicalEvents.find((event) => event.callId === id),
    detail: (id, locale = 'en') => buildClaudeEventDetail(session,
      session.logicalEvents.find((event) => event.callId === id).id, 'main', { locale }),
  };
}

test('sequential SendMessage resumes retain independent lifecycles on a shared task ID', () => {
  const fixture = project([
    ...pair('launch'), notification('launch'),
    ...pair('resume-one', true), notification('resume-one', 'failed'),
    ...pair('resume-two', true), notification('resume-two'),
  ]);
  assert.equal(fixture.session.logicalEvents.length, 3);
  for (const [id, status] of [['launch', 'success'], ['resume-one', 'failed'], ['resume-two', 'success']]) {
    const event = fixture.event(id);
    assert.equal(event.kind, 'agent_coordination');
    assert.equal(event.agentId, AGENT);
    assert.equal(event.status, status);
    assert.equal(event.lifecycle.kind, 'async_agent');
    assert.equal(event.lifecycle.notifications.length, 1);
    assert.match(event.lifecycle.terminal.summary, new RegExp(id));
    assert.equal(event.rawRefs.length, 3);
    assert.equal(event.lifecycle.phase, 'terminal');
    assert.ok(event.rawRefs.every((ref) => ref.sourceLocator.type === 'jsonl_line'));
  }
  assert.equal(fixture.event('resume-one').preview, 'Read another line');
  assert.match(JSON.stringify(fixture.detail('resume-one').inspectorSections), /resumed/);
  assert.match(JSON.stringify(fixture.detail('resume-one', 'zh-CN').inspectorSections), /已恢复/);
});

test('a resume receipt stays in progress until its own later exact completion', () => {
  const fixture = project([
    ...pair('launch'), notification('launch'), ...pair('resume', true),
    notification('launch'), notification('wrong-call'), notification('resume', 'completed', 'wrong-agent'),
  ]);
  assert.equal(fixture.event('launch').status, 'success');
  assert.equal(fixture.event('resume').status, 'in_progress');
  assert.equal(fixture.event('resume').rawRefs.length, 2);
  assert.equal(fixture.session.logicalEvents.filter((event) => event.layer === 'protocol').length, 2);
});

test('premature, untrusted and malformed resume notifications remain independently visible', () => {
  const resume = pair('resume', true);
  const human = notification('resume');
  delete human.origin;
  delete human.promptSource;
  const malformed = notification('resume');
  malformed.message.content = malformed.message.content.replace('<summary>', '<summary><summary>');
  const fixture = project([resume[0], notification('resume'), resume[1], human, malformed]);
  assert.equal(fixture.event('resume').status, 'in_progress');
  assert.equal(fixture.event('resume').rawRefs.length, 2);
  assert.equal(fixture.session.logicalEvents.length, 4);
});

test('duplicate ordinary launches remain ambiguous even when a SendMessage resume is present', () => {
  const fixture = project([
    ...pair('launch-one'), notification('launch-one'),
    ...pair('launch-two'), notification('launch-two'),
    ...pair('resume', true), notification('resume'),
  ]);
  for (const id of ['launch-one', 'launch-two', 'resume']) {
    assert.equal(fixture.event(id).status, 'in_progress');
    assert.equal(fixture.event(id).rawRefs.length, 2);
  }
  assert.equal(fixture.session.logicalEvents.filter((event) => event.layer === 'protocol').length, 3);
});

test('delivery-only SendMessage stays a successful coordination operation without inventing a resume', () => {
  const records = pair('delivery', true);
  records[1].toolUseResult = { success: true, message: 'Message delivered' };
  const fixture = project(records);
  assert.equal(fixture.event('delivery').kind, 'agent_coordination');
  assert.equal(fixture.event('delivery').status, 'success');
  assert.equal(fixture.event('delivery').agentId, undefined);
  assert.equal(fixture.event('delivery').lifecycle, undefined);
});

test('unproven targets, contradictory receipts and failed or declined results never resume', () => {
  const mutations = [
    (records) => { records[1].toolUseResult.success = false; },
    (records) => { records[1].toolUseResult.resumedAgentId = 'wrong-agent'; },
    (records) => { records[0].message.content[0].input.to = ''; },
    (records) => { records[0].message.content[0].input.to = ` ${AGENT}`; },
    (records) => { records[0].message.content[0].input.recipient = 'conflicting-alias'; },
    (records) => { delete records[0].message.content[0].input.to; records[0].message.content[0].input.recipient = AGENT; },
    (records) => { records[1].toolUseResult.pin.id = 'conflicting-pin'; },
    (records) => { records[1].message.content[0].is_error = true; },
    (records) => { records[1].toolDenialKind = 'permission_denied'; },
  ];
  for (const mutate of mutations) {
    const records = pair('resume', true);
    mutate(records);
    const fixture = project([...records, notification('resume')]);
    assert.equal(fixture.event('resume').lifecycle, undefined);
    assert.equal(fixture.event('resume').agentId, undefined);
    assert.equal(fixture.event('resume').rawRefs.length, 2);
    assert.ok(fixture.session.logicalEvents.some((event) => event.layer === 'protocol'));
  }
});

test('batched result rows, duplicate calls and duplicate receipts cannot own resume evidence', () => {
  const batched = pair('resume', true);
  batched[0].message.content.push({ ...batched[0].message.content[0], id: 'sibling' });
  batched[1].message.content.push({ ...batched[1].message.content[0], tool_use_id: 'sibling' });
  const duplicateCalls = pair('resume', true);
  duplicateCalls[0].message.content.push(structuredClone(duplicateCalls[0].message.content[0]));
  const duplicateResults = pair('resume', true);
  duplicateResults.push(structuredClone(duplicateResults[1]));
  for (const records of [batched, duplicateCalls, duplicateResults, pair('resume', true).reverse()]) {
    const fixture = project([...records, notification('resume')]);
    for (const event of fixture.session.logicalEvents.filter((candidate) => candidate.callId)) {
      assert.equal(event.lifecycle, undefined);
      assert.equal(event.agentId, undefined);
    }
  }
});

test('exact queue/user mirrors fold into one resume stop while preserving both source rows', () => {
  const delivered = notification('resume');
  const queued = { type: 'queue-operation', operation: 'enqueue', content: delivered.message.content };
  const fixture = project([...pair('resume', true), queued, delivered]);
  const event = fixture.event('resume');
  assert.equal(event.status, 'success');
  assert.equal(event.lifecycle.notifications.length, 1);
  assert.equal(event.rawRefs.length, 4);
});
