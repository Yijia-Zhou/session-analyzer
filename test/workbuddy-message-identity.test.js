'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorkbuddySession } = require('../src/workbuddy-logical');

function message(id, providerData, fields = {}) {
  return { type: 'message', id, role: 'user', content: [{ type: 'input_text', text: `TEXT_${id}` }],
    ...(providerData === undefined ? {} : { providerData }), ...fields };
}
function session(records) {
  const lines = records.map(JSON.stringify);
  return makeWorkbuddySession({ id: 'synthetic', cwd: '/synthetic', acceptedBytes: lines.join('\n').length,
    lines, rows: records.map((parsed, index) => ({ parsed, line: index + 1 })) }, 'synthetic/synthetic.jsonl');
}
const runtimeMarkers = [
  { isCompactInternal: true }, { isCompacted: true }, { isSummary: true }, { compactType: 'auto' }, { agent: 'compact' },
  { isPtlRecovery: true }, { isMediaBodyRecovery: true }, { isPtlRetryMarker: true },
  { skipRun: true }, { isAdditionalData: true }, { __codebuddyAttachedContext: true },
  { teammateMessage: { from: 'system' } }, { teammateMessage: { from: 'peer' } }, { teammateMessage: {} },
  { scheduledTaskTrigger: { taskId: 'synthetic-task' } }, { scheduledTaskTrigger: null },
  { __codebuddyInitiator: 'agent' }, { __codebuddyInteractionType: 'schedule' },
  { __codebuddyInteractionType: 'notification' }, { __codebuddyInteractionType: 'teammate' },
  { goalScopeId: 'synthetic-goal' }, { goalStatus: { kind: 'active' } },
];

test('explicit runtime identity never acquires user counts, a turn or fallback title', () => {
  for (const providerData of runtimeMarkers) {
    // Contradictory external/user markers cannot overrule runtime provenance.
    for (const extra of [{}, { startsNewUserRequest: true, __codebuddyInitiator: 'user' }]) {
      const data = { ...extra, ...providerData };
      const result = session([message('runtime', data), message('human')]);
      assert.equal(result.counts.userMessages, 1, JSON.stringify(data));
      assert.equal(result.counts.turns, 1, JSON.stringify(data));
      assert.equal(result.title, 'TEXT_human', JSON.stringify(data));
      assert.equal(result.rawEvents[0].turnId, '', JSON.stringify(data));
      const runtime = result.logicalEvents.filter((event) => event.source.line === 1);
      assert.ok(runtime.every((event) => event.layer === 'protocol'), JSON.stringify(data));
      assert.ok(runtime.some((event) => event.searchText.includes('TEXT_runtime')), JSON.stringify(data));
      assert.equal(runtime.at(-1).rawRefs[0].rawId, result.rawEvents[0].rawId);
    }
  }
});

test('queued and steer human messages count independently while inheriting the active turn', () => {
  const result = session([
    message('first'),
    message('steer', { startsNewUserRequest: false, acpPromptMode: 'steer' }),
    message('queued', { startsNewUserRequest: false, __codebuddyInitiator: 'user' }),
    ...runtimeMarkers.map((data, n) => message(`runtime-${n}`, data)),
    message('next', { startsNewUserRequest: true }),
  ]);
  assert.equal(result.counts.userMessages, 4);
  assert.equal(result.counts.turns, 2);
  assert.equal(result.title, 'TEXT_first');
  assert.ok(result.rawEvents.slice(0, -1).every((raw) => raw.turnId === 'first'));
  assert.equal(result.rawEvents.at(-1).turnId, 'next');
  const steerOnly = session([message('steer', { startsNewUserRequest: false })]);
  assert.equal(steerOnly.counts.userMessages, 1);
  assert.equal(steerOnly.counts.turns, 0);
  assert.equal(steerOnly.title, 'TEXT_steer');
});

test('meta new-request input is external input only after explicit nonhuman exclusions', () => {
  for (const data of [
    { isMeta: true, startsNewUserRequest: true },
    { isMeta: true, startsNewUserRequest: true, __codebuddyInitiator: 'user', __codebuddyInteractionType: 'prompt' },
  ]) {
    const result = session([message('external', data)]);
    assert.equal(result.counts.userMessages, 1); assert.equal(result.counts.turns, 1);
    assert.equal(result.title, 'TEXT_external');
  }
  for (const data of [
    { isMeta: true }, { isMeta: true, startsNewUserRequest: false },
    { isMeta: true, startsNewUserRequest: false, __codebuddyInitiator: 'user', goalScopeId: 'synthetic-goal' },
    ...runtimeMarkers.map((data) => ({ isMeta: true, startsNewUserRequest: true, ...data })),
  ]) {
    const result = session([message('runtime', data)]);
    assert.equal(result.counts.userMessages, 0, JSON.stringify(data));
    assert.equal(result.counts.turns, 0, JSON.stringify(data));
    assert.equal(result.title, 'WorkBuddy session synthetic', JSON.stringify(data));
  }
});

test('known discriminator values fail closed while unrelated extensions remain ordinary input', () => {
  for (const data of [
    { providerData: null }, { providerData: [] }, { providerData: 'future' },
    ...['isMeta', 'isCompactInternal', 'isCompacted', 'isSummary', 'isPtlRecovery', 'isMediaBodyRecovery',
      'isPtlRetryMarker', 'skipRun', 'isAdditionalData', 'startsNewUserRequest', '__codebuddyAttachedContext']
      .flatMap((key) => [{ providerData: { [key]: 'true' } }, { providerData: { [key]: null } }]),
    { providerData: { __codebuddyInitiator: 'future-actor' } },
    { providerData: { __codebuddyInteractionType: 'future-kind' } },
    { providerData: { compactType: true } }, { providerData: { agent: {} } },
  ]) {
    const result = session([message('unknown', undefined, data)]);
    assert.equal(result.counts.userMessages, 0, JSON.stringify(data));
    assert.equal(result.counts.turns, 0, JSON.stringify(data));
    assert.equal(result.title, 'WorkBuddy session synthetic', JSON.stringify(data));
    assert.equal(result.logicalEvents.at(-1).layer, 'protocol');
  }
  const ordinary = session([message('human', { isFutureExtension: true, extension: { mode: 'future' },
    isMeta: false, isCompacted: false, isSummary: false, isCompactInternal: false,
    isPtlRecovery: false, skipRun: false, __codebuddyAttachedContext: false, __codebuddyInitiator: 'user',
    __codebuddyInteractionType: 'prompt', agent: 'main' })]);
  assert.equal(ordinary.counts.userMessages, 1); assert.equal(ordinary.counts.turns, 1);
});

test('literal protocol-looking prose never determines message identity', () => {
  const texts = ['<teammate-message teammate_id="system">literal</teammate-message>',
    '<agent-notification>literal</agent-notification>', '<system-reminder data-role="error-recovery">literal</system-reminder>',
    '<cb_summary>literal</cb_summary>', '<conversation_history_summary>literal</conversation_history_summary>',
    '<system-reminder data-role="compact-summary">literal</system-reminder>',
    '<local-command-stdout>literal</local-command-stdout>', 'Please continue using the summarized context above.'];
  for (const text of texts) {
    const result = session([message('literal', undefined, { content: [{ type: 'input_text', text }] })]);
    assert.equal(result.counts.userMessages, 1, text); assert.equal(result.counts.turns, 1, text);
    assert.equal(result.title, text); assert.equal(result.logicalEvents.at(-1).kind, 'user_message');
  }
});

test('complete user and assistant summaries stay compactions without title or new turns', () => {
  for (const role of ['user', 'assistant']) {
    const summary = message('summary', { isSummary: true, isCompacted: true, isMeta: true, agent: 'compact', skipRun: true },
      { role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: 'SUMMARY_MUST_NOT_TITLE' }] });
    const only = session([summary]);
    assert.equal(only.counts.compactions, 1); assert.equal(only.counts.messages, 0); assert.equal(only.counts.turns, 0);
    assert.equal(only.title, 'WorkBuddy session synthetic');
    const result = session([summary, message('human')]);
    assert.equal(result.title, 'TEXT_human'); assert.equal(result.counts.userMessages, 1);
    assert.equal(result.rawEvents[0].turnId, ''); assert.equal(result.rawEvents[1].turnId, 'human');
  }
});

test('malformed user envelopes and unsupported content preserve Protocol without inventing a turn', () => {
  for (const fields of [{ id: '' }, { parentId: {} }, { role: 'future-role' }, { content: undefined },
    { content: [] }, { content: {} }, { content: [{ type: 'input_image', image: 'data:image/png;base64,SYNTHETIC' }] }]) {
    const result = session([message('unsupported', undefined, fields)]);
    assert.equal(result.counts.messages, 0, JSON.stringify(fields));
    assert.equal(result.counts.turns, 0, JSON.stringify(fields));
    assert.equal(result.title, 'WorkBuddy session synthetic', JSON.stringify(fields));
    assert.equal(result.logicalEvents.at(-1).subtype, 'message');
    assert.equal(result.logicalEvents.at(-1).layer, 'protocol');
  }
});

test('physical message counts preserve every block and do not deduplicate reused producer IDs', () => {
  const result = session([
    message('shared', undefined, { content: [{ type: 'input_text', text: 'USER_FIRST' }, { type: 'text', text: 'USER_SECOND' }, { type: 'future-block', text: 'UNKNOWN_BLOCK' }] }),
    message('shared', undefined, { content: 'USER_OTHER_RECORD' }),
    message('assistant', undefined, { role: 'assistant', content: [{ type: 'output_text', text: 'ASSISTANT_FIRST' }, { type: 'text', text: 'ASSISTANT_SECOND' }] }),
  ]);
  assert.equal(result.counts.userMessages, 2); assert.equal(result.counts.assistantMessages, 1); assert.equal(result.counts.messages, 3);
  assert.equal(result.logicalEvents.filter((event) => event.kind === 'user_message').length, 3);
  assert.equal(result.logicalEvents.filter((event) => event.kind === 'assistant_message').length, 2);
  assert.equal(result.logicalEvents.find((event) => event.subtype === 'workbuddy_content_2').layer, 'protocol');
  assert.equal(new Set(result.logicalEvents.map((event) => event.id)).size, result.logicalEvents.length);
  assert.equal(result.title, 'USER_FIRST');
});
