'use strict';

// Native v4 stream content follows the pinned DSH BlockAssembler contract:
// first-seen block order, first completed block wins, open blocks use deltas.
// Keep references to source deltas until settlement so a large partial cannot
// consume the display budget before a shorter authoritative block replaces it.
function embeddedStreamFacts(stream, limit = 16_000) {
  if (!Array.isArray(stream)) return null;
  const blocks = new Map();
  let chunks = 0;
  let toolFragments = 0;
  let finishReason = '';
  function blockAt(index, kind) {
    if (!Number.isSafeInteger(index) || index < 0 || Object.is(index, -0)) return null;
    if (!blocks.has(index)) blocks.set(index, { kind, closed: false, runs: [] });
    return blocks.get(index);
  }
  function delta(index, kind, texts) {
    const block = blockAt(index, kind);
    if (block && !block.closed) block.runs.push(texts);
  }
  for (const record of stream) {
    if (!record || typeof record !== 'object') continue;
    if (record.type === 'text-chunks' || record.type === 'reasoning-chunks') {
      const texts = Array.isArray(record.texts) ? record.texts : [];
      chunks += texts.length;
      delta(record.index, record.type === 'text-chunks' ? 'text' : 'reasoning', texts);
    } else if (record.type === 'tool-call-chunks') {
      const count = Array.isArray(record.args) ? record.args.length : 0;
      chunks += count;
      toolFragments += count;
      blockAt(record.index, 'tool-call');
    } else if (record.type === 'chunk') {
      chunks += 1;
      const chunk = record.chunk;
      if (chunk?.type === 'block-start') blockAt(chunk.index, chunk.blockType);
      if (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta') {
        delta(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning', [chunk.text]);
      }
      if (chunk?.type === 'tool-call-delta') {
        toolFragments += 1;
        blockAt(chunk.index, 'tool-call');
      }
      if (chunk?.type === 'block-end' && chunk.block && typeof chunk.block.type === 'string') {
        const block = blockAt(chunk.index, chunk.block.type);
        if (block && !block.closed) {
          block.closed = true;
          block.kind = chunk.block.type;
          block.text = chunk.block.text;
          block.runs = [];
        }
      }
      if (chunk?.type === 'finish') finishReason = typeof chunk.reason?.kind === 'string' ? chunk.reason.kind : '';
    }
  }
  function blockText(block) {
    if (block.closed) return typeof block.text === 'string' ? block.text.slice(0, limit) : '';
    let value = '';
    for (const run of block.runs) {
      for (const part of run) {
        if (typeof part === 'string') value += part.slice(0, limit - value.length);
        if (value.length >= limit) return value;
      }
    }
    return value;
  }
  const join = (current, value) => {
    if (!value || current.length >= limit) return current;
    const separator = current ? '\n' : '';
    return current + (separator + value).slice(0, limit - current.length);
  };
  let text = '';
  let reasoning = '';
  let searchText = '';
  for (const block of blocks.values()) {
    if (block.kind !== 'text' && block.kind !== 'reasoning') continue;
    if (searchText.length >= limit && (block.kind === 'text' ? text : reasoning).length >= limit) continue;
    const value = blockText(block);
    if (block.kind === 'text') text = join(text, value);
    else reasoning = join(reasoning, value);
    searchText = join(searchText, value);
  }
  return { text, reasoning, searchText, chunks, toolFragments, finishReason };
}

module.exports = { embeddedStreamFacts };
