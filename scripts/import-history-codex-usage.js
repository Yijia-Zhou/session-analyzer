#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { identifier, privateTarget, sha256, mainGuard } = require('./history-eval-common');
const { normalizeUsage } = require('./aggregate-history-eval');

const FIELDS = { inputTokens: 'input_tokens', outputTokens: 'output_tokens', cachedInputTokens: 'cached_input_tokens',
  reasoningTokens: 'reasoning_tokens', totalTokens: 'total_tokens', costUsd: 'cost_usd' };

// Keep partial usage as an observation in audit. It must not masquerade as a
// trial total when the process/turn stream is incomplete or child agents ran.
function importUsage(eventsPath, identity, options = {}) {
  if (!identifier(identity?.condition) || !identifier(identity?.trial) || !/^[a-f0-9]{64}$/u.test(identity?.corpusHash || '')) throw new Error('Usage requires fixed condition, trial and corpusHash');
  const bytes = fs.readFileSync(eventsPath);
  const issues = [];
  const events = [];
  for (const [index, line] of bytes.toString('utf8').split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try { const event = JSON.parse(line); if (!event || typeof event.type !== 'string') throw new Error('missing event type'); events.push({ line: index + 1, event }); }
    catch { issues.push(`invalid_event_line:${index + 1}`); }
  }
  let threadId = null;
  let startedTurns = 0;
  let openTurn = false;
  const reported = [];
  for (const { line, event } of events) {
    if (event.type === 'thread.started') {
      if (threadId !== null || typeof event.thread_id !== 'string' || !event.thread_id) issues.push(`invalid_thread_start:${line}`);
      else threadId = event.thread_id;
    }
    if (event.type === 'turn.started') {
      if (openTurn) issues.push(`overlapping_turn:${line}`);
      openTurn = true; startedTurns += 1;
    }
    if (event.type === 'turn.completed') {
      if (!openTurn) issues.push(`unmatched_completed_turn:${line}`);
      openTurn = false;
      const raw = event.usage;
      const values = {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) issues.push(`missing_usage:${line}`);
      for (const [field, key] of Object.entries(FIELDS)) {
        const value = raw?.[key] ?? (field === 'reasoningTokens' ? raw?.reasoning_output_tokens : null) ?? null;
        if (field === 'reasoningTokens' && raw?.reasoning_tokens != null && raw?.reasoning_output_tokens != null
          && raw.reasoning_tokens !== raw.reasoning_output_tokens) {
          issues.push(`conflicting_reasoning_tokens:${line}`); values[field] = null; continue;
        }
        if (value !== null && (!Number.isFinite(value) || value < 0 || (field !== 'costUsd' && !Number.isSafeInteger(value)))) {
          issues.push(`invalid_${key}:${line}`); values[field] = null;
        } else values[field] = value;
      }
      reported.push({ line, raw: raw ?? null, values });
    }
    if (event.type === 'turn.failed' || event.type === 'error') issues.push(`${event.type}:${line}`);
    const item = event.item;
    if (/collab|subagent/iu.test(event.type) || /collab|subagent/iu.test(item?.type || '')
      || ['spawn_agent', 'send_input', 'wait_agent', 'resume_agent', 'close_agent'].includes(item?.tool || item?.name)) issues.push(`subagent_usage_not_covered:${line}`);
  }
  if (!threadId) issues.push('missing_thread_start');
  if (openTurn) issues.push('unfinished_turn');
  if (!reported.length) issues.push('no_completed_turn_usage');
  if (startedTurns !== reported.length) issues.push('unmatched_turn_count');
  if (options.exitCode !== 0 || options.signal || options.timedOut || options.cancelled) issues.push('process_not_successfully_completed');
  if (options.captureComplete === false || options.spawnError || options.captureError || options.cleanupError) issues.push('process_capture_incomplete');
  if (options.subagents !== 'disabled') issues.push('single_agent_configuration_not_confirmed');
  if (reported.length > 1 && options.usageSemantics !== 'per-turn-delta') issues.push('multiple_turn_usage_semantics_unverified');
  const complete = issues.length === 0;
  const sum = (field) => reported.length && reported.every((row) => row.values[field] !== null)
    ? reported.reduce((total, row) => total + row.values[field], 0) : null;
  const observed = Object.fromEntries(Object.keys(FIELDS).map((field) => [field, reported.length > 1 && options.usageSemantics !== 'per-turn-delta' ? null : sum(field)]));
  const provenance = { format: 'codex-exec-json', eventsPath: path.resolve(eventsPath), eventsSha256: sha256(bytes),
    threadId, completedTurns: reported.length, coverage: complete ? 'completed-single-agent-trial' : 'incomplete-or-unverified',
    usageSemantics: reported.length <= 1 ? 'single-completed-turn' : options.usageSemantics ?? null,
    issues, process: { exitCode: options.exitCode ?? null, signal: options.signal ?? null, timedOut: !!options.timedOut, cancelled: !!options.cancelled } };
  const record = { condition: identity.condition, trial: identity.trial, corpusHash: identity.corpusHash,
    source: 'harness', scope: 'trial-total', model: identity.model ?? null, provenance,
    ...Object.fromEntries(Object.keys(FIELDS).map((field) => [field, complete ? observed[field] : null])) };
  const usage = normalizeUsage([record]);
  return { usage, audit: { schemaVersion: 1, ...provenance, complete, reported, observed,
    limits: 'Raw completed-turn usage is preserved. Missing values stay unknown. Cached/reasoning subtotals are not added to totals; total tokens and cost are never derived. Tool payloads and answers are not model usage. Failure or incomplete capture prevents a trial-total claim.' } };
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  const allowed = ['events', 'identity', 'process', 'output', 'audit', 'usage-semantics'];
  while (args.length) {
    const name = args.shift();
    if (!name.startsWith('--') || !allowed.includes(name.slice(2)) || !args.length) throw new Error('Invalid usage importer arguments');
    options[name.slice(2)] = args.shift();
  }
  if (!['events', 'identity', 'process', 'output', 'audit'].every((name) => options[name])) throw new Error('Usage: import-history-codex-usage.js --events <jsonl> --identity <json> --process <json> --output <new-tmp-json> --audit <new-tmp-json>');
  const result = importUsage(options.events, JSON.parse(fs.readFileSync(options.identity, 'utf8')),
    { ...JSON.parse(fs.readFileSync(options.process, 'utf8')), usageSemantics: options['usage-semantics'] });
  for (const [name, value] of [['output', result.usage], ['audit', result.audit]]) {
    const target = privateTarget(options[name]); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify({ complete: result.audit.complete, issues: result.audit.issues })}\n`);
}

if (require.main === module) mainGuard(main);
module.exports = { importUsage };
