'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendReviewLifecycleMarker,
  reviewLifecycleFromRaw,
} = require('../src/review-lifecycle');

function legacyRaw(line, payloadType, timestamp, extra = {}) {
  return {
    rawId: `session-1:raw:${line}`,
    sessionId: 'session-1',
    line,
    recordType: 'event_msg',
    payloadType,
    timestamp,
    parsed: { payload: { type: payloadType, ...extra } },
  };
}

function canonicalItemRaw(line, itemType, timestamp, item = {}, threadId = 'session-1') {
  return {
    rawId: `session-1:raw:${line}`,
    sessionId: 'session-1',
    line,
    recordType: 'event_msg',
    payloadType: 'item_completed',
    canonicalType: 'item_completed',
    timestamp,
    parsed: {
      payload: {
        type: 'item_completed',
        thread_id: threadId,
        item: { type: itemType, ...item },
      },
    },
  };
}

test('reviewLifecycleFromRaw normalizes legacy dedicated event rows', () => {
  const entered = reviewLifecycleFromRaw(legacyRaw(1, 'entered_review_mode', 't1', {
    target: { type: 'uncommittedChanges' },
  }));
  assert.deepEqual(entered, {
    phase: 'entered',
    subtype: 'entered_review_mode',
    payload: {
      type: 'entered_review_mode',
      target: { type: 'uncommittedChanges' },
    },
  });

  const exited = reviewLifecycleFromRaw(legacyRaw(2, 'exited_review_mode', 't2', {
    review_output: { findings: [], overall_correctness: 'patch is correct' },
  }));
  assert.equal(exited.phase, 'exited');
  assert.equal(exited.subtype, 'exited_review_mode');
  assert.deepEqual(exited.payload.review_output, {
    findings: [],
    overall_correctness: 'patch is correct',
  });
});

test('reviewLifecycleFromRaw normalizes canonical completed TurnItem rows', () => {
  const entered = reviewLifecycleFromRaw(canonicalItemRaw(1, 'EnteredReviewMode', 't1', {
    target: { type: 'uncommittedChanges' },
    user_facing_hint: 'current changes',
  }));
  assert.equal(entered.phase, 'entered');
  assert.equal(entered.subtype, 'entered_review_mode');
  assert.deepEqual(entered.payload, {
    type: 'EnteredReviewMode',
    target: { type: 'uncommittedChanges' },
    user_facing_hint: 'current changes',
  });

  const exited = reviewLifecycleFromRaw(canonicalItemRaw(2, 'ExitedReviewMode', 't2', {
    review_output: { overall_correctness: 'patch is correct' },
  }));
  assert.equal(exited.phase, 'exited');
  assert.equal(exited.subtype, 'exited_review_mode');
  assert.equal(exited.payload.review_output.overall_correctness, 'patch is correct');
});

test('reviewLifecycleFromRaw rejects non-review rows, wrong owners, and item_started envelopes', () => {
  assert.equal(reviewLifecycleFromRaw(canonicalItemRaw(1, 'CommandExecution', 't1')), null);
  assert.equal(reviewLifecycleFromRaw({
    recordType: 'response_item',
    payloadType: 'entered_review_mode',
    parsed: { payload: { type: 'entered_review_mode' } },
  }), null);
  assert.equal(reviewLifecycleFromRaw(
    canonicalItemRaw(1, 'EnteredReviewMode', 't1', {}, 'other-session'),
    { ownerId: 'session-1' },
  ), null);
  assert.equal(reviewLifecycleFromRaw({
    recordType: 'event_msg',
    payloadType: 'item_started',
    parsed: {
      payload: {
        type: 'item_started',
        thread_id: 'session-1',
        item: { type: 'EnteredReviewMode' },
      },
    },
  }), null);

  const accepted = reviewLifecycleFromRaw(
    canonicalItemRaw(1, 'EnteredReviewMode', 't1', {}, 'session-1'),
    { ownerId: 'session-1' },
  );
  assert.equal(accepted.phase, 'entered');
});

test('appendReviewLifecycleMarker builds paired markers from both envelopes', () => {
  const markers = [];
  assert.equal(appendReviewLifecycleMarker(markers, legacyRaw(1, 'entered_review_mode', 't1')), true);
  assert.equal(appendReviewLifecycleMarker(markers, canonicalItemRaw(2, 'ExitedReviewMode', 't2')), true);
  assert.deepEqual(markers, [{ enteredAt: 't1', exitedAt: 't2' }]);

  appendReviewLifecycleMarker(markers, canonicalItemRaw(3, 'ExitedReviewMode', 't3'));
  assert.deepEqual(markers, [
    { enteredAt: 't1', exitedAt: 't2' },
    { enteredAt: '', exitedAt: 't3' },
  ]);

  assert.equal(appendReviewLifecycleMarker(markers, canonicalItemRaw(4, 'CommandExecution', 't4')), false);
  assert.equal(appendReviewLifecycleMarker([], null), false);
});
