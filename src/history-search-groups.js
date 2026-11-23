'use strict';

const { createHash } = require('node:crypto');
const FIELDS = new Set(['id', 'query', 'queries', 'exclude', 'layer', 'kind', 'status', 'tool', 'file', 'from', 'to', 'retrievalArtifacts', 'limit', 'maxBytes', 'cursor', 'order', 'session']);
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
function fail(message) { throw Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' }); }

function validateGroups(groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 8) fail('groups must contain 1..8 independent queries');
  const ids = new Set();
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) fail('Each group must be an object');
    if (typeof group.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(group.id) || ids.has(group.id)) fail('Each group requires a unique id (1..64 letters, digits, underscores or hyphens)');
    ids.add(group.id);
    for (const key of Object.keys(group)) if (!FIELDS.has(key)) fail(`Unknown group field: ${key}`);
    if (group.query !== undefined && group.queries !== undefined) fail('Use query or queries in each group, not both');
    const terms = group.queries ?? (group.query !== undefined ? [group.query] : []);
    if (!Array.isArray(terms) || !terms.length || terms.length > 20 || terms.some((s) => typeof s !== 'string' || !s.trim() || s.length > 4096)) fail('Each group requires 1..20 nonempty literal queries (4096 characters each)');
    for (const key of ['limit', 'maxBytes']) {
      const [min, max] = key === 'limit' ? [1, 100] : [4096, 1048576];
      if (group[key] !== undefined && (!Number.isSafeInteger(group[key]) || group[key] < min || group[key] > max)) fail(`Invalid group ${key}`);
    }
  }
  return groups;
}

async function groupedSearch({ input, response, maxBytes, search, project = (value) => value }) {
  const groups = validateGroups(input.groups);
  const identities = groups.map(({ id, cursor, limit, maxBytes: ignored, ...query }) => createHash('sha256')
    .update(JSON.stringify([id, Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))]))
    .digest('base64url').slice(0, 22));
  const resume = (group, cursor) => ({ contextRef: response.contextRef, presentation: input.presentation || 'compact', maxBytes,
    groups: [{ ...group, ...(cursor == null ? {} : { cursor }) }] });
  response.groups = groups.map((group, i) => ({ id: group.id, queryIdentity: identities[i], state: 'not_executed',
    scan: { complete: false }, items: [], hasMore: null, nextCursor: null, truncated: false }));
  const completed = new Array(groups.length);
  const metadataError = () => Object.assign(new Error('Group metadata exceeds top-level maxBytes (UTF-8 JSON bytes). Increase top-level maxBytes (up to 1048576), request fewer groups, or use presentation=compact with the current contextRef.'), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
  const finalize = () => {
    response.scan = { complete: response.groups.every((group) => group.scan.complete), executedGroups: response.groups.filter((group) => group.state !== 'not_executed').length };
    response.hasMore = response.groups.some((group) => group.state !== 'complete' || group.hasMore);
    response.truncated = response.groups.some((group) => group.state !== 'complete' || group.truncated);
    return bytes(project(response));
  };
  const omit = (i, result) => ({ id: groups[i].id, queryIdentity: identities[i], state: 'results_omitted',
    scan: result.scan, items: [], hasMore: result.scan.matchedEvents > 0, nextCursor: null,
    truncated: true, reason: 'batch_output_budget', resumeCursor: groups[i].cursor ?? null,
    next: resume(groups[i], groups[i].cursor), ...(result.queryWarnings ? { queryWarnings: result.queryWarnings } : {}) });
  for (let i = 0; i < groups.length; i += 1) {
    // Retain the bounded completed groups until final admission. Do not reserve
    // hypothetical retries for later groups that may complete without one.
    const beforeBytes = finalize();
    if (maxBytes - beforeBytes < 1024) {
      continue;
    }
    const { id, ...query } = groups[i];
    const result = await search({ ...query, limit: query.limit ?? 4, maxBytes: query.maxBytes ?? 8000 }, id);
    const candidate = { id, queryIdentity: identities[i], state: 'complete', scan: result.scan,
      items: result.items, hasMore: result.hasMore, nextCursor: result.nextCursor,
      next: result.hasMore ? resume(groups[i], result.nextCursor) : null, truncated: result.truncated,
      ...(result.queryWarnings ? { queryWarnings: result.queryWarnings } : {}) };
    completed[i] = candidate;
    response.groups[i] = candidate;
    const candidateBytes = finalize();
    if (candidateBytes > maxBytes) {
      response.groups[i] = omit(i, result);
      if (finalize() >= candidateBytes) response.groups[i] = candidate;
    }
  }
  for (let i = 0; i < groups.length; i += 1) {
    if (response.groups[i].state === 'not_executed') Object.assign(response.groups[i], {
      reason: 'batch_output_budget', next: resume(groups[i], groups[i].cursor) });
  }
  // Now every actual continuation is known. Omit only entire result groups,
  // preserving scans and original-page retries. Compare the full projected
  // envelope: handle compression or full fallback can change size ordering.
  for (let i = response.groups.length - 1; i >= 0 && finalize() > maxBytes; i -= 1) {
    if (response.groups[i].state !== 'complete') continue;
    const candidate = response.groups[i];
    const beforeBytes = finalize();
    response.groups[i] = omit(i, candidate);
    if (finalize() >= beforeBytes) response.groups[i] = candidate;
  }
  // A later completed query may have removed a large retry input. Re-admit
  // earlier results when they now fit, without running any query a second time.
  for (let i = 0; i < completed.length; i += 1) {
    if (!completed[i] || response.groups[i].state === 'complete') continue;
    const omitted = response.groups[i];
    response.groups[i] = completed[i];
    if (finalize() > maxBytes) response.groups[i] = omitted;
  }
  if (finalize() > maxBytes) throw metadataError();
  return response;
}

module.exports = { groupedSearch, validateGroups };
