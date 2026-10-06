'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detailText, createHistoryPresentation } = require('../src/history-presentation');

test('text projection preserves stdout/stderr, labels and separate titled facts', () => {
  const output = detailText([
    { type: 'terminal', purpose: 'result', title: 'Stdout', stream: 'stdout', text: 'same' },
    { type: 'terminal', purpose: 'result', title: 'Stderr', stream: 'stderr', text: 'same' },
    { type: 'notice', purpose: 'result', title: 'Before', level: 'warning', text: 'pending' },
    { type: 'notice', purpose: 'result', title: 'After', level: 'info', text: 'pending' },
  ]);
  assert.match(output, /\[Stdout; stream=stdout\]\nsame/u);
  assert.match(output, /\[Stderr; stream=stderr\]\nsame/u);
  assert.match(output, /Before; level=warning/u);
  assert.match(output, /After; level=info/u);
  assert.equal(output.match(/same/gu).length, 2);
});

test('only identical sections and explicit equal-payload summary pairs are folded', () => {
  const full = { type: 'code', purpose: 'result', title: 'Response', code: 'complete output' };
  const output = detailText([{ ...full, title: 'Response summary' }, full, full,
    { ...full, title: 'Response summary', code: 'different summary' },
    { type: 'markdown', purpose: 'content', title: 'Message', html: '<p>original</p>' }]);
  assert.equal(output.match(/complete output/gu).length, 1);
  assert.match(output, /different summary/u);
  assert.match(output, /"type":"markdown"/u);
  assert.match(output, /<p>original<\/p>/u);
});

test('compact references never rewrite historical strings, even when they look like refs', () => {
  const p = createHistoryPresentation('hc1.test');
  const r = p.project({ operation: 'history.search', items: [{ ref: 'er2.real', excerpt: { text: 'er2.real' } }] }, { presentation: 'compact' });
  assert.match(r.items[0].ref, /^hr1\./u);
  assert.equal(r.items[0].excerpt.text, 'er2.real');
  assert.equal(p.resolve(r.items[0].ref, 'hc1.test'), 'er2.real');
});
