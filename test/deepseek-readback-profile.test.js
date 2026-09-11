'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createPhaseCollector, coldAttribution, TOP_LEVEL, DEEPSEEK, PRIVATE } = require('../scripts/deepseek-phase-accounting');
const {
  writeFixture,
  eventTarget,
  worker,
  fingerprintProfileFrom,
  fingerprintAttributionFrom,
  FINGERPRINT_PROFILE_INVOCATIONS,
} = require('../scripts/deepseek-readback-profile');
const { parseSessionArtifact } = require('../src/deepseek-harness');

test('phase collector keeps repeated nested names and duration metadata without double counting', () => {
  let time = 0;
  const collector = createPhaseCollector(() => ++time);
  for (const state of ['start', 'start', 'end', 'start', 'end', 'end']) collector.onPhase({ phase: 'same', state });
  collector.onPhase({ phase: 'wait', state: 'duration', durationMs: 0.5 });
  assert.deepEqual(collector.finish(0, 8), {
    phases: [{ phase: 'same', count: 1, durationMs: 5, children: [{ phase: 'same', count: 2, durationMs: 2, children: [] }] }],
    durationEvents: [{ phase: 'wait', durationMs: 0.5, parent: null }],
  });
});

test('phase collector reports swallowed malformed events after observation', () => {
  for (const events of [
    [{ phase: 'x', state: 'end' }],
    [{ phase: 'x', state: 'start' }],
    [{ phase: 'x', state: 'start' }, { phase: 'y', state: 'end' }],
    [{ phase: 'x', state: 'duration', durationMs: -1 }],
    [{ phase: 'x', state: 'start', content: 'forbidden' }],
  ]) {
    const collector = createPhaseCollector(() => 1);
    for (const event of events) assert.doesNotThrow(() => collector.onPhase(event));
    assert.throws(() => collector.finish(0, 2));
  }
  const collector = createPhaseCollector(() => 1);
  collector.onPhase({ phase: 'x', state: 'start' });
  collector.onPhase({ phase: 'x', state: 'end' });
  assert.throws(() => collector.finish(2, 3), /escapes/);
});

test('cold accounting sums siblings and reports explicit residuals', () => {
  let time = 0;
  const collector = createPhaseCollector(() => time);
  for (const phase of TOP_LEVEL) {
    collector.onPhase({ phase, state: 'start' });
    const children = phase === 'adapter_materialization' ? DEEPSEEK : phase === 'materialized_private_validation' ? PRIVATE : [];
    for (const child of children) {
      collector.onPhase({ phase: child, state: 'start' });
      time += 1;
      collector.onPhase({ phase: child, state: 'end' });
    }
    time += 1;
    collector.onPhase({ phase, state: 'end' });
  }
  const result = coldAttribution(collector, 0, time, 2, time + 5);
  assert.equal(result.httpOuterResidualMs, 3);
  assert.equal(result.materializationResidualMs, 0);
  assert.equal(result.adapterMaterializationMs.residual, 1);
  assert.equal(result.materializationTopLevelMs.materialized_private_validation, 4);
  assert.throws(() => coldAttribution(collector, 0, time, 2, time), /negative accounting/);
  assert.throws(() => coldAttribution(collector, 0, time + 100, 2, time + 105), /coverage gap/);
  assert.throws(() => coldAttribution(createPhaseCollector(), 0, 1, 0, 1), /major phases/);
});

test('fingerprint profiling reports the seven ordered invocations and complete accounting after materialization', async () => {
  const result = await worker(100, 'plain', 'tool-dense', { fingerprintProfile: true });
  assert.equal(result.materializationCalls, 1);
  assert.ok(result.fingerprintAttribution);
  const { invocations, totals } = result.fingerprintAttribution;
  assert.deepEqual(invocations.map((invocation) => invocation.role), FINGERPRINT_PROFILE_INVOCATIONS);
  assert.equal(invocations.length, 7);
  for (const invocation of invocations) {
    assert.ok(invocation.elapsedMs >= 0);
    assert.ok(invocation.yieldWaitMs >= 0);
    assert.ok(invocation.activeComputeMs >= 0);
    assert.ok(invocation.textPrefixBytes > 0);
    assert.equal(
      invocation.operationCount,
      invocation.visitTaskCount + invocation.writeTaskCount + invocation.byteTaskCount,
    );
    assert.equal(invocation.hashInputBytes, invocation.textPrefixBytes + invocation.textValueUtf8Bytes + invocation.binaryHashBytes);
    assert.equal(invocation.hashUpdateCallCount, invocation.textHashUpdateCallCount + invocation.byteTaskCount);
  }
  for (const metric of ['elapsedMs', 'yieldWaitMs', 'activeComputeMs', 'textPrefixBytes', 'operationCount']) {
    assert.equal(totals[metric], invocations.reduce((sum, invocation) => sum + invocation[metric], 0));
  }
  const malformed = invocations.map((invocation) => ({ ...invocation }));
  malformed[0].hashInputBytes += 1;
  assert.throws(() => fingerprintAttributionFrom(malformed), /hash-input accounting/);
});

test('fingerprint profiling option accepts only on or off', () => {
  assert.equal(fingerprintProfileFrom('on'), true);
  assert.equal(fingerprintProfileFrom('off'), false);
  assert.throws(() => fingerprintProfileFrom('enabled'), /fingerprint-profile must be on or off/);
});

for (const shape of ['tool-dense', 'message-dense']) {
  for (const compression of ['plain', 'zstd']) {
    test(`small real HTTP profile ${shape}/${compression} preserves cold ownership and attribution`, async () => {
      const result = await worker(100, compression, shape);
      assert.equal(result.materializationCallsBeforeColdDetail, 0);
      assert.equal(result.materializationCallsAfterColdDetail, 1);
      assert.equal(result.materializationCalls, 1);
      assert.equal(result.sourceIdentityUnchanged, true);
      assert.equal(result.physicalRecordCount, 101);
      assert.equal(result.rawEventCount, 101);
      assert.equal(result.logicalEventCount, shape === 'tool-dense' ? 50 : 100);
      assert.deepEqual(Object.keys(result.coldAttribution.materializationTopLevelMs), TOP_LEVEL);
      assert.equal(result.fingerprintAttribution, undefined);
    });
    test(`profile fixture ${shape}/${compression} has deterministic counts and first Detail target`, async (t) => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deepseek-profile-test-'));
      t.after(() => fsp.rm(root, { recursive: true, force: true }));
      const fixture = await writeFixture(root, 100, compression, shape);
      const session = await parseSessionArtifact(fixture.file, path.relative(fixture.sourceHome, fixture.file), fixture.repoRoot);
      assert.equal(session.rawEvents.length, 101);
      assert.equal(session.logicalEvents.length, shape === 'tool-dense' ? 50 : 100);
      const target = session.logicalEvents.find((event) => event.id === `${session.id}:${eventTarget(shape, 0)}`);
      assert.ok(target);
      assert.equal(target.layer, 'main');
      assert.equal(target.rawRefs.length, shape === 'tool-dense' ? 2 : 1);
      assert.ok(fixture.plainBytes > 0);
      assert.equal(fixture.frameCount, compression === 'plain' ? 0 : 2);
    });
  }
}
