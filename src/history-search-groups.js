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

async function groupedSearch({ input, response, maxBytes, search }) {
  const groups = validateGroups(input.groups);
  const identities = groups.map(({ id, cursor, limit, maxBytes: ignored, ...query }) => createHash('sha256')
    .update(JSON.stringify([id, Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))]))
    .digest('base64url').slice(0, 22));
  response.groups = groups.map((group, i) => ({ id: group.id, queryIdentity: identities[i], state: 'not_executed',
    scan: { complete: false }, items: [], hasMore: null, nextCursor: null, truncated: false }));
  if (bytes(response) > maxBytes) throw Object.assign(new Error('Group metadata exceeds maxBytes'), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
  for (let i = 0; i < groups.length; i += 1) {
    if (maxBytes - bytes(response) < 1024) {
      response.groups[i].reason = 'batch_output_budget';
      continue;
    }
    const { id, ...query } = groups[i];
    const result = await search({ ...query, limit: query.limit ?? 4, maxBytes: query.maxBytes ?? 8000 }, id);
    const candidate = { id, queryIdentity: identities[i], state: 'complete', scan: result.scan,
      items: result.items, hasMore: result.hasMore, nextCursor: result.nextCursor, truncated: result.truncated,
      ...(result.queryWarnings ? { queryWarnings: result.queryWarnings } : {}) };
    const previous = response.groups[i];
    response.groups[i] = candidate;
    if (bytes(response) > maxBytes) {
      response.groups[i] = { ...previous, state: 'results_omitted', scan: result.scan, hasMore: result.scan.matchedEvents > 0,
        truncated: true, reason: 'batch_output_budget', resumeCursor: query.cursor ?? null,
        ...(result.queryWarnings ? { queryWarnings: result.queryWarnings } : {}) };
    }
  }
  response.scan = { complete: response.groups.every((group) => group.scan.complete), executedGroups: response.groups.filter((group) => group.state !== 'not_executed').length };
  response.hasMore = response.groups.some((group) => group.state !== 'complete' || group.hasMore);
  response.truncated = response.groups.some((group) => group.state !== 'complete' || group.truncated);
  if (bytes(response) > maxBytes) throw Object.assign(new Error('Group metadata exceeds maxBytes'), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
  return response;
}

module.exports = { groupedSearch, validateGroups };
