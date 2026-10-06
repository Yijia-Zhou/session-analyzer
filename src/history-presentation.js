'use strict';

const { randomBytes } = require('node:crypto');

function failure(code, message) { throw Object.assign(new Error(message), { code }); }

// Handles belong to one fixed service context. They never authorize file access.
function createHistoryPresentation(contextRef) {
  const namespace = randomBytes(8).toString('base64url');
  const byEvidence = new Map();
  const byHandle = new Map();
  function handle(value) {
    if (!byEvidence.has(value)) {
      if (byEvidence.size >= 50000) failure('HANDLE_LIMIT_REACHED', 'Use presentation=full or restart and search again');
      const id = `hr1.${namespace}.${byEvidence.size.toString(36)}`;
      byEvidence.set(value, id);
      byHandle.set(id, value);
    }
    return byEvidence.get(value);
  }
  function resolve(value, suppliedContext) {
    if (typeof value !== 'string' || !value.startsWith('hr1.')) return value;
    if (suppliedContext !== contextRef) failure('CONTEXT_REQUIRED', 'Short handles require their returned contextRef');
    if (!byHandle.has(value)) failure('INVALID_REFERENCE', 'Unknown or expired short handle; search again');
    return byHandle.get(value);
  }
  function project(response, input) {
    if (input.presentation !== 'compact') return response;
    const result = structuredClone(response);
    result.presentation = 'compact';
    if (input.contextRef === contextRef && response.operation !== 'history.status') {
      delete result.coverage;
      delete result.warnings;
      result.coverageRef = contextRef;
    }
    if (response.operation === 'history.context') {
      const unique = new Map();
      result.events = [];
      for (const window of result.items) {
        window.eventIndexes = [];
        window.anchorIndexes = [];
        for (const event of window.events) {
          const { anchor, ...body } = event;
          // Same event with a different hit excerpt remains separately readable.
          const key = JSON.stringify(body);
          if (!unique.has(key)) {
            unique.set(key, result.events.length);
            result.events.push(body);
          }
          const at = unique.get(key);
          window.eventIndexes.push(at);
          if (anchor) window.anchorIndexes.push(at);
        }
        delete window.events;
      }
    }
    // Rewrite only protocol reference fields, never strings inside historical text.
    function visit(value, key) {
      if (typeof value === 'string' && ['ref', 'previous', 'next', 'rawRefs'].includes(key)
          && /^er[12]\./u.test(value)) return handle(value);
      if (Array.isArray(value)) return value.map((entry) => visit(entry, key));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
      return value;
    }
    const output = visit(result);
    if (response.operation === 'history.read') {
      output.items.forEach((item, i) => { item.evidenceRef = response.items[i].ref; });
    }
    return output;
  }
  return { project, resolve, clear() { byEvidence.clear(); byHandle.clear(); } };
}

function detailText(sections) {
  const seen = new Set();
  const payload = (section) => typeof section.code === 'string' ? section.code
    : typeof section.text === 'string' ? section.text
      : section.type === 'json' ? JSON.stringify(section.value, null, 2) : undefined;
  return sections.flatMap((section) => {
    const text = payload(section);
    if (text === undefined) return [JSON.stringify(section)]; // Unsupported renderers remain explicit JSON.
    // Only the adapter's explicit summary/full pair may omit a differing title.
    // Identical stdout and stderr, or separately titled facts, are not duplicates.
    const fullTitle = ({ 'Request summary': 'Request', 'Response summary': 'Response' })[section.title];
    if (fullTitle && sections.some((other) => other.title === fullTitle && payload(other) === text
        && ['type', 'purpose', 'role', 'stream', 'level'].every((key) => other[key] === section[key]))) return [];
    const identity = JSON.stringify(section);
    if (seen.has(identity)) return [];
    seen.add(identity);
    const labels = [section.title, ...['stream', 'role', 'level'].flatMap((key) => section[key] ? [`${key}=${section[key]}`] : [])].filter(Boolean);
    return [(labels.length ? `[${labels.join('; ')}]\n` : '') + text];
  }).join('\n\n');
}

module.exports = { createHistoryPresentation, detailText };
