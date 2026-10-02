'use strict';

const { createHash } = require('node:crypto');

// Preserve JSON.stringify's byte representation without allocating a second
// representation of a complete dependency set, descriptor, or large string.
// The callers own shape validation; only JSON-compatible plain data is used.
function* stringTokens(value) {
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 8192, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

function* jsonTokens(value) {
  const ancestors = new Set();
  const stack = [{ kind: 'value', value }];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.kind === 'array') {
      if (frame.index === frame.value.length) {
        yield ']'; ancestors.delete(frame.value); stack.pop(); continue;
      }
      if (frame.index) yield ',';
      stack.push({ kind: 'value', value: frame.value[frame.index++] });
      continue;
    }
    if (frame.kind === 'object') {
      let key;
      while (frame.index < frame.keys.length) {
        const candidate = frame.keys[frame.index++];
        if (frame.value[candidate] !== undefined) { key = candidate; break; }
      }
      if (key === undefined) {
        yield '}'; ancestors.delete(frame.value); stack.pop(); continue;
      }
      if (!frame.first) yield ',';
      frame.first = false;
      yield* stringTokens(key);
      yield ':';
      stack.push({ kind: 'value', value: frame.value[key] });
      continue;
    }
    const current = frame.value;
    if (typeof current === 'string') {
      yield* stringTokens(current); stack.pop(); continue;
    }
    if (current === null || typeof current !== 'object') {
      if (typeof current === 'function' || typeof current === 'symbol') throw new TypeError('Cannot encode non-plain data');
      yield JSON.stringify(current) ?? 'null'; stack.pop(); continue;
    }
    if (ancestors.has(current)) throw new TypeError('Cannot encode cyclic plain data');
    ancestors.add(current);
    if (Array.isArray(current)) {
      yield '[';
      Object.assign(frame, { kind: 'array', index: 0 });
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== null && prototype !== Object.prototype) throw new TypeError('Cannot encode non-plain data');
      yield '{';
      Object.assign(frame, { kind: 'object', keys: Object.keys(current), index: 0, first: true });
    }
  }
}

function forEachJsonChunk(value, consume) {
  if (value === undefined) throw new TypeError('Cannot encode undefined root data');
  let pending = '';
  for (const token of jsonTokens(value)) {
    if (pending.length + token.length > 64 * 1024) {
      consume(pending);
      pending = '';
    }
    pending += token;
  }
  if (pending) consume(pending);
}

function plainValueByteLength(value) {
  let bytes = 0;
  forEachJsonChunk(value, (chunk) => { bytes += Buffer.byteLength(chunk, 'utf8'); });
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Plain data byte count exceeds safe integer range');
  return bytes;
}

function hashPlainValue(value) {
  const hash = createHash('sha256');
  forEachJsonChunk(value, (chunk) => hash.update(chunk, 'utf8'));
  return hash.digest('base64url');
}

module.exports = { forEachJsonChunk, hashPlainValue, plainValueByteLength };
