'use strict';

const { forEachJsonChunk } = require('./plain-value-stream');

// Source-owned policies decide which fields are textual evidence. Traversal
// and encoding are iterative: JSON carried inside a string may be much deeper
// than the bounded canonical descriptor/analysis schemas.
function projectSearchJson(value, policy) {
  const original = typeof value === 'string' ? value : null;
  const redact = policy.redactString || ((text) => text);
  let parsed = value;
  if (original !== null) {
    try { parsed = JSON.parse(original); } catch { return redact(original); }
    if (!parsed || typeof parsed !== 'object') return redact(original);
  }
  if (parsed == null) return '';
  const opaque = (item) => item && typeof item === 'object' && policy.opaqueTypes?.has(item.type);
  const excluded = (key, parent) => policy.excludedKeys?.has(key) || policy.omitEntry?.(key, parent);
  const pending = [parsed];
  const visited = new Set();
  let changed = false;
  while (pending.length && !changed) {
    const item = pending.pop();
    if (typeof item === 'string') { changed = redact(item) !== item; continue; }
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    if (opaque(item)) { changed = true; break; }
    for (const key of Object.keys(item)) {
      if (excluded(key, item) || redact(key) !== key) { changed = true; break; }
      pending.push(item[key]);
    }
  }
  if (original !== null && !changed) return original;
  let safe = parsed;
  if (changed) {
    const root = Object.create(null);
    const frames = [{ source: { value: parsed }, target: root, keys: ['value'], index: 0 }];
    const ancestors = new Set();
    while (frames.length) {
      const frame = frames.at(-1);
      if (frame.index === frame.keys.length) {
        ancestors.delete(frame.source); frames.pop(); continue;
      }
      const key = frame.keys[frame.index++];
      if (excluded(key, frame.source)) continue;
      const safeKey = redact(key);
      let targetKey = safeKey;
      let collision = 1;
      while (Object.hasOwn(frame.target, targetKey)) targetKey = `${safeKey} (${collision++})`;
      const item = frame.source[key];
      if (opaque(item)) { frame.target[targetKey] = null; continue; }
      if (typeof item === 'string') { frame.target[targetKey] = redact(item); continue; }
      if (!item || typeof item !== 'object') { frame.target[targetKey] = item; continue; }
      if (ancestors.has(item)) throw new TypeError('Cannot project cyclic search data');
      ancestors.add(item);
      const target = Array.isArray(item) ? new Array(item.length) : Object.create(null);
      frame.target[targetKey] = target;
      frames.push({ source: item, target, keys: Object.keys(item), index: 0 });
    }
    safe = root.value;
  }
  const chunks = [];
  forEachJsonChunk(safe, (chunk) => chunks.push(chunk));
  return chunks.join('');
}

module.exports = { projectSearchJson };
