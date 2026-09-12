'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { assertMaterializationCoverage } = require('./deepseek-phase-accounting');

function assertRepeatedMaterializationCoverage(samples) {
  assert.equal(samples.length, 3, 'coverage requires exactly three sequential samples');
  // Validate every sample before selection; NaN must never disappear in a minimum.
  for (const sample of samples) {
    for (const key of ['materializationMs', 'materializationAccountedMs', 'materializationResidualMs']) {
      assert.ok(Number.isFinite(sample[key]) && sample[key] >= 0, `invalid ${key}`);
    }
  }
  const baseline = samples.reduce((best, sample) => (
    sample.materializationResidualMs < best.materializationResidualMs ? sample : best
  ));
  assertMaterializationCoverage(baseline);
  return baseline;
}

function main() {
  const samples = [];
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    // Fresh processes, sequentially awaited: all topology and real HTTP semantic
    // assertions in worker() run on every repetition, including noisy samples.
    const result = JSON.parse(execFileSync(process.execPath, [
      require.resolve('./deepseek-readback-profile'), '--worker', '--sizes=100',
      '--shape=tool-dense', '--compression=plain',
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }));
    samples.push(result.coldAttribution);
    process.stdout.write(`${JSON.stringify({ repetition, ...result.coldAttribution })}\n`);
  }
  const baseline = assertRepeatedMaterializationCoverage(samples);
  process.stdout.write(`minimum residual=${baseline.materializationResidualMs.toFixed(2)}ms limit=${baseline.materializationCoverageLimitMs.toFixed(2)}ms\n`);
}

module.exports = { assertRepeatedMaterializationCoverage };
if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}
