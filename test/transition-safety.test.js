'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isIntentionalAbort,
  isRetriableTransportError,
  createRequestOwner,
  createPaginationIntentState,
} = require('../src/browser/transition-safety');

test('request owner aborts only the superseded request and keeps cleanup identity-safe', () => {
  const owner = createRequestOwner();
  const first = owner.start('first');
  const second = owner.start('second');

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, false);
  assert.equal(owner.isCurrent(first), false);
  assert.equal(owner.finish(first), false, 'old finally must not clear the newer owner');
  assert.equal(owner.isCurrent(second), true);
  assert.equal(owner.finish(second), true);
  assert.equal(owner.current(), null);
});

test('intentional abort classification is type-based and does not swallow ordinary errors', () => {
  assert.equal(isIntentionalAbort(new DOMException('superseded', 'AbortError')), true);
  assert.equal(isIntentionalAbort(new Error('AbortError')), false);
  const renamed = new Error('browser-dependent abort message');
  renamed.name = 'AbortError';
  assert.equal(isIntentionalAbort(renamed), false);
  assert.equal(isIntentionalAbort(new DOMException('network failure', 'NetworkError')), false);
});

test('retriable transport errors cover fetch failures without hiding HTTP errors', () => {
  assert.equal(isRetriableTransportError(new TypeError('Failed to fetch')), true);
  assert.equal(isRetriableTransportError(new DOMException('network failure', 'NetworkError')), true);
  const httpError = new Error('HTTP 500');
  httpError.status = 500;
  assert.equal(isRetriableTransportError(httpError), false);
  assert.equal(isRetriableTransportError(new SyntaxError('invalid JSON')), false);
});

test('pagination intent belongs to one replacement epoch and is consumed once', () => {
  const intents = createPaginationIntentState();
  const firstEpoch = intents.beginReplacement('session-a');
  assert.equal(intents.authorizeUser('wheel'), null, 'old DOM input cannot authorize a pending replacement');
  assert.equal(intents.commitReplacement(firstEpoch), true);
  const user = intents.authorizeUser('wheel');
  assert.equal(intents.claim(user), true);
  assert.equal(intents.claim(user), false);

  const stale = intents.authorizeUser('keyboard');
  const secondEpoch = intents.beginReplacement('session-b');
  assert.equal(intents.claim(stale), false, 'replacement invalidates inherited input');
  assert.equal(intents.snapshot().authorizedUserIntentId, 0);
  assert.equal(intents.commitReplacement(secondEpoch), true);

  const explicit = intents.createIntent('explicit-load-more');
  assert.equal(intents.claim(explicit), true);
  assert.equal(intents.claim(explicit), false);
});

test('non-qualifying input cannot authorize ordinary pagination', () => {
  const intents = createPaginationIntentState();
  const epoch = intents.beginReplacement('current');
  intents.commitReplacement(epoch);
  assert.equal(intents.authorizeUser('scroll'), null);
  assert.equal(intents.authorizeUser('programmatic'), null);
});

test('user pagination authorization can be revoked when its input scroll does not reach the threshold', () => {
  const intents = createPaginationIntentState();
  const epoch = intents.beginReplacement('current');
  intents.commitReplacement(epoch);
  const wheel = intents.authorizeUser('wheel');

  assert.equal(intents.revokeUser(wheel), true);
  assert.equal(intents.claim(wheel), false, 'a later programmatic scroll cannot reuse the revoked input');
  assert.equal(intents.revokeUser(wheel), false);
  assert.equal(intents.snapshot().authorizedUserIntentId, 0);
});
