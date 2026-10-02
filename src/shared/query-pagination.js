'use strict';

function paginationInteger(value, name, fallback, minimum = 0) {
  if (value === undefined || value === null) return fallback;
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < minimum) {
    const error = new Error(`${name} must be a ${minimum ? 'positive' : 'non-negative'} safe integer`);
    error.code = 'INVALID_PAGINATION';
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function queryPagination(values = {}, defaultLimit = 150, maximumLimit = 500) {
  return {
    offset: paginationInteger(values.offset, 'offset', 0),
    limit: Math.min(maximumLimit, paginationInteger(values.limit, 'limit', defaultLimit, 1)),
  };
}

function requireQueryRevision(value, indexRevision) {
  if (value === undefined || value === null) return;
  if (paginationInteger(value, 'indexRevision', undefined, 1) === indexRevision) return;
  const error = new Error('Index revision retired; reload and retry');
  error.code = 'INDEX_REVISION_RETIRED';
  error.statusCode = 409;
  throw error;
}

module.exports = { paginationInteger, queryPagination, requireQueryRevision };
