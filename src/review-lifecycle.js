'use strict';

const LEGACY_REVIEW_PAYLOAD_TYPES = new Set(['entered_review_mode', 'exited_review_mode']);
const CANONICAL_REVIEW_ITEM_TYPES = new Set(['EnteredReviewMode', 'ExitedReviewMode']);

function reviewPhaseFromValue(value) {
  if (value === 'entered_review_mode' || value === 'EnteredReviewMode') return 'entered';
  if (value === 'exited_review_mode' || value === 'ExitedReviewMode') return 'exited';
  return '';
}

function reviewSubtypeForPhase(phase) {
  return phase === 'entered' ? 'entered_review_mode' : 'exited_review_mode';
}

// Normalizes one raw record into the canonical review lifecycle view consumed by
// marker extraction, logical-event construction, preview generation, and detail
// extraction. Two source envelopes are admitted:
//   1. Legacy dedicated rows: event_msg with payload.type entered_review_mode /
//      exited_review_mode (payload itself carries target/review_output).
//   2. Canonical completed TurnItem rows: event_msg with payload.type
//      item_completed and payload.item.type EnteredReviewMode / ExitedReviewMode
//      (the item object carries target/review_output).
// Rows carrying an explicit thread_id are accepted only for the owning session,
// mirroring the fail-closed same-Session ownership used elsewhere in the parser.
function reviewLifecycleFromRaw(raw, options = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.recordType !== 'event_msg') return null;
  const payload = raw.parsed?.payload || raw.payload || {};
  if (!payload || typeof payload !== 'object') return null;

  const ownerId = options.ownerId ? String(options.ownerId) : '';
  const threadId = typeof payload.thread_id === 'string' ? payload.thread_id : '';
  if (ownerId && threadId && threadId !== ownerId) return null;

  const payloadType = raw.payloadType || payload.type || '';
  if (LEGACY_REVIEW_PAYLOAD_TYPES.has(payloadType)) {
    const phase = reviewPhaseFromValue(payloadType);
    return phase ? { phase, subtype: reviewSubtypeForPhase(phase), payload } : null;
  }

  if (payloadType === 'item_completed') {
    const item = payload.item;
    if (!item || typeof item !== 'object') return null;
    const itemType = typeof item.type === 'string' ? item.type : '';
    if (!CANONICAL_REVIEW_ITEM_TYPES.has(itemType)) return null;
    const phase = reviewPhaseFromValue(itemType);
    return phase ? { phase, subtype: reviewSubtypeForPhase(phase), payload: item } : null;
  }

  return null;
}

// Appends one normalized review lifecycle marker to a mutable marker array.
// This is the single implementation used by parse-time marker caching and by the
// sessionReviewMarkers() fallback so envelope knowledge never forks.
function appendReviewLifecycleMarker(markers, raw, options = {}) {
  if (!Array.isArray(markers)) return false;
  const lifecycle = reviewLifecycleFromRaw(raw, options);
  if (!lifecycle) return false;
  if (lifecycle.phase === 'entered') {
    markers.push({ enteredAt: raw.timestamp || '', exitedAt: '' });
    return true;
  }
  let marker = markers[markers.length - 1];
  if (!marker || marker.exitedAt) {
    marker = { enteredAt: '', exitedAt: '' };
    markers.push(marker);
  }
  marker.exitedAt = raw.timestamp || '';
  return true;
}

module.exports = {
  appendReviewLifecycleMarker,
  reviewLifecycleFromRaw,
};
