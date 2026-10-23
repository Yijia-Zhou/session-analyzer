'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sha256 } = require('../scripts/history-eval-common');
const { assess, pair, LAYERS } = require('../scripts/assess-history-decision-eval');

function annotation() {
  return { status: 'prepared', provenance: 'synthetic reviewer record', identity: {
    task: 'D01', trial: 'one', condition: 'baseline', taskSha256: 'a'.repeat(64), corpusHash: 'b'.repeat(64),
    environmentHash: 'c'.repeat(64), model: 'requested-test-model', reasoningEffort: 'high', harness: 'test', budgets: { calls: 12, bytes: 24000 },
  }, guideExposure: { status: 'unknown', sha256: null },
  layers: Object.fromEntries(Object.keys(LAYERS).map((key) => [key, { value: null }])) };
}

test('reviewed failures and unavailable assessments remain distinct; no cost inferred', () => {
  const input = annotation();
  input.layers.displayed = { value: false, provenance: 'recorded delivery ends before supporting span' };
  input.layers.found = { value: true, provenance: 'returned hit identifies supporting event' };
  const result = assess(input, []);
  assert.deepEqual(result.failureLayers, ['evidence_not_displayed']);
  assert.deepEqual(result.unassessedLayers, ['included', 'readOrContinued', 'judgment', 'handoff']);
  assert.equal(result.modelUsage, null);
  assert.equal(result.modelUsageStatus, 'unavailable');
  assert.equal(result.recorderConfigVerified, false);
  delete input.layers.included;
  assert.throws(() => assess(input, []), /verdict required for included/u);
});

test('setup preparation and open API receipts cannot establish completed task or human handoff', () => {
  const input = annotation();
  input.status = 'completed';
  input.answerArtifact = 'synthetic-answer.json';
  assert.throws(() => assess(input, []), /actual retrieval log/u);
  input.status = 'prepared';
  input.layers.handoff = { value: true, provenance: 'open returned browserOpenRequested' };
  assert.throws(() => assess(input, []), /continued reading/u);
  input.handoffVerification = { target: true, supportingContent: true, continuedReading: 'false', artifact: 'synthetic.json' };
  assert.throws(() => assess(input, []), /continued reading/u);
  input.layers.handoff = { value: null };
  input.guideExposure = { status: 'full', sha256: 'a'.repeat(64) };
  assert.throws(() => assess(input, []), /exposure provenance/u);
});

test('paired trial comparison rejects task/model/environment/budget changes and records guide intervention', () => {
  const before = annotation();
  const after = structuredClone(before);
  assert.throws(() => pair(before, after), /completed assessed trials/u);
  for (const trial of [before, after]) {
    trial.status = 'completed';
    trial.logs = [{ executedRetrievalCalls: 1 }];
    trial.answerArtifactSha256 = 'e'.repeat(64);
    trial.recorderConfigVerified = true;
  }
  assert.throws(() => pair(before, after), /distinct trial identities/u);
  after.identity.trial = 'two';
  after.guideExposure = { status: 'full', sha256: 'd'.repeat(64), provenance: 'synthetic guide capture' };
  assert.equal(pair(before, after).guideChanged, true);
  after.identity.budgets = { bytes: 24000, calls: 12 };
  assert.equal(pair(before, after).paired, true);
  after.identity.budgets = { maxOutputBytesPerCall: 24000, maxRetrievalCalls: 12 };
  assert.equal(pair(before, after).paired, true);
  const unverified = { ...after, recorderConfigVerified: false };
  assert.throws(() => pair(before, unverified), /verified recorder harness and budgets/u);
  for (const field of ['model', 'taskSha256', 'corpusHash', 'environmentHash', 'reasoningEffort', 'harness', 'budgets']) {
    const changed = structuredClone(after);
    changed.identity[field] = 'changed';
    assert.throws(() => pair(before, changed), /Unpaired comparison/u);
  }
});

test('completed assessment verifies private answer bytes and rejects mismatched recorder identity', (t) => {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'tmp/decision-assessment-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = annotation();
  input.status = 'completed';
  input.answerArtifact = path.join(directory, 'answer.json');
  const log = path.join(directory, 'log.jsonl');
  const row = { identity: { ...input.identity, budgets: { maxRetrievalCalls: 12, maxOutputBytes: 24000 },
    corpus: { corpusHash: input.identity.corpusHash } }, phase: 'retrieval', executed: true };
  fs.writeFileSync(log, JSON.stringify(row) + '\n');
  assert.throws(() => assess(input, [log]), /ENOENT/u);
  fs.writeFileSync(input.answerArtifact, '{"answer":"synthetic"}\n');
  const result = assess(input, [log]);
  assert.equal(result.answerArtifactSha256, sha256(fs.readFileSync(input.answerArtifact)));
  assert.equal(result.recorderConfigVerified, true);
  assert.throws(() => pair(result, result), /distinct trial identities/u);
  input.layers.handoff = { value: true, provenance: 'synthetic browser review' };
  input.handoffVerification = { target: true, supportingContent: true, continuedReading: true, artifact: path.join(directory, 'verification.json') };
  assert.throws(() => assess(input, [log]), /ENOENT/u);
  fs.writeFileSync(input.handoffVerification.artifact, '{"syntheticVerified":true}\n');
  assert.equal(assess(input, [log]).handoffArtifactSha256, sha256(fs.readFileSync(input.handoffVerification.artifact)));
  row.identity.task = 'different';
  fs.writeFileSync(log, JSON.stringify(row) + '\n');
  assert.throws(() => assess(input, [log]), /identity differs/u);
});

test('recorded harness and enforced budgets must match; missing legacy configuration cannot certify a pair', (t) => {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'tmp/decision-config-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = annotation();
  input.status = 'completed';
  input.answerArtifact = path.join(directory, 'answer.json');
  fs.writeFileSync(input.answerArtifact, '{"answer":"synthetic"}\n');
  const log = path.join(directory, 'log.jsonl');
  const identity = { trial: input.identity.trial, condition: input.identity.condition, task: input.identity.task,
    model: input.identity.model, harness: input.identity.harness,
    corpus: { corpusHash: input.identity.corpusHash }, budgets: { maxOutputBytes: 24000, maxRetrievalCalls: 12 } };
  const record = (value) => fs.writeFileSync(log, JSON.stringify({ identity: value, phase: 'retrieval', executed: true }) + '\n');
  record(identity);
  const verified = assess(input, [log]);
  assert.equal(verified.recorderConfigVerified, true);
  assert.deepEqual(verified.unverifiedRecorderFields, []);
  input.identity.budgets = { maxRetrievalCalls: 12, maxOutputBytesPerCall: 24000 };
  assert.equal(assess(input, [log]).recorderConfigVerified, true);
  record({ ...identity, harness: 'different-harness' });
  assert.throws(() => assess(input, [log]), /Recorder harness differs/u);
  for (const budgets of [{ maxRetrievalCalls: 13, maxOutputBytes: 24000 }, { maxRetrievalCalls: 12, maxOutputBytes: 24001 }]) {
    record({ ...identity, budgets });
    assert.throws(() => assess(input, [log]), /Recorder budgets differ/u);
  }
  record({ ...identity, harness: undefined, budgets: undefined });
  const legacy = assess(input, [log]);
  assert.equal(legacy.recorderConfigVerified, false);
  assert.deepEqual(legacy.unverifiedRecorderFields, ['budgets', 'harness']);
  assert.throws(() => pair(verified, { ...legacy, identity: { ...legacy.identity, trial: 'other' } }), /verified recorder harness and budgets/u);
});
