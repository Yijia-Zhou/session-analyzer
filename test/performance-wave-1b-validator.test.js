'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  closedDescriptiveSummary,
  parseArgs,
  runValidator,
} = require('../scripts/performance-wave-1b-validator');

const candidateSha = 'a'.repeat(40);
const targetSyncSha = 'b'.repeat(40);
const repoRoot = path.resolve(__dirname, '..');

function scenario({
  durationMs = 100,
  fullRenders = 0,
  cardGenerations = 0,
  highlightPasses = 0,
  highlightMarksCreated = 0,
  highlightedOwnerCount = 0,
  targetDiscoveryPasses = 0,
  resources = {},
} = {}) {
  return {
    classification: { path: 'warm', ownerInstance: 'owner', scenarioVersion: 1 },
    functional: {},
    requests: { resourceTimingByFamily: resources },
    work: {
      durationMs,
      fullRenders,
      cardGenerations,
      highlightPasses,
      highlightMarksCreated,
      highlightedOwnerCount,
      targetDiscoveryPasses,
      longTasks: { count: 2, totalMs: 50, maxMs: 30 },
    },
  };
}

function artifact({
  repetitionIndex = 1,
  repetitionCount = 3,
  recordedAt = '2026-08-30T00:01:00.000Z',
  preloadRenders = 2,
  preloadCards = 750,
  preloadResources = {},
} = {}) {
  return {
    schemaVersion: 4,
    artifactKind: 'timeline-browser-run',
    identity: {
      repository: 'Yijia-Zhou/session-analyzer',
      targetBranch: 'towards-0.2.0',
      currentBranch: 'perf/wave-1b-search-render-coalescing',
      inspectedBaseSha: 'c'.repeat(40),
      preWave0Head: 'd'.repeat(40),
      head: candidateSha,
      candidateCommitSha: candidateSha,
      targetSyncSha,
      targetToCandidateDiffAlgorithm: 'git-diff-binary-no-ext-diff-full-index-v1',
      targetToCandidateDiffSha256: 'e'.repeat(64),
      dirty: false,
      profiledTrackedDiffSha256AtRun: 'f'.repeat(64),
      profiledImplementationTreeHash: '1'.repeat(64),
      runLabel: `run-${repetitionIndex}`,
      repetitionIndex,
      repetitionCount,
      recordedAt,
    },
    environment: {
      node: 'v24.18.1',
      v8: 'v8',
      npm: '12.0.2',
      playwright: '1.60.0',
      chromium: '148',
      execArgv: [],
      exposedGc: false,
      heapLimitBytes: 1,
      platform: 'win32',
      osRelease: 'test',
      architecture: 'x64',
      cpu: 'test-cpu',
      cpuCount: 1,
      totalMemoryBytes: 1,
      ci: false,
      headless: true,
      locale: 'en-US',
      timezone: 'UTC',
      viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
      runtimeAssetSha256: '2'.repeat(64),
    },
    invocationTemplate: {
      worker: 'timeline',
      runtime: 'node',
      inputRole: 'external-synthetic-fixture',
      outputRole: 'external-artifact-directory',
    },
    fixture: {
      parameters: { eventCount: 1_800 },
      roles: ['primary', 'secondary'],
      proofVersion: 1,
      generatorSha256: '3'.repeat(64),
      semanticFixtureProof: '4'.repeat(64),
    },
    scenarios: {
      warmSearchPreload: scenario({
        fullRenders: preloadRenders,
        cardGenerations: preloadCards,
        resources: preloadResources,
      }),
      warmJumpToLateHit: scenario({ durationMs: 200 }),
      warmDeepStructuredFilter: scenario({ fullRenders: 1, cardGenerations: 150 }),
      warmContextReveal: scenario(),
      coldSessionSwitchDuringQuery: scenario({ durationMs: 80 }),
    },
    acceptance: { passed: true, numericalLatencyGate: false },
  };
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function setupEvidence(t) {
  const tempRoot = await fsp.realpath(os.tmpdir());
  const root = await fsp.mkdtemp(path.join(tempRoot, 'session-analyzer-wave1b-validator-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const smoke = path.join(root, 'smoke', 'run.json');
  await writeJson(smoke, artifact({
    repetitionIndex: 1,
    repetitionCount: 1,
    recordedAt: '2026-08-30T00:00:00.000Z',
  }));
  return { root, smoke };
}

function smokeOptions(root, smoke) {
  return {
    smokeOnly: true,
    outputDir: path.join(root, 'smoke'),
    candidateSha,
    targetSyncSha,
    smoke,
    smokeValidation: '',
    runs: [],
  };
}

const dependencies = {
  validateGeneric(value) {
    if (value?.acceptance?.passed !== true) throw new Error('generic rejection');
  },
  now() { return new Date('2026-08-30T00:00:30.000Z'); },
};

test('CLI modes are mutually exclusive and reject duplicates or unknown options', () => {
  const base = [
    '--output-dir', 'C:\\evidence\\smoke',
    '--candidate-sha', candidateSha,
    '--target-sync-sha', targetSyncSha,
    '--smoke', 'C:\\evidence\\smoke\\run.json',
  ];
  const smoke = parseArgs(['--smoke-only', ...base]);
  assert.equal(smoke.smokeOnly, true);
  assert.deepEqual(smoke.runs, []);
  assert.throws(() => parseArgs(['--smoke-only', ...base, '--run', 'run.json']), /zero --run/);
  assert.throws(() => parseArgs([...base]), /formal mode requires/);
  assert.throws(() => parseArgs(['--smoke-only', ...base, '--smoke', 'again.json']), /Duplicate/);
  assert.throws(() => parseArgs(['--smoke-only', ...base, '--other']), /Unknown option/);
  assert.throws(
    () => parseArgs(['--smoke-only', ...base, '--smoke-validation', '']),
    /Missing value for --smoke-validation/,
  );
});

test('smoke-only writes a bound pass record for the intended overlay', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  const result = await runValidator(smokeOptions(root, smoke), dependencies);
  assert.equal(result.passed, true);
  const record = JSON.parse(await fsp.readFile(result.output, 'utf8'));
  const smokeBytes = await fsp.readFile(smoke);
  assert.equal(record.artifactKind, 'performance-wave-1b-smoke-validation');
  assert.equal(record.smoke.byteLength, smokeBytes.length);
  assert.match(record.smoke.sha256, /^[0-9a-f]{64}$/);
  assert.equal(record.genericAcceptancePassed, true);
  assert.equal(record.overlayAcceptancePassed, true);
  assert.equal(record.passed, true);
  assert.deepEqual(record.failures, []);
  assert.equal(path.dirname(result.output), path.dirname(smoke));
});

test('smoke-only rejects the repository root as its actual output directory', async (t) => {
  const { smoke } = await setupEvidence(t);
  await assert.rejects(runValidator({
    ...smokeOptions(path.dirname(repoRoot), smoke),
    outputDir: repoRoot,
  }, dependencies), /output directory must be repository-external/);
});

test('smoke-only rejects a nonexistent repository child before creating it', async (t) => {
  const { smoke } = await setupEvidence(t);
  const outputDir = path.join(
    repoRoot,
    `.wave1b-validator-boundary-${process.pid}-${Date.now()}`,
  );
  t.after(() => fsp.rm(outputDir, { recursive: true, force: true }));
  await assert.rejects(fsp.access(outputDir), { code: 'ENOENT' });
  await assert.rejects(runValidator({
    ...smokeOptions(repoRoot, smoke),
    outputDir,
  }, dependencies), /evidence root must be repository-external/);
  await assert.rejects(fsp.access(outputDir), { code: 'ENOENT' });
});

test('formal mode rejects a repository-internal output directory', async (t) => {
  const { smoke } = await setupEvidence(t);
  await assert.rejects(runValidator({
    smokeOnly: false,
    outputDir: repoRoot,
    candidateSha,
    targetSyncSha,
    smoke,
    smokeValidation: smoke,
    runs: [smoke, smoke, smoke],
  }, dependencies), /evidence root must be repository-external/);
});

test('smoke-only rejects a smoke outside its output directory and never overwrites a colliding input', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  await assert.rejects(
    runValidator({ ...smokeOptions(root, smoke), outputDir: path.join(root, 'other') }, dependencies),
    /directly inside the smoke-only output directory/,
  );
  const collidingSmoke = path.join(root, 'smoke', 'smoke-validation.json');
  await writeJson(collidingSmoke, artifact({ repetitionIndex: 1, repetitionCount: 1 }));
  const before = await fsp.readFile(collidingSmoke);
  await assert.rejects(
    runValidator(smokeOptions(root, collidingSmoke), dependencies),
    /must not replace an immutable input artifact/,
  );
  assert.deepEqual(await fsp.readFile(collidingSmoke), before);
});

test('validator rejects a symbolic-link ancestor in the evidence path', async (t) => {
  const tempRoot = await fsp.realpath(os.tmpdir());
  const realRoot = await fsp.mkdtemp(path.join(tempRoot, 'session-analyzer-wave1b-real-'));
  const linkParent = await fsp.mkdtemp(path.join(tempRoot, 'session-analyzer-wave1b-link-'));
  t.after(() => fsp.rm(realRoot, { recursive: true, force: true }));
  t.after(() => fsp.rm(linkParent, { recursive: true, force: true }));
  const linkedRoot = path.join(linkParent, 'evidence-link');
  try {
    await fsp.symlink(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('creating a test symlink is not permitted on this host');
      return;
    }
    throw error;
  }
  const smoke = path.join(realRoot, 'smoke', 'run.json');
  await writeJson(smoke, artifact({ repetitionIndex: 1, repetitionCount: 1 }));
  const linkedSmoke = path.join(linkedRoot, 'smoke', 'run.json');
  await assert.rejects(
    runValidator(smokeOptions(linkedRoot, linkedSmoke), dependencies),
    /must not contain symbolic links/,
  );
});

test('smoke-only rejects the old 4/1500 preload shape and preserves diagnostics', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  await writeJson(smoke, artifact({
    repetitionIndex: 1,
    repetitionCount: 1,
    recordedAt: '2026-08-30T00:00:00.000Z',
    preloadRenders: 4,
    preloadCards: 1_500,
  }));
  const result = await runValidator(smokeOptions(root, smoke), dependencies);
  assert.equal(result.passed, false);
  const record = JSON.parse(await fsp.readFile(result.output, 'utf8'));
  assert.equal(record.genericAcceptancePassed, true);
  assert.equal(record.overlayAcceptancePassed, false);
  assert.ok(record.failures.some((failure) => failure.includes('fullRenders expected 2')));
  assert.ok(record.failures.some((failure) => failure.includes('cardGenerations expected 750')));
});

test('formal mode revalidates smoke, writes summary before non-self manifest, and zero-fills absent families', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  const smokeResult = await runValidator(smokeOptions(root, smoke), dependencies);
  assert.equal(smokeResult.passed, true);
  const runs = [];
  for (const [index, resources] of [
    [1, { timeline: { durationTotal: 10 } }],
    [2, {}],
    [3, { timeline: { durationTotal: 30 }, detail: { durationTotal: 9 } }],
  ]) {
    const file = path.join(root, 'runs', `run-0${index}.json`);
    await writeJson(file, artifact({
      repetitionIndex: index,
      repetitionCount: 3,
      recordedAt: `2026-08-30T00:0${index}:00.000Z`,
      preloadResources: resources,
    }));
    runs.push(file);
  }
  const result = await runValidator({
    smokeOnly: false,
    outputDir: root,
    candidateSha,
    targetSyncSha,
    smoke,
    smokeValidation: smokeResult.output,
    runs,
  }, dependencies);
  assert.equal(result.passed, true);
  assert.equal(result.summary.descriptive.warmSearchPreload
    .resourceTimingDurationTotal.timeline.repeatCount, 3);
  assert.deepEqual(
    result.summary.descriptive.warmSearchPreload.resourceTimingDurationTotal.timeline,
    { repeatCount: 3, median: 10, min: 0, max: 30 },
  );
  assert.deepEqual(
    result.summary.descriptive.warmSearchPreload.resourceTimingDurationTotal.detail,
    { repeatCount: 3, median: 0, min: 0, max: 9 },
  );
  assert.equal(result.manifest.self.indexed, false);
  assert.equal(result.manifest.entries.length, 6);
  assert.deepEqual(result.manifest.entries.map((entry) => entry.role), [
    'smoke', 'smoke-validation', 'run-1', 'run-2', 'run-3', 'summary',
  ]);
  assert.equal(result.manifest.entries.some((entry) => entry.filename === 'manifest.json'), false);
  const summaryEntry = result.manifest.entries.at(-1);
  const summaryBytes = await fsp.readFile(result.summaryPath);
  assert.equal(summaryEntry.byteLength, summaryBytes.length);
});

test('formal mode rejects a smoke-validation record that does not bind the raw smoke', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  const smokeResult = await runValidator(smokeOptions(root, smoke), dependencies);
  const validation = JSON.parse(await fsp.readFile(smokeResult.output, 'utf8'));
  validation.smoke.sha256 = '0'.repeat(64);
  await writeJson(smokeResult.output, validation);
  const runs = [];
  for (let index = 1; index <= 3; index += 1) {
    const file = path.join(root, 'runs', `run-0${index}.json`);
    await writeJson(file, artifact({
      repetitionIndex: index,
      recordedAt: `2026-08-30T00:0${index}:00.000Z`,
    }));
    runs.push(file);
  }
  const result = await runValidator({
    smokeOnly: false,
    outputDir: root,
    candidateSha,
    targetSyncSha,
    smoke,
    smokeValidation: smokeResult.output,
    runs,
  }, dependencies);
  assert.equal(result.passed, false);
  assert.ok(result.summary.failures.some((failure) => failure.includes('raw smoke byte binding mismatch')));
});

test('formal mode requires a failures array and finite numeric metric types', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  const smokeResult = await runValidator(smokeOptions(root, smoke), dependencies);
  const validation = JSON.parse(await fsp.readFile(smokeResult.output, 'utf8'));
  delete validation.failures;
  await writeJson(smokeResult.output, validation);
  const runs = [];
  for (let index = 1; index <= 3; index += 1) {
    const value = artifact({
      repetitionIndex: index,
      recordedAt: `2026-08-30T00:0${index}:00.000Z`,
    });
    if (index === 2) value.scenarios.warmJumpToLateHit.work.durationMs = '200';
    const file = path.join(root, 'runs', `run-0${index}.json`);
    await writeJson(file, value);
    runs.push(file);
  }
  const result = await runValidator({
    smokeOnly: false,
    outputDir: root,
    candidateSha,
    targetSyncSha,
    smoke,
    smokeValidation: smokeResult.output,
    runs,
  }, dependencies);
  assert.equal(result.passed, false);
  assert.ok(result.summary.failures.some((failure) => failure.includes('prior smoke preflight did not pass')));
  assert.ok(result.summary.failures.some((failure) => failure.includes('must be a finite number')));
});

test('descriptive summary rejects non-object resource timing sections and family records', () => {
  const runs = [1, 2, 3].map((repetitionIndex) => ({
    artifact: artifact({ repetitionIndex }),
  }));
  runs[0].artifact.scenarios.warmSearchPreload.requests.resourceTimingByFamily = 1;
  assert.throws(
    () => closedDescriptiveSummary(runs),
    /resourceTimingByFamily must be an object/,
  );
  runs[0].artifact.scenarios.warmSearchPreload.requests.resourceTimingByFamily = {
    timeline: [],
  };
  assert.throws(
    () => closedDescriptiveSummary(runs),
    /warmSearchPreload.timeline must be an object/,
  );
});

test('formal outputs cannot collide with immutable raw inputs', async (t) => {
  const { root, smoke } = await setupEvidence(t);
  const smokeResult = await runValidator(smokeOptions(root, smoke), dependencies);
  const runs = [];
  for (let index = 1; index <= 3; index += 1) {
    const file = index === 2
      ? path.join(root, 'summary.json')
      : path.join(root, 'runs', `run-0${index}.json`);
    await writeJson(file, artifact({
      repetitionIndex: index,
      recordedAt: `2026-08-30T00:0${index}:00.000Z`,
    }));
    runs.push(file);
  }
  const before = await fsp.readFile(runs[1]);
  await assert.rejects(runValidator({
    smokeOnly: false,
    outputDir: root,
    candidateSha,
    targetSyncSha,
    smoke,
    smokeValidation: smokeResult.output,
    runs,
  }, dependencies), /must not replace an immutable input artifact/);
  assert.deepEqual(await fsp.readFile(runs[1]), before);
});
