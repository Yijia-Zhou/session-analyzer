'use strict';

const { setImmediate: yieldToLoop } = require('node:timers/promises');

const YIELD_BYTES = 1024 * 1024;
const PART_CODE_UNITS = 128 * 1024;

// Collapse only JS RegExp whitespace, so the literal phrase has a fixed UTF-16
// width. This avoids an unbounded overlap for a phrase spanning a long \s+ run.
function phrasePattern(query) {
  const phrase = String(query || '').trim().split(/\s+/).join(' ');
  if (!phrase) return null;
  return { width: phrase.length, regex: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') };
}

async function searchOne(parts, pattern, signal) {
  const { width, regex } = pattern;
  let buffer = '';
  let base = 0;
  let nextStart = 0;
  let count = 0;
  let endedInWhitespace = false;
  let bytesSinceYield = 0;
  let first = -1;
  let snippet = '';
  let snippetComplete = false;

  const scan = (final = false) => {
    const end = base + buffer.length;
    regex.lastIndex = nextStart - base;
    let match;
    while ((match = regex.exec(buffer))) {
      count += 1;
      if (first < 0) first = base + match.index;
      nextStart = base + regex.lastIndex;
    }
    nextStart = Math.max(nextStart, end - width + 1);
    if (first >= 0 && !snippetComplete && (final || end > first + 180)) {
      const start = Math.max(0, first - 80);
      const stop = Math.min(end, first + 180);
      snippet = `${start > 0 ? '...' : ''}${buffer.slice(start - base, stop - base).trim()}${stop < end ? '...' : ''}`;
      snippetComplete = true;
    }
    let retainFrom = Math.max(0, nextStart - 80);
    if (first >= 0 && !snippetComplete) retainFrom = Math.min(retainFrom, Math.max(0, first - 80));
    buffer = buffer.slice(retainFrom - base);
    base = retainFrom;
  };

  for await (const part of parts) {
    signal?.throwIfAborted?.();
    if (typeof part !== 'string') throw new TypeError('Search text parts must be decoded strings');
    for (let offset = 0; offset < part.length; offset += PART_CODE_UNITS) {
      const source = part.slice(offset, offset + PART_CODE_UNITS);
      let normalized = source.replace(/\s+/g, ' ');
      if (endedInWhitespace && normalized.startsWith(' ')) normalized = normalized.slice(1);
      endedInWhitespace = /\s$/.test(source);
      buffer += normalized;
      scan();
      bytesSinceYield += Buffer.byteLength(source, 'utf8');
      if (bytesSinceYield >= YIELD_BYTES) {
        bytesSinceYield = 0;
        await yieldToLoop();
        signal?.throwIfAborted?.();
      }
    }
  }
  signal?.throwIfAborted?.();
  scan(true);
  return { count, hit: count > 0, snippet };
}

async function searchTextParts(previewParts, searchParts, query, signal) {
  signal?.throwIfAborted?.();
  const pattern = phrasePattern(query);
  if (!pattern) return { count: 0, hit: false, snippet: '' };
  const preview = await searchOne(previewParts, pattern, signal);
  const search = await searchOne(searchParts, pattern, signal);
  return {
    count: Math.max(preview.count, search.count),
    hit: preview.hit || search.hit,
    snippet: preview.snippet || search.snippet,
  };
}

module.exports = { searchTextParts };
