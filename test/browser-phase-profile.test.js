'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { measurePhase } = require('../e2e/browser-profile');

function setProfiling(t, enabled) {
  const previous = process.env.BROWSER_TEST_PHASES;
  t.after(() => {
    if (previous === undefined) delete process.env.BROWSER_TEST_PHASES;
    else process.env.BROWSER_TEST_PHASES = previous;
  });
  process.env.BROWSER_TEST_PHASES = enabled ? '1' : '0';
}

test('disabled browser phase profiling preserves immediate values, promise identity and errors', async (t) => {
  setProfiling(t, false);
  const context = { diagnostic: () => assert.fail('disabled profiling must not emit') };
  const value = {};
  assert.equal(measurePhase(context, 'fixture', () => value), value);
  const pending = Promise.resolve(value);
  assert.equal(measurePhase(context, 'fixture', () => pending), pending);
  const failure = new Error('fixture failure');
  assert.throws(() => measurePhase(context, 'fixture', () => { throw failure; }), (error) => error === failure);
  await assert.rejects(measurePhase(context, 'fixture', () => Promise.reject(failure)), (error) => error === failure);
});

test('enabled browser phase profiling reports each completed action and preserves results and errors', async (t) => {
  setProfiling(t, true);
  const reports = [];
  const context = { name: 'synthetic phase test', diagnostic: (message) => reports.push(JSON.parse(message)) };
  const value = {};
  assert.equal(measurePhase(context, 'fixture', () => value), value);
  assert.equal(await measurePhase(context, 'browser-launch', async () => value), value);
  const failure = new Error('original action failure');
  assert.throws(() => measurePhase(context, 'server-start', () => { throw failure; }), (error) => error === failure);
  await assert.rejects(measurePhase(context, 'browser-cleanup', async () => { throw failure; }), (error) => error === failure);
  assert.deepEqual(reports.map(({ phase }) => phase), ['fixture', 'browser-launch', 'server-start', 'browser-cleanup']);
  for (const report of reports) {
    assert.equal(report.browserProfilePhase, 1);
    assert.equal(report.testName, context.name);
    assert.equal(typeof report.durationMs, 'number');
    assert.ok(Number.isFinite(report.durationMs) && report.durationMs >= 0);
  }
});

test('browser phase diagnostics cannot replace a successful result or the original failure', async (t) => {
  setProfiling(t, true);
  const context = { name: 'closed context', diagnostic: () => { throw new Error('diagnostic failure'); } };
  const value = {};
  assert.equal(measurePhase(context, 'fixture', () => value), value);
  assert.equal(await measurePhase(context, 'fixture', async () => value), value);
  const failure = new Error('original failure');
  assert.throws(() => measurePhase(context, 'fixture', () => { throw failure; }), (error) => error === failure);
  await assert.rejects(measurePhase(context, 'fixture', async () => { throw failure; }), (error) => error === failure);
});
