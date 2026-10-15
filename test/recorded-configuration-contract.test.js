'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');

function ref(line) {
  return { rawId: `session:raw:${line}`, file: 'nested\\rollout.jsonl', line,
    sourceRecordType: 'turn_context', sourceEventType: '',
    sourceLocator: { type: 'jsonl_line', file: 'nested/rollout.jsonl', line } };
}
function section() {
  return { type: 'recorded_configuration', purpose: 'traceability', status: 'recorded', truncated: false,
    observations: [{ kind: 'turn_context', model: { state: 'value', value: 'model-a' }, effort: { state: 'null' },
      start: ref(3), end: ref(8), endReason: 'turn_boundary', rawRefs: [ref(3), ref(8)] }] };
}

test('recorded configuration DTO preserves distinct field states and physical evidence', () => {
  const value = section();
  validateLogicalDetailSection(value);
  for (const state of ['missing', 'null', 'invalid', 'value']) {
    value.observations[0].effort = state === 'value' ? { state, value: 'future-effort' } : { state };
    validateLogicalDetailSection(JSON.parse(JSON.stringify(value)));
  }
  value.observations[0].collaboration = { model: { state: 'value', value: 'other-model' }, effort: { state: 'missing' } };
  validateLogicalDetailSection(value);
  const instruction = { kind: 'effort_update', effort: { state: 'value', value: 'high' },
    start: ref(5), endReason: 'snapshot_end', rawRefs: [ref(5)] };
  value.observations.push(instruction);
  validateLogicalDetailSection(value);
});

test('recorded configuration rejects payloads, inconsistent states and invented boundaries', () => {
  const mutations = [
    (s) => { s.payload = {}; },
    (s) => { s.purpose = 'content'; },
    (s) => { s.status = 'effective'; },
    (s) => { s.observations = []; },
    (s) => { s.observations[0].model = { state: 'missing', value: 'guessed' }; },
    (s) => { s.observations[0].effort = { state: 'value', value: 3 }; },
    (s) => { s.observations[0].effort = { state: 'value', value: 'x'.repeat(513) }; },
    (s) => { s.observations[0].model = { state: 'value', value: ' model ' }; },
    (s) => { s.observations[0].endReason = 'snapshot_end'; },
    (s) => { delete s.observations[0].end; },
    (s) => { s.observations[0].start.line = 0; },
    (s) => { s.observations[0].start.sourceLocator.line = 9; },
    (s) => { s.observations[0].rawRefs[0] = ref(7); },
    (s) => { s.observations[0].rawRefs.push(ref(10)); },
    (s) => { s.observations[0].kind = 'effort_update'; },
    (s) => { s.observations[0].collaboration = { model: { state: 'missing' }, effort: { state: 'missing' }, provider: 'unbounded' }; },
    (s) => { s.observations.push(structuredClone(s.observations[0])); },
    (s) => { s.status = 'mixed'; s.observations = Array.from({ length: 9 }, () => structuredClone(s.observations[0])); },
  ];
  for (const mutate of mutations) {
    const value = section(); mutate(value);
    assert.throws(() => validateLogicalDetailSection(value), { code: 'LOGICAL_DETAIL_CONTRACT_VIOLATION' });
  }
  const mixed = section(); mixed.status = 'mixed'; mixed.observations.push(structuredClone(mixed.observations[0]));
  validateLogicalDetailSection(mixed);
});
