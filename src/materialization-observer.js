'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const observerStorage = new AsyncLocalStorage();

function currentObserver() {
  const observer = observerStorage.getStore();
  return typeof observer === 'function' ? observer : null;
}

function notifyMaterializationObserver(event) {
  const observer = currentObserver();
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // Profiling is observational and must never change materialization.
  }
}

function runWithMaterializationObserver(observer, operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('Materialization observer requires an operation');
  }
  if (typeof observer !== 'function') return operation();
  return observerStorage.run(observer, operation);
}

function observeMaterializationPhase(phase, operation) {
  if (typeof phase !== 'string' || !phase) {
    throw new TypeError('Materialization phase must be a non-empty string');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('Materialization phase requires an operation');
  }
  if (!currentObserver()) return operation();
  notifyMaterializationObserver({ phase, state: 'start' });
  let value;
  try {
    value = operation();
  } catch (error) {
    notifyMaterializationObserver({ phase, state: 'end' });
    throw error;
  }
  if (value && typeof value.then === 'function') {
    return Promise.resolve(value).finally(() => {
      notifyMaterializationObserver({ phase, state: 'end' });
    });
  }
  notifyMaterializationObserver({ phase, state: 'end' });
  return value;
}

function recordMaterializationDuration(phase, durationMs) {
  if (typeof phase !== 'string' || !phase) {
    throw new TypeError('Materialization duration phase must be a non-empty string');
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError('Materialization duration must be a finite non-negative number');
  }
  notifyMaterializationObserver({ phase, state: 'duration', durationMs });
}

function hasMaterializationObserver() {
  return Boolean(currentObserver());
}

module.exports = {
  hasMaterializationObserver,
  notifyMaterializationObserver,
  observeMaterializationPhase,
  recordMaterializationDuration,
  runWithMaterializationObserver,
};
