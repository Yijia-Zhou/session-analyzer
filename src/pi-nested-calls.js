'use strict';

const { sanitizeLogicalDetailValue } = require('./shared/logical-detail-sanitizer');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value) => sanitizeLogicalDetailValue(value, { maxDepth: 16, maxNodes: 500, maxArrayItems: 64, maxObjectEntries: 64 });
const notice = (text) => ({ type: 'notice', purpose: 'context', level: 'info', text });
const kv = (title, entries) => ({ type: 'kv', purpose: 'context', title,
  entries: entries.map(([key, value]) => ({ key, value: String(value) })) });
const MAX_VISIBLE_CALLS = 24;

// pi 1.4.0 NestedToolCalls is a receipt owned by one outer tool result.
// Its status is evidence, not a separate operation/result or a replay graph.
function nestedCallSections(value) {
  if (!object(value) || !Array.isArray(value.calls) || typeof value.complete !== 'boolean'
      || !value.calls.every((call) => object(call) && typeof call.id === 'string' && call.id
        && typeof call.name === 'string' && call.name && ['ok', 'error', 'unfinished'].includes(call.status))) return null;
  const counts = { ok: 0, error: 0, unfinished: 0 };
  for (const call of value.calls) counts[call.status]++;
  const sections = [kv('Recorded nested calls', [['Recorded calls', value.calls.length],
    ['Succeeded', counts.ok], ['Failed', counts.error], ['Unfinished', counts.unfinished],
    ['Source receipt complete', value.complete]]),
  notice(value.complete
    ? 'The source marks this receipt complete. Nested result payloads are not recorded; statuses below are the recorded outcomes.'
    : 'This receipt is incomplete: calls or arguments may be omitted, or calls may be unfinished. Nested result payloads are not recorded.')];
  for (const [index, call] of value.calls.slice(0, MAX_VISIBLE_CALLS).entries()) {
    const entries = [['Call id', call.id], ['Tool', call.name], ['Recorded status', call.status]];
    if (Number.isFinite(call.durationMs) && call.durationMs >= 0) entries.push(['Duration (ms)', call.durationMs]);
    if (Number.isSafeInteger(call.argumentsBytes) && call.argumentsBytes >= 0) entries.push(['Recorded argument bytes', call.argumentsBytes]);
    if (typeof call.error === 'string' && call.error) entries.push(['Recorded error', call.error]);
    sections.push(kv(`Nested call ${index + 1}`, entries));
    if (object(call.arguments)) sections.push({ type: 'json', purpose: 'context', title: `Nested call ${index + 1}: recorded arguments`, value: bounded(call.arguments) });
    else sections.push(notice(Object.hasOwn(call, 'arguments')
      ? `Nested call ${index + 1}: arguments have an unsupported shape; see Raw references.`
      : `Nested call ${index + 1}: arguments were not recorded.`));
  }
  if (value.calls.length > MAX_VISIBLE_CALLS) sections.push(notice(`Showing ${MAX_VISIBLE_CALLS} of ${value.calls.length} recorded calls. Remaining calls are available in Raw references; this display limit does not change the source completeness flag.`));
  return sections;
}

module.exports = { nestedCallSections };
