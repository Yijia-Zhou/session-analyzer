#!/usr/bin/env node
'use strict';

// Human judgments remain explicit; retrieval counts never become answer scores.
const fs = require('node:fs');
const path = require('node:path');
const { sha256, privateTarget, mainGuard } = require('./history-eval-common');
const LAYERS = {
  included: 'evidence_not_included',
  found: 'evidence_not_found',
  displayed: 'evidence_not_displayed',
  readOrContinued: 'evidence_not_read_or_continued',
  judgment: 'wrong_judgment',
  handoff: 'wrong_handoff',
};
const PAIR_FIELDS = ['taskSha256', 'corpusHash', 'model', 'reasoningEffort', 'harness', 'environmentHash', 'budgets'];
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

// Annotations may name per-call delivery explicitly or use calls/bytes;
// recorder logs retain their command-line bound names. Compare their meanings.
function recorderBudgets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const [field, aliases] of [['maxRetrievalCalls', ['maxRetrievalCalls', 'calls']], ['maxOutputBytes', ['maxOutputBytes', 'maxOutputBytesPerCall', 'bytes']]]) {
    const supplied = aliases.filter((alias) => Object.hasOwn(value, alias));
    if (!supplied.length) return null;
    const count = value[supplied[0]];
    if (supplied.some((alias) => value[alias] !== count)) throw new Error(`Conflicting budget labels for ${field}`);
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) throw new Error(`Invalid recorder budget ${field}`);
    result[field] = count;
  }
  return result;
}

function comparableBudgets(value) {
  const bounds = recorderBudgets(value);
  if (!bounds) return value;
  const labels = ['maxRetrievalCalls', 'calls', 'maxOutputBytes', 'maxOutputBytesPerCall', 'bytes'];
  return { ...Object.fromEntries(Object.entries(value).filter(([key]) => !labels.includes(key))), ...bounds };
}

function assess(annotation, logFiles) {
  if (!annotation || typeof annotation !== 'object' || !annotation.provenance?.trim()) throw new Error('Assessment requires review provenance');
  const identity = annotation.identity;
  if (!identity || !identity.task || !identity.trial || !identity.condition) throw new Error('Assessment requires trial identity');
  for (const field of PAIR_FIELDS) if (identity[field] === undefined || identity[field] === null) throw new Error(`Missing pairing identity ${field}`);
  for (const field of ['taskSha256', 'corpusHash', 'environmentHash']) if (!/^[a-f0-9]{64}$/u.test(identity[field])) throw new Error(`Invalid ${field}`);
  const guide = annotation.guideExposure;
  if (!guide || !['full', 'partial', 'none', 'unknown'].includes(guide.status)) throw new Error('Guide exposure must be full|partial|none|unknown');
  if (['full', 'partial'].includes(guide.status) && (!/^[a-f0-9]{64}$/u.test(guide.sha256 || '') || !guide.provenance?.trim())) throw new Error('Exposed guide requires hash and exposure provenance');
  const failureLayers = [];
  const unassessedLayers = [];
  for (const [layer, code] of Object.entries(LAYERS)) {
    const verdict = annotation.layers?.[layer];
    if (!verdict || !Object.hasOwn(verdict, 'value') || ![true, false, null].includes(verdict.value)) throw new Error(`Explicit true|false|null verdict required for ${layer}`);
    if (verdict.value === null) unassessedLayers.push(layer);
    else {
      if (!verdict.provenance?.trim()) throw new Error(`Assessed ${layer} requires provenance`);
      if (!verdict.value) failureLayers.push(code);
    }
  }
  if (annotation.layers.handoff.value === true && (annotation.handoffVerification?.target !== true || annotation.handoffVerification?.supportingContent !== true
    || annotation.handoffVerification?.continuedReading !== true || typeof annotation.handoffVerification?.artifact !== 'string'
    || !annotation.handoffVerification.artifact.trim())) {
    throw new Error('Passing handoff requires reviewed target, supporting content, continued reading and private verification artifact');
  }
  let handoffArtifactSha256 = null;
  if (annotation.layers.handoff.value === true) {
    const artifact = privateTarget(annotation.handoffVerification.artifact);
    if (!fs.statSync(artifact).isFile()) throw new Error('Handoff verification artifact must be a private file');
    handoffArtifactSha256 = sha256(fs.readFileSync(artifact));
  }
  const expectedBudgets = recorderBudgets(identity.budgets);
  const unverifiedRecorderFields = new Set();
  if (!expectedBudgets) unverifiedRecorderFields.add('budgets');
  if (!logFiles.length) { unverifiedRecorderFields.add('harness'); unverifiedRecorderFields.add('budgets'); }
  const logs = logFiles.map((file) => {
    const bytes = fs.readFileSync(file);
    const rows = bytes.toString('utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    if (!rows.length) throw new Error('Empty recorder log');
    for (const row of rows) {
      if (row.identity?.trial !== identity.trial || row.identity?.condition !== identity.condition || row.identity?.task !== identity.task
        || row.identity?.corpus?.corpusHash !== identity.corpusHash || row.identity?.model !== identity.model) throw new Error('Recorder identity differs from assessment');
      if (row.identity.harness === undefined || row.identity.harness === null) unverifiedRecorderFields.add('harness');
      else if (row.identity.harness !== identity.harness) throw new Error('Recorder harness differs from assessment');
      const actualBudgets = recorderBudgets(row.identity.budgets);
      if (!actualBudgets) unverifiedRecorderFields.add('budgets');
      else if (expectedBudgets && canonical(actualBudgets) !== canonical(expectedBudgets)) throw new Error('Recorder budgets differ from assessment');
    }
    return { path: path.resolve(file), sha256: sha256(bytes), calls: rows.length,
      executedRetrievalCalls: rows.filter((r) => (r.phase || 'retrieval') === 'retrieval' && r.executed !== false).length };
  });
  if (!['completed', 'blocked', 'abandoned', 'prepared'].includes(annotation.status)) throw new Error('Explicit trial status required');
  if (annotation.status === 'completed' && (!logs.some((l) => l.executedRetrievalCalls > 0) || !annotation.answerArtifact)) throw new Error('Completed trial requires actual retrieval log and answer artifact');
  let answerArtifactSha256 = null;
  if (annotation.status === 'completed') {
    const answer = privateTarget(annotation.answerArtifact);
    if (!fs.statSync(answer).isFile()) throw new Error('Answer artifact must be a private file');
    answerArtifactSha256 = sha256(fs.readFileSync(answer));
  }
  if (annotation.usage !== undefined && annotation.usage !== null && !annotation.usage.provenance?.trim()) throw new Error('Supplied model usage requires provenance');
  return { schemaVersion: 1, ...annotation, logs, answerArtifactSha256, handoffArtifactSha256, failureLayers, unassessedLayers,
    recorderConfigVerified: unverifiedRecorderFields.size === 0, unverifiedRecorderFields: [...unverifiedRecorderFields].sort(),
    modelUsage: annotation.usage ?? null, modelUsageStatus: annotation.usage ? 'supplied_not_independently_audited' : 'unavailable',
    interpretation: 'False verdicts are reviewed observations, not inferred causes. Null is unassessed, not a failure. Physical corpus inclusion, service admission and model delivery are different. Setup is not a completed trial; bytes and tests establish neither model usage nor memory benefit.' };
}

function pair(before, after) {
  for (const trial of [before, after]) {
    if (trial.status !== 'completed' || !trial.logs?.some((log) => log.executedRetrievalCalls > 0)
      || !/^[a-f0-9]{64}$/u.test(trial.answerArtifactSha256 || '')) throw new Error('Pair requires completed assessed trials with retrieval logs and hashed answers');
    if (trial.recorderConfigVerified !== true) throw new Error('Pair requires verified recorder harness and budgets; legacy or missing configuration remains unverified');
  }
  if (before.identity.trial === after.identity.trial && before.identity.condition === after.identity.condition) throw new Error('Pair requires distinct trial identities; self-comparison is not an independent trial');
  const comparable = (trial, field) => field === 'budgets' ? comparableBudgets(trial.identity[field]) : trial.identity[field];
  const mismatches = PAIR_FIELDS.filter((field) => canonical(comparable(before, field)) !== canonical(comparable(after, field)));
  if (mismatches.length) throw new Error(`Unpaired comparison: ${mismatches.join(', ')}`);
  return { paired: true, guideChanged: before.guideExposure.sha256 !== after.guideExposure.sha256,
    warning: 'Version and instruction differences must be named. Matching requested model labels do not independently verify provider configuration. Selected tasks do not establish general recall or total-token savings.' };
}

function main() {
  const args = process.argv.slice(2);
  const annotationFile = args.shift();
  const reportFile = args.shift();
  if (!annotationFile || !reportFile) throw new Error('Usage: assess-history-decision-eval.js <private-annotation.json> <new-tmp-report.json> [recorder-log.jsonl ...]');
  const report = assess(JSON.parse(fs.readFileSync(annotationFile, 'utf8')), args);
  const target = privateTarget(reportFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ status: report.status, failures: report.failureLayers, unassessed: report.unassessedLayers, modelUsageStatus: report.modelUsageStatus })}\n`);
}
if (require.main === module) mainGuard(main);
module.exports = { assess, pair, LAYERS };
