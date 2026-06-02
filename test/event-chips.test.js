'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectorChipValues, rawRefsSubtitle } = require('../public/event-chips');

test('inspector chips omit generic protocol kind while retaining useful event state', () => {
  assert.deepEqual(inspectorChipValues({ kind: 'protocol', status: 'completed', severity: 'warning' }), ['', 'completed', 'warning']);
  assert.deepEqual(inspectorChipValues({ kind: 'command', status: 'failed', severity: 'normal' }), ['command', 'failed', '']);
  assert.deepEqual(inspectorChipValues({ kind: 'protocol', status: '', severity: 'normal' }).filter(Boolean), []);
});

test('raw refs subtitle omits redundant event layer and generic kind labels', () => {
  assert.equal(rawRefsSubtitle({ label: 'AGENTS.md instructions', kind: 'protocol', layer: 'protocol' }), 'AGENTS.md instructions');
  assert.equal(rawRefsSubtitle({ label: 'Shell command', kind: 'command', layer: 'main' }), 'Shell command');
});
