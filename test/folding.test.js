'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const folding = require('../public/folding');
const { foldingProfiles } = require('../src/folding');

function profileRules(id) {
  return foldingProfiles.find((profile) => profile.id === id).rules;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('display states have a fixed most-visible priority', () => {
  assert.deepEqual(folding.DISPLAY_STATE_PRIORITY, {
    hidden: 0,
    collapsed: 1,
    summary: 2,
    expanded: 3,
  });
  const event = { kind: 'patch', touchedFiles: ['public/app.js'], severity: 'normal' };
  assert.equal(folding.displayStateFromRules(event, {
    kindStates: { patch: 'collapsed' },
    fallback: 'hidden',
    conditions: [{ id: 'touchedFiles', state: 'summary' }, { id: 'importantEvent', state: 'expanded' }],
  }), 'expanded');
});

test('changes profile keeps successful and failed patches with files expanded', () => {
  const rules = profileRules('changes');
  assert.equal(folding.displayStateFromRules({ kind: 'patch', status: 'success', touchedFiles: ['a.js'], severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'patch', status: 'failed', touchedFiles: ['a.js'], severity: 'normal' }, rules), 'expanded');
});

test('changes profile summarizes ordinary touched-file events', () => {
  assert.equal(folding.displayStateFromRules({
    kind: 'tool_operation',
    touchedFiles: ['a.js'],
    severity: 'normal',
  }, profileRules('changes')), 'summary');
});

test('changes profile summarizes failed events even without touched files', () => {
  assert.equal(folding.displayStateFromRules({
    kind: 'mcp',
    status: 'failed',
    severity: 'normal',
  }, profileRules('changes')), 'summary');
});

test('narrative profile collapses ordinary high-frequency tool events', () => {
  const rules = profileRules('narrative');
  for (const kind of ['command', 'mcp', 'js_repl', 'tool_operation', 'web_search']) {
    assert.equal(folding.displayStateFromRules({ kind, status: 'success', severity: 'normal' }, rules), 'collapsed', kind);
  }
});

test('matching condition order does not change the most visible result', () => {
  const event = { kind: 'tool_operation', hasSearchHit: true, severity: 'error' };
  const conditions = [
    { id: 'searchHit', state: 'expanded' },
    { id: 'importantEvent', state: 'summary' },
  ];
  const rules = { kindStates: {}, fallback: 'hidden', conditions };
  assert.equal(folding.displayStateFromRules(event, rules), 'expanded');
  assert.equal(folding.displayStateFromRules(event, { ...rules, conditions: [...conditions].reverse() }), 'expanded');
});

test('fallback applies only when neither a kind nor condition rule matches', () => {
  const rules = {
    kindStates: { command: 'collapsed' },
    fallback: 'hidden',
    conditions: [{ id: 'failedStatus', state: 'expanded' }],
  };
  assert.equal(folding.displayStateFromRules({ kind: 'command', status: 'success' }, rules), 'collapsed');
  assert.equal(folding.displayStateFromRules({ kind: 'command', status: 'failed' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'reasoning', status: 'success' }, rules), 'hidden');
});

test('rule normalization rejects invalid conditions and stabilizes duplicates', () => {
  assert.deepEqual(plain(folding.normalizeRules({
    kindStates: { patch: 'expanded', bad: 'invalid' },
    fallback: 'invalid',
    conditions: [
      { id: 'failedStatus', state: 'summary' },
      { id: 'unknown', state: 'expanded' },
      { id: 'searchHit', state: 'collapsed' },
      { id: 'failedStatus', state: 'expanded' },
      { id: 'searchHit', state: 'summary' },
    ],
  })), {
    kindStates: { patch: 'expanded' },
    fallback: 'summary',
    conditions: [
      { id: 'searchHit', state: 'summary' },
      { id: 'failedStatus', state: 'expanded' },
    ],
  });
});

test('planning condition matches update_plan calls and protocol plan updates', () => {
  assert.equal(folding.conditionMatches('updatePlanCall', { kind: 'tool_operation', toolName: 'update_plan' }), true);
  assert.equal(folding.conditionMatches('updatePlanCall', { kind: 'plan_update' }), true);
  assert.equal(folding.displayStateFromRules({ kind: 'plan_update', severity: 'normal' }, profileRules('planning')), 'expanded');
});

test('conversation profile keeps plan updates and user input requests expanded', () => {
  const rules = profileRules('conversation');
  assert.equal(folding.displayStateFromRules({ kind: 'tool_operation', toolName: 'update_plan', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'tool_operation', toolName: 'request_user_input', severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'reasoning', hasReadableReasoning: true, severity: 'normal' }, rules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'reasoning', hasReadableReasoning: false, severity: 'normal' }, rules), 'hidden');
  assert.equal(folding.displayStateFromRules({ kind: 'tool_operation', toolName: 'view_image', severity: 'normal' }, rules), 'hidden');
});

test('override normalization drops malformed branches and retains valid manual states', () => {
  assert.deepEqual(plain(folding.normalizeOverrides({
    sessionA: { event1: 'expanded', event2: 'invalid', event3: 'collapsed' },
    sessionB: 'malformed',
    sessionC: null,
  })), {
    sessionA: { event1: 'expanded', event3: 'collapsed' },
  });
  assert.deepEqual(plain(folding.normalizeOverrides('malformed')), {});
});

test('server built-in profiles normalize through the shared module', () => {
  for (const profile of foldingProfiles) {
    assert.deepEqual(profile.rules, folding.normalizeRules(profile.rules), profile.id);
  }
});

test('reserved object keys remain ordinary folding keys without prototype inheritance', () => {
  const fallbackRules = { kindStates: {}, fallback: 'hidden' };
  for (const kind of ['toString', 'constructor', '__proto__']) {
    assert.equal(folding.displayStateFromRules({ kind, severity: 'normal' }, fallbackRules), 'hidden');
  }

  const explicitRules = folding.normalizeRules({
    kindStates: JSON.parse('{"__proto__":"expanded","constructor":"summary"}'),
    fallback: 'hidden',
  });
  assert.equal(folding.displayStateFromRules({ kind: '__proto__', severity: 'normal' }, explicitRules), 'expanded');
  assert.equal(folding.displayStateFromRules({ kind: 'constructor', severity: 'normal' }, explicitRules), 'summary');

  const overrides = folding.normalizeOverrides(JSON.parse('{"__proto__":{"event":"expanded"},"session":{"__proto__":"collapsed"}}'));
  assert.equal(Object.getPrototypeOf(overrides), null);
  assert.equal(Object.getPrototypeOf(overrides.session), null);
  assert.equal(overrides.__proto__.event, 'expanded');
  assert.equal(overrides.session.__proto__, 'collapsed');
  overrides.session.event = 'summary';
  assert.equal(overrides.session.event, 'summary');
});
