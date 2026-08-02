'use strict';

const DATA_URL_MARKER = '[embedded data URL omitted; see raw refs]';
const EMBEDDED_BASE64_MARKER = '[embedded base64 payload omitted; see raw refs]';
const LARGE_VALUE_MARKER = '[large detail value omitted; see raw refs]';
const NESTED_VALUE_MARKER = '[nested detail value omitted; see raw refs]';
const ADDITIONAL_VALUE_MARKER = '[additional detail value omitted; see raw refs]';

function highConfidenceBase64Continuation(token) {
  const value = String(token || '');
  const hasLetters = /[a-z]/i.test(value);
  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  const uppercaseToken = hasLetters && !hasLowercase;
  const percentEncodedToken = /%[0-9a-f]{2}/i.test(value);
  const symbolOrNumericToken = !hasLetters && /^[0-9+\/_=-]+$/.test(value);
  const validBase64Token = /^[a-z0-9+\/_=-]+$/i.test(value);
  const longEncodedToken = validBase64Token
    && value.length >= 16
    && ((hasLowercase && hasUppercase) || /[0-9+\/=]/.test(value));
  return uppercaseToken || percentEncodedToken || symbolOrNumericToken || longEncodedToken;
}

function structurallyValidBase64Span(source, start, end) {
  let encodedLength = 0;
  let paddingLength = 0;
  let sawPadding = false;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (/\s/.test(character)) continue;
    encodedLength += 1;
    if (character === '=') {
      sawPadding = true;
      paddingLength += 1;
      if (paddingLength > 2) return false;
      continue;
    }
    if (sawPadding || !/[a-z0-9+\/_-]/i.test(character)) return false;
  }
  return encodedLength >= 4 && encodedLength % 4 === 0;
}

function wrappedBase64RunEnd(source, payloadStart, whitespaceStart) {
  let cursor = whitespaceStart;
  let candidateEnd = whitespaceStart;
  let sawWrappedChunk = false;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    let tokenStart = cursor;
    while (tokenStart < source.length && /\s/.test(source[tokenStart])) tokenStart += 1;
    const whitespace = source.slice(cursor, tokenStart);
    if (!/[^ ]/.test(whitespace)) break;
    let tokenEnd = tokenStart;
    while (tokenEnd < source.length && !/[\s"'<>`()\[\]{}]/.test(source[tokenEnd])) tokenEnd += 1;
    if (tokenEnd === tokenStart) break;
    const token = source.slice(tokenStart, tokenEnd);
    if (!/^[a-z0-9+\/_=-]+$/i.test(token)) break;
    sawWrappedChunk = true;
    candidateEnd = tokenEnd;
    cursor = tokenEnd;
  }
  return sawWrappedChunk && structurallyValidBase64Span(source, payloadStart, candidateEnd)
    ? candidateEnd
    : whitespaceStart;
}

function embeddedBase64PayloadEnd(source, start) {
  let index = start;
  let malformed = false;
  while (index < source.length) {
    if (/["'<>`()\[\]{}]/.test(source[index])) break;
    if (/\s/.test(source[index])) {
      if (malformed) break;
      let next = index;
      while (next < source.length && /\s/.test(source[next])) next += 1;
      const whitespace = source.slice(index, next);
      const wrappedRunEnd = wrappedBase64RunEnd(source, start, index);
      if (wrappedRunEnd > index) {
        index = wrappedRunEnd;
        continue;
      }
      let tokenEnd = next;
      while (tokenEnd < source.length && !/[\s"'<>`()\[\]{}]/.test(source[tokenEnd])) tokenEnd += 1;
      if (tokenEnd === next) break;
      const token = source.slice(next, tokenEnd);
      const validBase64Token = /^[a-z0-9+/=_-]+$/i.test(token);
      const wrappedFinalToken = /[^ ]/.test(whitespace)
        && validBase64Token
        && tokenEnd < source.length
        && /["'<>`()\[\]{}]/.test(source[tokenEnd]);
      if (!highConfidenceBase64Continuation(token) && !wrappedFinalToken) return index;
      index = tokenEnd;
      if (!validBase64Token) malformed = true;
      continue;
    }
    if (!/[a-z0-9+/=_-]/i.test(source[index])) malformed = true;
    index += 1;
  }
  return index;
}

function redactEmbeddedBase64DataUrls(value, headerPattern, marker, prefixGroup = 0) {
  const source = String(value || '');
  let cursor = 0;
  let redacted = '';
  headerPattern.lastIndex = 0;
  for (let match = headerPattern.exec(source); match; match = headerPattern.exec(source)) {
    redacted += source.slice(cursor, match.index);
    if (prefixGroup) redacted += match[prefixGroup];
    redacted += marker;
    cursor = embeddedBase64PayloadEnd(source, headerPattern.lastIndex);
    headerPattern.lastIndex = cursor;
  }
  return cursor ? redacted + source.slice(cursor) : source;
}

function embeddedNonBase64PayloadEnd(source, start) {
  let index = start;
  while (index < source.length) {
    if (/["'<>]/.test(source[index]) || source.charCodeAt(index) === 96) break;
    if (!/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    const whitespaceStart = index;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    const whitespace = source.slice(whitespaceStart, index);
    // A literal space starts ordinary prose. Across other whitespace, continue
    // only for high-confidence encoded or uppercase tokens. Lowercase prose wins
    // over common punctuation so paths, snake_case, and URLs stay searchable.
    if (!/[^ ]/.test(whitespace)) return whitespaceStart;
    let tokenEnd = index;
    while (tokenEnd < source.length && !/[\s"'<>]/.test(source[tokenEnd])
      && source.charCodeAt(tokenEnd) !== 96) tokenEnd += 1;
    const continuation = source.slice(index, tokenEnd);
    const hasLetters = /[a-z]/i.test(continuation);
    const hasLowercase = /[a-z]/.test(continuation);
    const uppercaseToken = hasLetters && !hasLowercase;
    const percentEncodedToken = /%[0-9a-f]{2}/i.test(continuation);
    const symbolOrNumericToken = !hasLetters && /^[0-9+\/=_-]+$/.test(continuation);
    if (!continuation || (!percentEncodedToken && !uppercaseToken && !symbolOrNumericToken)) {
      return whitespaceStart;
    }
  }
  return index;
}

function redactEmbeddedNonBase64DataUrls(value, marker) {
  const source = String(value || '');
  const headerPattern = /(^|[^a-z0-9_])data:[^,\s"'<>\x60]*,/gi;
  let cursor = 0;
  let redacted = '';
  headerPattern.lastIndex = 0;
  for (let match = headerPattern.exec(source); match; match = headerPattern.exec(source)) {
    redacted += source.slice(cursor, match.index);
    redacted += match[1];
    redacted += marker;
    cursor = embeddedNonBase64PayloadEnd(source, headerPattern.lastIndex);
    headerPattern.lastIndex = cursor;
  }
  return cursor ? redacted + source.slice(cursor) : source;
}

function redactEmbeddedDataUrls(value, marker = DATA_URL_MARKER) {
  const source = String(value || '');
  if (!/data:/i.test(source)) return source;
  const standaloneHeader = /^\s*data:([^,\s"'<>`]*),/i.exec(source);
  if (standaloneHeader && !/(?:^|;)base64(?:;|$)/i.test(standaloneHeader[1])) return marker;
  const base64Redacted = redactEmbeddedBase64DataUrls(
    source,
    /(^|[^a-z0-9_])data:[^,\s"'<>`]*;base64,/gi,
    marker,
    1,
  );
  return redactEmbeddedNonBase64DataUrls(base64Redacted, marker);
}

function uniqueSanitizedObjectKey(key, usedKeys, marker = DATA_URL_MARKER) {
  const sanitized = redactEmbeddedDataUrls(key, marker);
  if (!usedKeys.has(sanitized)) {
    usedKeys.add(sanitized);
    return sanitized;
  }
  let suffix = 2;
  while (usedKeys.has(`${sanitized} #${suffix}`)) suffix += 1;
  const unique = `${sanitized} #${suffix}`;
  usedKeys.add(unique);
  return unique;
}

function finiteLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function sanitizerState(options) {
  const limits = {
    maxStringChars: finiteLimit(options.maxStringChars),
    maxTotalStringChars: finiteLimit(options.maxTotalStringChars),
    maxDepth: finiteLimit(options.maxDepth),
    maxNodes: finiteLimit(options.maxNodes),
    maxArrayItems: finiteLimit(options.maxArrayItems),
    maxObjectEntries: finiteLimit(options.maxObjectEntries),
  };
  if (!Object.values(limits).some((limit) => limit != null)) return null;
  return {
    ...limits,
    remainingStringChars: limits.maxTotalStringChars,
    nodes: 0,
    marker: options.largeValueMarker || LARGE_VALUE_MARKER,
    nestedMarker: options.nestedValueMarker || NESTED_VALUE_MARKER,
    additionalMarker: options.additionalValueMarker || ADDITIONAL_VALUE_MARKER,
  };
}

function boundedText(value, state) {
  if (!state) return value;
  const available = Math.min(
    state.maxStringChars == null ? Number.POSITIVE_INFINITY : state.maxStringChars,
    state.remainingStringChars == null ? Number.POSITIVE_INFINITY : state.remainingStringChars,
  );
  if (value.length <= available) {
    if (state.remainingStringChars != null) state.remainingStringChars -= value.length;
    return value;
  }
  const prefix = available > 0 ? value.slice(0, available).trimEnd() : '';
  if (state.remainingStringChars != null) state.remainingStringChars = Math.max(0, state.remainingStringChars - Math.max(0, available));
  return prefix ? `${prefix}\n${state.marker}` : state.marker;
}

function uniqueBoundedObjectKey(key, usedKeys, marker, state) {
  const sanitized = boundedText(redactEmbeddedDataUrls(key, marker), state);
  if (!usedKeys.has(sanitized)) {
    usedKeys.add(sanitized);
    return sanitized;
  }
  let suffix = 2;
  while (usedKeys.has(`${sanitized} #${suffix}`)) suffix += 1;
  const unique = `${sanitized} #${suffix}`;
  usedKeys.add(unique);
  return unique;
}

function omitObjectKey(options, key) {
  return options.omitObjectKeys?.has?.(key) === true;
}

function sanitizeLogicalDetailValue(value, options = {}, seen = new WeakMap(), state = undefined, depth = 0) {
  const marker = options.marker || DATA_URL_MARKER;
  const embeddedBase64Marker = options.embeddedBase64Marker || EMBEDDED_BASE64_MARKER;
  const activeState = state === undefined ? sanitizerState(options) : state;
  if (typeof value === 'string') {
    if (options.previewSources?.has(value)) return boundedText('[embedded image available in preview]', activeState);
    return boundedText(redactEmbeddedDataUrls(value, marker), activeState);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular value omitted]';
  if (activeState && activeState.maxNodes != null && activeState.nodes >= activeState.maxNodes) return activeState.additionalMarker;
  if (activeState) activeState.nodes += 1;
  if (activeState && activeState.maxDepth != null && depth >= activeState.maxDepth) return activeState.nestedMarker;
  if (Array.isArray(value)) {
    const sanitized = [];
    seen.set(value, sanitized);
    const count = activeState?.maxArrayItems == null ? value.length : Math.min(value.length, activeState.maxArrayItems);
    for (let index = 0; index < count; index += 1) {
      sanitized.push(sanitizeLogicalDetailValue(value[index], options, seen, activeState, depth + 1));
    }
    if (count < value.length) sanitized.push(`[${value.length - count} more items omitted; see raw refs]`);
    return sanitized;
  }
  const sanitized = {};
  const usedKeys = new Set();
  const hasEmbeddedBase64Payload = String(value.type || '').toLowerCase() === 'base64'
    && typeof value.data === 'string';
  seen.set(value, sanitized);
  if (activeState?.maxObjectEntries != null) {
    let count = 0;
    let hasAdditionalFields = false;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (omitObjectKey(options, key)) continue;
      if (count >= activeState.maxObjectEntries) {
        hasAdditionalFields = true;
        break;
      }
      const sanitizedKey = uniqueBoundedObjectKey(key, usedKeys, marker, activeState);
      Object.defineProperty(sanitized, sanitizedKey, {
        value: hasEmbeddedBase64Payload && key === 'data'
          ? boundedText(embeddedBase64Marker, activeState)
          : sanitizeLogicalDetailValue(value[key], options, seen, activeState, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      count += 1;
    }
    if (hasAdditionalFields) sanitized['[additional fields omitted]'] = true;
    return sanitized;
  }
  for (const [key, item] of Object.entries(value)) {
    if (omitObjectKey(options, key)) continue;
    Object.defineProperty(sanitized, uniqueSanitizedObjectKey(key, usedKeys, marker), {
      value: hasEmbeddedBase64Payload && key === 'data'
        ? boundedText(embeddedBase64Marker, activeState)
        : sanitizeLogicalDetailValue(item, options, seen, activeState, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return sanitized;
}

function sanitizeLogicalDetailSections(detailSections, options = {}) {
  const state = sanitizerState(options);
  return {
    timelineSections: (detailSections?.timelineSections || []).map((section) => (
      sanitizeLogicalDetailValue(section, options, new WeakMap(), state)
    )),
    inspectorSections: (detailSections?.inspectorSections || []).map((section) => (
      sanitizeLogicalDetailValue(section, options, new WeakMap(), state)
    )),
  };
}

function sanitizeLogicalDetailDto(dto, options = {}) {
  const {
    id,
    sourceLocator,
    rawRefs,
    timelineSections,
    inspectorSections,
    ...rest
  } = dto || {};
  const state = sanitizerState(options);
  return {
    id,
    ...sanitizeLogicalDetailValue(rest, options, new WeakMap(), state),
    timelineSections: (timelineSections || []).map((section) => (
      sanitizeLogicalDetailValue(section, options, new WeakMap(), state)
    )),
    inspectorSections: (inspectorSections || []).map((section) => (
      sanitizeLogicalDetailValue(section, options, new WeakMap(), state)
    )),
    sourceLocator,
    rawRefs,
  };
}

module.exports = {
  DATA_URL_MARKER,
  EMBEDDED_BASE64_MARKER,
  LARGE_VALUE_MARKER,
  redactEmbeddedBase64DataUrls,
  redactEmbeddedDataUrls,
  sanitizeLogicalDetailDto,
  sanitizeLogicalDetailSections,
  sanitizeLogicalDetailValue,
  uniqueSanitizedObjectKey,
};
