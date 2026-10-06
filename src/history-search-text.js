'use strict';

// Query storage supplies either a string or a replayable, decoded parts source.
// Never coerce a lazy source to String or concatenate all of its parts.
function* textParts(text) {
  if (typeof text === 'string') {
    for (let i = 0; i < text.length; i += 16384) yield text.slice(i, i + 16384);
  } else if (text && typeof text.parts === 'function') {
    yield* text.parts();
  } else if (text != null) throw new TypeError('Expected search text or decoded text parts');
}

function* characters(text) {
  let high = '';
  let offset = 0;
  for (const part of textParts(text)) {
    if (typeof part !== 'string') throw new TypeError('Search text parts must be decoded strings');
    let value = high + part;
    high = '';
    if (/[\uD800-\uDBFF]$/u.test(value)) { high = value.slice(-1); value = value.slice(0, -1); }
    for (const character of value) {
      yield { character, offset };
      offset += character.length;
    }
  }
  if (high) yield { character: high, offset };
}

const normalize = (text) => text.toLowerCase().replace(/\s+/gu, ' ').trim();

// Default Unicode lowercasing has one contextual mapping: final sigma. A
// second forward-only cursor supplies lookahead even across arbitrarily long
// Case_Ignorable runs, without retaining the intervening text.
function* normalizedChunks(text) {
  let lookahead;
  let ahead;
  let precededByCased = false;
  let hasContent = false;
  let space = null;
  let value = '';
  let offsets = [];
  function followedByCased(offset) {
    lookahead ||= characters(text);
    while (!ahead || (!ahead.done && ahead.value.offset <= offset)) ahead = lookahead.next();
    while (!ahead.done && /\p{Case_Ignorable}/u.test(ahead.value.character)) ahead = lookahead.next();
    return !ahead.done && /\p{Cased}/u.test(ahead.value.character);
  }
  for (const { character, offset } of characters(text)) {
    let lower = character.toLowerCase();
    if (character === 'Σ' && precededByCased && !followedByCased(offset)) lower = 'ς';
    if (!/\p{Case_Ignorable}/u.test(character)) precededByCased = /\p{Cased}/u.test(character);
    if (/\s/u.test(character)) {
      if (hasContent && space === null) space = offset;
      continue;
    }
    if (space !== null) { value += ' '; offsets.push(space); space = null; }
    value += lower;
    for (let i = 0; i < lower.length; i += 1) offsets.push(offset);
    hasContent = true;
    if (value.length >= 16384) { yield { value, offsets }; value = ''; offsets = []; }
  }
  if (value) yield { value, offsets };
}

function matchText(text, queries = [], exclude = []) {
  if (!queries.length && !exclude.length) return { matched: true, terms: [], hitOffset: 0 };
  const patterns = [...queries, ...exclude].map(normalize);
  const found = patterns.map((pattern) => pattern ? -1 : 0);
  const overlap = Math.max(0, ...patterns.map((pattern) => pattern.length - 1));
  let tail = '';
  let positions = [];
  for (const chunk of normalizedChunks(text)) {
    const value = tail + chunk.value;
    const offsets = positions.concat(chunk.offsets);
    for (let i = 0; i < patterns.length; i += 1) {
      if (found[i] >= 0) continue;
      const at = value.indexOf(patterns[i]);
      if (at >= 0) found[i] = offsets[at];
    }
    if (found.slice(queries.length).some((offset) => offset >= 0)) return { matched: false, terms: [], hitOffset: 0 };
    if (found.every((offset) => offset >= 0)) break;
    tail = overlap ? value.slice(-overlap) : '';
    positions = overlap ? offsets.slice(-overlap) : [];
  }
  const hits = found.slice(0, queries.length);
  return {
    matched: (!queries.length || hits.some((offset) => offset >= 0)) && found.slice(queries.length).every((offset) => offset < 0),
    terms: queries.filter((_, i) => hits[i] >= 0),
    hitOffset: hits.some((offset) => offset >= 0) ? Math.min(...hits.filter((offset) => offset >= 0)) : 0,
  };
}

function containsText(text, needle) {
  if (!needle) return true;
  let tail = '';
  for (const part of textParts(text)) {
    const value = tail + part;
    if (value.includes(needle)) return true;
    tail = needle.length > 1 ? value.slice(-(needle.length - 1)) : '';
  }
  return false;
}

// Preserve seven projection lines and UTF-16 coordinates while retaining only
// 360 code units per ordinary line and one bounded window around the hit.
function excerptText(text, hitOffset = 0) {
  let absolute = 0;
  let lineStart = 0;
  let lineNumber = 1;
  let length = 0;
  let last = '';
  let prefix = '';
  let window = '';
  let previous = [];
  let selected = [];
  let hitLine = null;
  const append = (piece) => {
    const crop = Math.max(0, hitOffset - lineStart - 80);
    prefix += piece.slice(0, Math.max(0, 360 - prefix.length));
    const start = Math.max(0, crop - length);
    const end = Math.min(piece.length, crop + 360 - length);
    if (end > start) window += piece.slice(start, end);
    length += piece.length;
    if (piece.length) last = piece.at(-1);
  };
  const finishLine = (newline) => {
    const lineLength = length - (newline && last === '\r' ? 1 : 0);
    const isHit = hitLine === null && hitOffset <= lineStart + length;
    const crop = isHit ? Math.max(0, hitOffset - lineStart - 80) : 0;
    const rendered = lineLength <= 360 ? prefix.slice(0, lineLength)
      : `${crop ? '…' : ''}${isHit ? window.slice(0, lineLength - crop) : prefix}…`;
    const row = { number: lineNumber, text: rendered, clipped: lineLength > 360 };
    if (isHit) { hitLine = lineNumber; selected = [...previous, row]; }
    else if (hitLine !== null && lineNumber <= hitLine + 3) selected.push(row);
    if (hitLine === null) { previous.push(row); if (previous.length > 3) previous.shift(); }
    lineNumber += 1;
    lineStart += length + (newline ? 1 : 0);
    length = 0; last = ''; prefix = ''; window = '';
  };
  for (const part of textParts(text)) {
    let start = 0;
    let end;
    while ((end = part.indexOf('\n', start)) >= 0) {
      append(part.slice(start, end)); finishLine(true); start = end + 1;
    }
    append(part.slice(start));
    absolute += part.length;
  }
  finishLine(false);
  if (!selected.length) throw new RangeError(`Excerpt offset ${hitOffset} exceeds text length ${absolute}`);
  return { representation: 'search_projection', startLine: selected[0].number, endLine: selected.at(-1).number,
    hitOffset, text: selected.map((row) => row.text).join('\n'),
    truncated: selected[0].number > 1 || selected.at(-1).number < lineNumber - 1 || selected.some((row) => row.clipped) };
}

module.exports = { matchText, containsText, excerptText };
