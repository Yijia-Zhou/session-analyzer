'use strict';

const { performance } = require('node:perf_hooks');

// Optional observations only: never change an action's result or failure.
// Coverage is limited to the common helpers that call this function.
function measurePhase(t, phase, action) {
  if (process.env.BROWSER_TEST_PHASES !== '1') return action();
  const started = performance.now();
  const report = () => {
    try {
      t.diagnostic(JSON.stringify({
        browserProfilePhase: 1,
        testName: t.name,
        phase,
        durationMs: performance.now() - started,
      }));
    } catch {
      // Diagnostic failures must not replace the action's result or error.
    }
  };
  let result;
  try {
    result = action();
  } catch (error) {
    report();
    throw error;
  }
  if (result && typeof result.then === 'function') return Promise.resolve(result).finally(report);
  report();
  return result;
}

module.exports = { measurePhase };
