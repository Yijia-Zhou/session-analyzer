'use strict';

// Work only on already verified, selected text. This changes response slicing,
// not source materialization, and the caller measures the complete final JSON.
function fitReadText(item, pieces, fits) {
  if (!pieces.length) return false;
  const widths = pieces.map((piece) => piece.end - piece.from);
  const render = (i, width) => {
    const piece = pieces[i];
    let from = piece.from;
    let end = piece.end;
    if (piece.hit !== undefined) {
      from = Math.max(from, Math.min(piece.hit - Math.floor((width - 1) / 2), end - width));
      end = from + width;
    } else if (piece.backward) from = end - width;
    else end = from + width;
    item.parts[piece.index] = piece.render(from, end);
  };
  // Reduce the largest text first, preserving at least one code unit of every
  // nonempty part (and the hit itself for an around-hit window).
  while (!fits()) {
    let largest = -1;
    for (let i = 0; i < widths.length; i += 1) {
      if (widths[i] > 1 && (largest < 0 || widths[i] > widths[largest])) largest = i;
    }
    if (largest < 0) break;
    widths[largest] = Math.max(1, Math.floor(widths[largest] / 2));
    render(largest, widths[largest]);
  }
  // If per-part continuation metadata is itself large, explicitly defer later
  // parts. Each retains a directly executable request; it is not unavailable.
  if (!fits()) {
    for (let i = pieces.length - 1; i > 0 && !fits(); i -= 1) {
      const piece = pieces[i];
      widths[i] = -1;
      item.parts[piece.index] = { part: piece.part, available: true, deferred: true,
        reason: 'output_budget', next: piece.request() };
    }
  }
  if (!fits()) return false;
  // Recover useful content within the budget. Try the whole part first because
  // finishing it can remove continuation metadata, so size is not monotonic at
  // that endpoint. Every accepted result is checked after exact serialization.
  for (let i = 0; i < widths.length; i += 1) {
    if (widths[i] < 0) continue;
    const max = pieces[i].end - pieces[i].from;
    let low = widths[i];
    let high = max;
    render(i, max);
    if (fits()) { widths[i] = max; continue; }
    render(i, low);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      render(i, middle);
      if (fits()) low = middle;
      else high = middle - 1;
    }
    widths[i] = low;
    render(i, low);
  }
  return fits();
}

module.exports = { fitReadText };
