'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const MATERIALIZATION_COVERAGE_LIMIT_MS = 5;

const TOP_LEVEL = [
  'materialized_pre_adapter_validation', 'adapter_materialization',
  'materialized_post_adapter_ownership', 'materialized_canonical_validation',
  'materialized_private_validation', 'materialized_fingerprint_reuse',
  'materialized_projection', 'materialized_fingerprint_recheck',
  'materialized_final_admission_check',
];
const DEEPSEEK = ['deepseek_materialization_source_read', 'deepseek_materialization_reconstruction'];
const PRIVATE = ['materialized_private_fingerprint_capture', 'materialized_private_callback', 'materialized_private_fingerprint_recheck'];

// This collector stores only timing metadata. Callback errors are retained and
// reported after the request, because production deliberately swallows observers.
function createPhaseCollector(now = () => performance.now()) {
  const stack = [];
  const roots = [];
  const durations = [];
  let failure;
  let lastTime = -Infinity;
  function onPhase(event) {
    try {
      const time = now();
      assert.ok(Number.isFinite(time) && time >= lastTime, 'non-monotonic phase clock');
      lastTime = time;
      assert.ok(event && Object.keys(event).every((key) => ['phase', 'state', 'durationMs'].includes(key)), 'unexpected phase metadata');
      const { phase, state } = event;
      assert.ok(typeof phase === 'string' && /^[a-z][a-z0-9_]*$/.test(phase), 'invalid phase name');
      if (state === 'duration') {
        assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0, 'invalid duration');
        durations.push({ phase, durationMs: event.durationMs, parent: stack.at(-1)?.phase ?? null });
      } else if (state === 'start') {
        const span = { phase, start: time, children: [] };
        (stack.at(-1)?.children ?? roots).push(span);
        stack.push(span);
      } else {
        assert.equal(state, 'end', 'unknown phase state');
        assert.equal(stack.at(-1)?.phase, phase, 'unbalanced phase end');
        stack.pop().end = time;
      }
    } catch (error) {
      failure ||= error;
    }
  }
  function finish(start, end) {
    if (failure) throw failure;
    assert.equal(stack.length, 0, 'unclosed phase');
    assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start);
    function summarize(spans, parentStart, parentEnd) {
      let previousEnd = parentStart;
      const groups = new Map();
      for (const span of spans) {
        assert.ok(span.start >= previousEnd && span.end >= span.start && span.end <= parentEnd, 'phase escapes parent or overlaps sibling');
        previousEnd = span.end;
        const children = summarize(span.children, span.start, span.end);
        const group = groups.get(span.phase) || { phase: span.phase, count: 0, durationMs: 0, children: [] };
        group.count += 1;
        group.durationMs += span.end - span.start;
        // Keep each invocation's children separate when names repeat.
        group.children.push(...children);
        groups.set(span.phase, group);
      }
      return [...groups.values()];
    }
    return { phases: summarize(roots, start, end), durationEvents: durations };
  }
  return { onPhase, finish };
}

function coldAttribution(collector, materializationStart, materializationEnd, detailConstructionMs, coldDetailMs) {
  const materializationMs = materializationEnd - materializationStart;
  for (const value of [materializationMs, detailConstructionMs, coldDetailMs]) assert.ok(Number.isFinite(value) && value >= 0);
  const { phases, durationEvents } = collector.finish(materializationStart, materializationEnd);
  function exact(spans, names) {
    assert.deepEqual(spans.map((span) => span.phase), names, 'unexpected major phases/order');
    assert.ok(spans.every((span) => span.count === 1), 'major phases must occur once');
    return Object.fromEntries(spans.map((span) => [span.phase, span.durationMs]));
  }
  const materializationTopLevelMs = exact(phases, TOP_LEVEL);
  const adapter = phases.find((span) => span.phase === 'adapter_materialization');
  const adapterMaterializationMs = exact(adapter.children, DEEPSEEK);
  const privatePhase = phases.find((span) => span.phase === 'materialized_private_validation');
  const nestedValidationMs = exact(privatePhase.children, PRIVATE);
  for (const span of phases) {
    const leaves = span === adapter || span === privatePhase ? span.children : [span];
    assert.ok(leaves.every((leaf) => leaf.children.length === 0), 'unexpected nested phase topology');
  }
  const sum = (values) => Object.values(values).reduce((total, value) => total + value, 0);
  const materializationAccountedMs = sum(materializationTopLevelMs);
  const materializationResidualMs = materializationMs - materializationAccountedMs;
  adapterMaterializationMs.residual = adapter.durationMs - sum(adapterMaterializationMs);
  const httpOuterResidualMs = coldDetailMs - materializationMs - detailConstructionMs;
  // Same monotonic process clock; only floating-point subtraction tolerance.
  for (const value of [materializationResidualMs, adapterMaterializationMs.residual, httpOuterResidualMs]) assert.ok(value >= -1e-7, 'negative accounting residual');
  // Coverage policy belongs to the serial measurement gate. A pause between
  // observer callbacks contributes to the outer clock but neither phase.
  return {
    materializationMs, detailConstructionMs, httpOuterResidualMs: Math.max(0, httpOuterResidualMs),
    materializationAccountedMs, materializationCoverageLimitMs: MATERIALIZATION_COVERAGE_LIMIT_MS,
    materializationTopLevelMs, materializationResidualMs: Math.max(0, materializationResidualMs),
    adapterMaterializationMs, nestedValidationMs, durationEvents,
  };
}

function assertMaterializationCoverage(attribution, limitMs = MATERIALIZATION_COVERAGE_LIMIT_MS) {
  const { materializationMs, materializationAccountedMs, materializationResidualMs } = attribution;
  for (const value of [materializationMs, materializationAccountedMs, materializationResidualMs, limitMs]) {
    assert.ok(Number.isFinite(value) && value >= 0, 'invalid materialization coverage measurement');
  }
  assert.ok(materializationResidualMs <= limitMs,
    `materialization phase coverage gap: residual=${materializationResidualMs.toFixed(2)}ms `
    + `limit=${limitMs.toFixed(2)}ms materialization=${materializationMs.toFixed(2)}ms `
    + `accounted=${materializationAccountedMs.toFixed(2)}ms`);
}

module.exports = {
  createPhaseCollector, coldAttribution, assertMaterializationCoverage,
  MATERIALIZATION_COVERAGE_LIMIT_MS, TOP_LEVEL, DEEPSEEK, PRIVATE,
};
