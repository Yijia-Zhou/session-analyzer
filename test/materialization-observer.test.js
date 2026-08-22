'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  hasMaterializationObserver,
  observeMaterializationPhase,
  recordMaterializationDuration,
  runWithMaterializationObserver,
} = require('../src/materialization-observer');

test('materialization observation is scoped, content-free, and behavior-neutral', async () => {
  const events = [];
  const result = await runWithMaterializationObserver((event) => events.push(event), async () => {
    assert.equal(hasMaterializationObserver(), true);
    const value = await observeMaterializationPhase('adapter_materialization', async () => {
      await new Promise((resolve) => setImmediate(resolve));
      recordMaterializationDuration('adapter_source_read_wait', 12.5);
      return 42;
    });
    return value;
  });

  assert.equal(result, 42);
  assert.equal(hasMaterializationObserver(), false);
  assert.deepEqual(events, [
    { phase: 'adapter_materialization', state: 'start' },
    { phase: 'adapter_source_read_wait', state: 'duration', durationMs: 12.5 },
    { phase: 'adapter_materialization', state: 'end' },
  ]);
  assert.ok(events.every((event) => Object.keys(event).every((key) => (
    ['phase', 'state', 'durationMs'].includes(key)
  ))));
});

test('materialization observer failures never change success or rejection', async () => {
  const throwingObserver = () => { throw new Error('observer failed'); };
  assert.equal(
    await runWithMaterializationObserver(
      throwingObserver,
      () => observeMaterializationPhase('phase', async () => 'ok'),
    ),
    'ok',
  );
  await assert.rejects(
    runWithMaterializationObserver(
      throwingObserver,
      () => observeMaterializationPhase('phase', async () => { throw new Error('operation failed'); }),
    ),
    /operation failed/,
  );
});
