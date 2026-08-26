'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const {
  aggregateArtifacts,
  buildReviewIdentity,
  calibrateExactCounters,
  canonicalizePrivateBoundaries,
  parseArgs,
  prepareOutputBoundary,
  runRepetitionGroup,
  runnerCliErrorLine,
  validateManifest,
  validateTimelineArtifact,
} = require('../scripts/performance-wave-0-runner');
const {
  TARGET_TO_REF_DIFF_ALGORITHM,
  captureGitIdentity,
  createPacketIndex,
  postRunDocumentationHash,
  profiledImplementationTreeHash,
  verifyPacketIndex,
} = require('../scripts/performance-wave-0-identity');

function browserArtifact(repetition, durationMs = repetition, repetitionCount = 2) {
  const requestRecords = repetition % 2
    ? [{ sequence: 1, family: 'analysis' }, { sequence: 2, family: 'timeline' }, { sequence: 3, family: 'fileSuggestions' }]
    : [{ sequence: 1, family: 'fileSuggestions' }, { sequence: 2, family: 'timeline' }, { sequence: 3, family: 'analysis' }];
  return {
    schemaVersion: 3,
    artifactKind: 'timeline-browser-run',
    identity: {
      head: 'head-a',
      profiledImplementationTreeHash: 'tree-a',
      profiledTrackedDiffSha256AtRun: 'diff-a',
      repetitionIndex: repetition,
      repetitionCount,
    },
    environment: { node: 'v24.18.1' },
    invocationTemplate: {
      worker: 'timeline',
      runtime: 'node',
      inputRole: 'external-synthetic-fixture',
      outputRole: 'external-artifact-directory',
    },
    fixture: { semanticFixtureProof: 'fixture-a' },
    serverSetup: {
      buildInvocationCount: 1,
      commitValidationInvocationCount: 1,
      projectJobCount: 0,
      prewarmDisabled: true,
      createServerCount: 2,
    },
    scenarios: {
      warmSearchPreload: {
        classification: { path: 'warm' },
        functional: {
          finalStateDigest: 'state-a',
          selectedSessionRole: 'primary',
          loadedCount: 600,
          canonicalCardCount: 600,
          markCount: 1,
          contextRowCount: 0,
          visibleErrorCount: 0,
        },
        requests: {
          records: requestRecords,
          timelineOffsets: [0, 150, 300, 450],
          timelineLimits: [150, 150, 150, 150],
          constraints: { passed: true },
        },
        work: {
          durationMs,
          fullRenders: 4,
          cardGenerations: 600,
          highlightPasses: 2,
          targetDiscoveryPasses: 3,
          materializerCalls: 0,
          materializerCallsByRole: {},
        },
      },
    },
    acceptance: { passed: true },
  };
}

function privateArtifact(repetition = 1, repetitionCount = 2) {
  return {
    schemaVersion: 3,
    artifactKind: 'project-query-server-run',
    identity: {
      head: 'head-a',
      profiledImplementationTreeHash: 'tree-a',
      profiledTrackedDiffSha256AtRun: 'diff-a',
      repetitionIndex: repetition,
      repetitionCount,
    },
    environment: {},
    options: { repetitionIndex: repetition, repetitionCount },
    invocationTemplate: {},
    snapshotProof: {},
    corpus: { sessionCount: 2 },
    logicalAccountedBytes: { totalBytes: 10 },
    runtimeMemory: { heapLimitBytes: 100 },
    build: { invocationCount: 1, elapsedMs: 2 },
    validation: { invocationCount: 1, elapsedMs: 3 },
    commit: { arithmeticBuildPlusValidationMs: 5 },
    materialization: {},
    scans: {},
    acceptance: {
      structural: true,
      privacyAuditPassed: true,
      snapshotProofVerifiedByRunner: false,
    },
  };
}

function closedTimelineArtifact() {
  const scenario = () => ({
    classification: { path: 'warm', ownerInstance: 'warm', scenarioVersion: 1 },
    functional: {},
    requests: {
      records: [],
      familyCounts: {},
      timelineOffsets: [],
      timelineLimits: [],
      timelinePageCount: 0,
      detailCount: 0,
      eventEnvelopeCount: 0,
      failedCount: 0,
      intentionalAbortCount: 0,
      resourceTimingByFamily: {},
      domCommitLedger: [],
      constraints: { passed: true },
    },
    work: {},
  });
  return {
    schemaVersion: 3,
    artifactKind: 'timeline-browser-run',
    identity: {
      repository: 'repository-role',
      targetBranch: 'target-branch',
      currentBranch: 'current-branch',
      inspectedBaseSha: 'base-sha',
      preWave0Head: 'pre-wave-head',
      head: 'head-sha',
      candidateCommitSha: '1'.repeat(40),
      targetSyncSha: '2'.repeat(40),
      targetToCandidateDiffAlgorithm: TARGET_TO_REF_DIFF_ALGORITHM,
      targetToCandidateDiffSha256: '3'.repeat(64),
      dirty: false,
      profiledTrackedDiffSha256AtRun: '4'.repeat(64),
      profiledImplementationTreeHash: '5'.repeat(64),
      runLabel: 'run-label',
      repetitionIndex: 1,
      repetitionCount: 1,
      recordedAt: 'recorded-time',
    },
    environment: {
      node: 'node',
      v8: 'v8',
      npm: 'npm',
      playwright: 'playwright',
      chromium: 'chromium',
      execArgv: [],
      exposedGc: false,
      heapLimitBytes: 1,
      platform: 'win32',
      osRelease: 'release',
      architecture: 'x64',
      cpu: 'cpu',
      cpuCount: 1,
      totalMemoryBytes: 1,
      ci: false,
      headless: true,
      locale: 'en',
      timezone: 'UTC',
      viewport: {},
      runtimeAssetSha256: 'runtime-asset',
    },
    invocationTemplate: {
      worker: 'timeline',
      runtime: 'node',
      inputRole: 'external-synthetic-fixture',
      outputRole: 'external-artifact-directory',
    },
    fixture: {
      parameters: {},
      roles: {},
      proofVersion: 1,
      generatorSha256: 'generator-hash',
      semanticFixtureProof: 'fixture-proof',
    },
    serverSetup: {
      sourceKind: 'codex',
      sessionLifecycle: 'strict',
      buildInvocationCount: 1,
      commitValidationInvocationCount: 1,
      commitValidationChunkCount: 0,
      createServerCount: 2,
      projectJobCount: 0,
      prewarmDisabled: true,
      optionsRepoPresent: false,
      buildMs: 1,
      validationMs: 1,
      ownerMaterializerTotals: {},
    },
    scenarios: {
      warmSearchPreload: scenario(),
      warmJumpToLateHit: scenario(),
      warmDeepStructuredFilter: scenario(),
      warmContextReveal: scenario(),
      coldSessionSwitchDuringQuery: scenario(),
    },
    acceptance: {
      structural: true,
      correctness: true,
      privacyAuditPassed: true,
      cleanupPassed: true,
      passed: true,
      failures: [],
      numericalLatencyGate: false,
    },
  };
}

function encodedWorker(artifact, exitCode = 0) {
  const encoded = Buffer.from(JSON.stringify(artifact)).toString('base64');
  const script = exitCode === 0
    ? "process.stdout.write(Buffer.from(process.argv[1], 'base64').toString('utf8'))"
    : `process.exit(${exitCode})`;
  return { command: process.execPath, args: ['-e', script, encoded] };
}

async function privateSpawnFailureFixture(t, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const snapshotRoot = path.join(root, 'snapshot');
  const sourceHome = path.join(snapshotRoot, 'codex-home');
  const defaultLiveHome = path.join(root, 'live-home');
  await fsp.mkdir(sourceHome, { recursive: true });
  await fsp.mkdir(defaultLiveHome, { recursive: true });
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return {
    outputDir: path.join(root, 'output'),
    snapshotRoot,
    sourceHome,
    defaultLiveHome,
    missingExecutable: path.join(root, 'missing-worker-executable'),
  };
}

async function persistedAttempt(outputDir, groupName) {
  const manifest = JSON.parse(await fsp.readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  validateManifest(manifest);
  return manifest.groups[groupName].attempts[0];
}

test('runner rejects canonical repository output and enforces baseline repetition contracts', async () => {
  const repositoryOptions = parseArgs([
    '--profile', 'synthetic-browser', '--mode', 'smoke', '--output-dir', '.',
  ]);
  await assert.rejects(
    prepareOutputBoundary(repositoryOptions.outputDir),
    { code: 'PRIVATE_OUTPUT_INVALID' },
  );
  const external = path.join(os.tmpdir(), 'wave0-parse-contract');
  assert.equal(parseArgs([
    '--profile', 'synthetic-browser',
    '--mode', 'smoke',
    '--output-dir', external,
  ]).repetitions, 1);
  assert.throws(
    () => parseArgs([
      '--profile', 'synthetic-browser',
      '--mode', 'baseline',
      '--output-dir', external,
      '--repetitions', '4',
      '--calibration-file', path.join(external, 'calibration.json'),
    ]),
    /exactly five repetitions/,
  );
  assert.throws(
    () => parseArgs([
      '--profile', 'private-corpus', '--mode', 'smoke', '--output-dir', external,
      '--repo', process.cwd(), '--source-home', external, '--snapshot-root', external,
      '--snapshot-group', 'private-a', '--read-only-attested',
      '--copy-method', 'hard-link',
    ]),
    /independent byte-copy metadata/,
  );
  assert.throws(
    () => parseArgs([
      '--profile', 'private-corpus', '--mode', 'smoke', '--output-dir', external,
      '--repo', process.cwd(), '--source-home', external, '--snapshot-root', external,
      '--snapshot-group', 'C:\\private\\group', '--read-only-attested',
      '--copy-method', 'independent-byte-copy',
    ]),
    /opaque lowercase label/,
  );
});

test('private canonical boundaries reject live roots, source escapes, and output links', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-boundaries-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const fakeRepo = path.join(root, 'repo');
  const liveHome = path.join(root, 'live-home');
  const snapshot = path.join(root, 'snapshot');
  const sourceHome = path.join(snapshot, 'codex-home');
  await fsp.mkdir(fakeRepo);
  await fsp.mkdir(liveHome);
  await fsp.mkdir(sourceHome, { recursive: true });
  const base = {
    profileKind: 'private-corpus',
    mode: 'smoke',
    outputDir: path.join(root, 'output'),
    repetitions: 1,
    source: 'codex',
    repo: fakeRepo,
    sourceHome,
    snapshotRoot: snapshot,
    snapshotGroup: 'private-v2-a',
    readOnlyAttested: true,
    copyMethod: 'independent-byte-copy',
    calibrationFile: '',
  };

  const rootLink = path.join(root, 'snapshot-root-link');
  await fsp.symlink(liveHome, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    canonicalizePrivateBoundaries({
      ...base,
      snapshotRoot: rootLink,
      sourceHome: rootLink,
    }, { repoRoot: fakeRepo, defaultLiveHome: liveHome }),
    { code: 'PRIVATE_SNAPSHOT_INVALID' },
  );

  const escapedSource = path.join(root, 'escaped-source');
  await fsp.mkdir(escapedSource);
  await assert.rejects(
    canonicalizePrivateBoundaries({ ...base, sourceHome: escapedSource }, {
      repoRoot: fakeRepo,
      defaultLiveHome: liveHome,
    }),
    { code: 'PRIVATE_BOUNDARY_REJECTED' },
  );

  await assert.rejects(
    canonicalizePrivateBoundaries({
      ...base,
      snapshotRoot: liveHome,
      sourceHome: liveHome,
    }, { repoRoot: fakeRepo, defaultLiveHome: liveHome }),
    { code: 'PRIVATE_LIVE_HOME_REJECTED' },
  );

  const liveDescendant = path.join(liveHome, 'descendant');
  await fsp.mkdir(liveDescendant);
  await assert.rejects(
    canonicalizePrivateBoundaries({
      ...base,
      snapshotRoot: root,
      sourceHome: liveDescendant,
    }, { repoRoot: fakeRepo, defaultLiveHome: liveHome }),
    { code: 'PRIVATE_LIVE_HOME_REJECTED' },
  );

  const repoOutputTarget = path.join(fakeRepo, 'evidence');
  await fsp.mkdir(repoOutputTarget);
  const outputLink = path.join(root, 'output-link');
  await fsp.symlink(
    repoOutputTarget,
    outputLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    canonicalizePrivateBoundaries({ ...base, outputDir: outputLink }, {
      repoRoot: fakeRepo,
      defaultLiveHome: liveHome,
    }),
    { code: 'PRIVATE_OUTPUT_INVALID' },
  );
});

test('output boundary is rechecked after runner-created directory materializes', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-output-recheck-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const fakeRepo = path.join(root, 'repo');
  const repoTarget = path.join(fakeRepo, 'target');
  const outputDir = path.join(root, 'external', 'new-output');
  await fsp.mkdir(repoTarget, { recursive: true });
  await fsp.mkdir(path.dirname(outputDir), { recursive: true });
  const fsProxy = new Proxy(fsp, {
    get(target, property) {
      if (property !== 'mkdir') return target[property];
      return async (candidate, options) => {
        if (path.resolve(candidate) === path.resolve(outputDir)) {
          await fsp.symlink(
            repoTarget,
            outputDir,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          return;
        }
        return fsp.mkdir(candidate, options);
      };
    },
  });
  await assert.rejects(
    prepareOutputBoundary(outputDir, { repoRoot: fakeRepo, fsp: fsProxy }),
    { code: 'PRIVATE_OUTPUT_INVALID' },
  );
});

test('implementation and post-run documentation identities are separate', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-identity-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'scripts'));
  await fsp.mkdir(path.join(root, 'test'));
  await fsp.mkdir(path.join(root, 'docs'));
  await fsp.writeFile(path.join(root, 'scripts', 'profile.js'), 'implementation-a');
  await fsp.writeFile(path.join(root, 'test', 'profile.test.js'), 'test-a');
  await fsp.writeFile(path.join(root, 'docs', 'evidence.md'), 'evidence-a');
  const implementationPaths = ['scripts', 'test'];
  const documentationPaths = ['docs'];
  const firstImplementation = await profiledImplementationTreeHash(root, implementationPaths);
  const firstDocumentation = await postRunDocumentationHash(root, documentationPaths);
  await fsp.writeFile(path.join(root, 'docs', 'evidence.md'), 'evidence-b');
  assert.equal(
    await profiledImplementationTreeHash(root, implementationPaths),
    firstImplementation,
  );
  const secondDocumentation = await postRunDocumentationHash(root, documentationPaths);
  assert.notEqual(secondDocumentation, firstDocumentation);
  await fsp.writeFile(path.join(root, 'scripts', 'profile.js'), 'implementation-b');
  const secondImplementation = await profiledImplementationTreeHash(root, implementationPaths);
  assert.notEqual(secondImplementation, firstImplementation);
  await fsp.writeFile(path.join(root, 'test', 'profile.test.js'), 'test-b');
  const thirdImplementation = await profiledImplementationTreeHash(root, implementationPaths);
  assert.notEqual(thirdImplementation, secondImplementation);
  assert.deepEqual(buildReviewIdentity({
    profiledImplementationTreeHash: thirdImplementation,
    profiledTrackedDiffSha256AtRun: 'run-diff-hash',
    candidateCommitSha: '1'.repeat(40),
    targetSyncSha: '2'.repeat(40),
    targetToCandidateDiffAlgorithm: TARGET_TO_REF_DIFF_ALGORITHM,
    targetToCandidateDiffSha256: '3'.repeat(64),
  }, secondDocumentation), {
    profiledImplementationTreeHash: thirdImplementation,
    profiledTrackedDiffSha256AtRun: 'run-diff-hash',
    candidateCommitSha: '1'.repeat(40),
    targetSyncSha: '2'.repeat(40),
    targetToCandidateDiffAlgorithm: TARGET_TO_REF_DIFF_ALGORITHM,
    targetToCandidateDiffSha256: '3'.repeat(64),
    postRunDocumentationHash: secondDocumentation,
  });
});

test('clean capture identity separates candidate, capture HEAD, worktree diff, and target diff', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-clean-identity-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--initial-branch=target']);
  git(['config', 'user.name', 'Wave 0 Test']);
  git(['config', 'user.email', 'wave0-test@example.invalid']);
  await fsp.mkdir(path.join(root, 'scripts'));
  await fsp.mkdir(path.join(root, 'test'));
  await fsp.mkdir(path.join(root, 'docs'));
  await fsp.writeFile(path.join(root, 'scripts', 'profile.js'), 'implementation-a\n');
  await fsp.writeFile(path.join(root, 'test', 'profile.test.js'), 'test-a\n');
  await fsp.writeFile(path.join(root, 'docs', 'evidence.md'), 'evidence-a\n');
  git(['add', '.']);
  git(['commit', '-m', 'target']);
  const targetSyncSha = git(['rev-parse', 'HEAD']);
  await fsp.writeFile(path.join(root, 'scripts', 'profile.js'), 'implementation-b\n');
  git(['add', 'scripts/profile.js']);
  git(['commit', '-m', 'candidate']);
  const candidateCommitSha = git(['rev-parse', 'HEAD']);
  await fsp.writeFile(path.join(root, 'docs', 'evidence.md'), 'evidence-b\n');
  git(['add', 'docs/evidence.md']);
  git(['commit', '-m', 'capture docs']);
  const captureHead = git(['rev-parse', 'HEAD']);
  const identity = await captureGitIdentity(root, { candidateCommitSha, targetSyncSha });
  assert.equal(identity.head, captureHead);
  assert.equal(identity.candidateCommitSha, candidateCommitSha);
  assert.equal(identity.targetSyncSha, targetSyncSha);
  assert.equal(identity.dirty, false);
  assert.equal(identity.profiledTrackedDiffSha256AtRun, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(identity.targetToCandidateDiffAlgorithm, TARGET_TO_REF_DIFF_ALGORITHM);
  assert.match(identity.targetToCandidateDiffSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(identity.targetToCandidateDiffSha256, identity.profiledTrackedDiffSha256AtRun);
  await fsp.writeFile(path.join(root, 'docs', 'evidence.md'), 'dirty documentation\n');
  await assert.rejects(
    captureGitIdentity(root, { candidateCommitSha, targetSyncSha }),
    /requires a clean worktree/,
  );
});

test('packet index binds the exact file set, raw lengths, checksums, and review packet hash', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-packet-index-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'runs', 'synthetic'), { recursive: true });
  await fsp.writeFile(path.join(root, 'review-safe-summary.md'), 'review-safe\n');
  await fsp.writeFile(path.join(root, 'runs', 'synthetic', 'run-001.json'), '{"safe":true}\n');
  const created = await createPacketIndex(root);
  assert.equal(created.passed, true);
  assert.equal(created.packetFileCount, 3);
  assert.equal(created.indexedPayloadCount, 2);
  assert.deepEqual(created.index.payloads.map((entry) => entry.filename), [
    'review-safe-summary.md',
    'runs/synthetic/run-001.json',
  ]);
  assert.match(created.reviewPacketHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(await verifyPacketIndex(root), created);
  await fsp.writeFile(path.join(root, 'runs', 'synthetic', 'run-001.json'), '{"safe":false}\n');
  await assert.rejects(verifyPacketIndex(root), /payload verification failed/);
  await createPacketIndex(root);
  await fsp.writeFile(path.join(root, 'unindexed.txt'), 'not indexed\n');
  await assert.rejects(verifyPacketIndex(root), /file set does not match/);
});

test('runner uses independent PIDs, retains invalid attempts and outliers, and writes atomically', async (t) => {
  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-runner-'));
  t.after(() => fsp.rm(outputDir, { recursive: true, force: true }));
  const durations = [1, 0, 100, 3];
  const result = await runRepetitionGroup({
    profileKind: 'synthetic-browser',
    mode: 'smoke',
    outputDir,
    repetitions: 4,
    calibrationFile: '',
  }, {
    workerFactory(repetition) {
      if (repetition === 2) return encodedWorker(browserArtifact(repetition), 7);
      return encodedWorker(browserArtifact(repetition, durations[repetition - 1]));
    },
    validateArtifact() { return true; },
  });
  assert.equal(result.attempts.length, 4);
  assert.equal(result.summary.validAttemptCount, 3);
  assert.equal(result.summary.invalidAttemptCount, 1);
  assert.equal(new Set(result.attempts.map((attempt) => attempt.pid)).size, 4);
  assert.deepEqual(result.summary.processIsolation, {
    expectedProcessCount: 3,
    distinctPidCount: 3,
    repetitionIndexes: [1, 3, 4],
    passed: true,
  });
  assert.equal(result.attempts[1].failureReason, 'WORKER_EXIT');
  assert.equal(
    result.summary.observational['scenarios.warmSearchPreload.work.durationMs'].max,
    100,
  );
  assert.deepEqual(result.summary.causal.warmSearchPreload, { passCount: 3, repeatCount: 3 });
  assert.equal(result.summary.acceptance.passed, false);
  const allFiles = await fsp.readdir(path.join(outputDir, 'synthetic-browser'));
  assert.equal(allFiles.some((name) => name.includes('.tmp-')), false);
  const manifestText = await fsp.readFile(path.join(outputDir, 'manifest.json'), 'utf8');
  assert.equal(manifestText.includes(outputDir), false);
});

test('runner failure stderr and manifests retain only closed redacted categories', async (t) => {
  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-redacted-failure-'));
  t.after(() => fsp.rm(outputDir, { recursive: true, force: true }));
  const privatePath = path.join(os.tmpdir(), 'private-source', 'secret.jsonl');
  const missingExecutable = path.join(os.tmpdir(), 'private-source', 'missing-worker-executable');
  const result = await runRepetitionGroup({
    profileKind: 'synthetic-browser',
    mode: 'smoke',
    outputDir,
    repetitions: 1,
    calibrationFile: '',
  }, {
    workerFactory() { return { command: missingExecutable, args: [] }; },
    validateArtifact() { return true; },
  });
  assert.equal(result.attempts[0].pid, null);
  assert.equal(result.attempts[0].exitStatus, -1);
  assert.equal(result.attempts[0].valid, false);
  assert.equal(result.attempts[0].failureReason, 'CHILD_SPAWN_FAILED');
  const manifestText = await fsp.readFile(path.join(outputDir, 'manifest.json'), 'utf8');
  const summaryText = await fsp.readFile(
    path.join(outputDir, 'synthetic-browser', 'summary.json'),
    'utf8',
  );
  assert.equal(JSON.parse(manifestText).groups['synthetic-browser:smoke'].attempts[0].pid, null);
  assert.equal(manifestText.includes(missingExecutable), false);
  assert.equal(summaryText.includes(missingExecutable), false);
  assert.equal(manifestText.includes(privatePath), false);
  assert.equal(summaryText.includes(privatePath), false);
  const errorLine = runnerCliErrorLine(new Error(`EACCES ${privatePath}`));
  assert.equal(errorLine, 'PERFORMANCE_WAVE_0_ERROR:RUNNER_FAILURE\n');
  assert.equal(errorLine.includes(privatePath), false);
  await runRepetitionGroup({
    profileKind: 'synthetic-browser',
    mode: 'smoke',
    outputDir,
    repetitions: 1,
    calibrationFile: '',
  }, {
    workerFactory() { return { command: 'unused', args: [] }; },
    async runChild() {
      return {
        pid: 405,
        exitCode: 0,
        stdout: JSON.stringify({ leakedWorkerPath: privatePath }),
        stderrObserved: false,
        failureCode: '',
      };
    },
    validateArtifact() { throw new Error(`invalid worker artifact at ${privatePath}`); },
  });
  const invalidRunText = await fsp.readFile(
    path.join(outputDir, 'synthetic-browser', 'run-001.json'),
    'utf8',
  );
  const updatedSummaryText = await fsp.readFile(
    path.join(outputDir, 'synthetic-browser', 'summary.json'),
    'utf8',
  );
  const updatedManifestText = await fsp.readFile(path.join(outputDir, 'manifest.json'), 'utf8');
  assert.equal(invalidRunText.includes(privatePath), false);
  assert.equal(updatedSummaryText.includes(privatePath), false);
  assert.equal(updatedManifestText.includes(privatePath), false);
  assert.equal(JSON.parse(invalidRunText).failureReason, 'SCHEMA_OR_PRIVACY');
  assert.throws(() => validateManifest({
    schemaVersion: 3,
    artifactKind: 'performance-wave-0-manifest',
    groups: {
      'synthetic-browser:smoke': {
        profileKind: 'synthetic-browser',
        mode: 'smoke',
        readOnlyAttested: null,
        copyMethod: null,
        attempts: [{
          run: 'run-001.json',
          pid: 404,
          exitStatus: -1,
          valid: false,
          failureReason: `EACCES ${privatePath}`,
          artifactSha256: 'a'.repeat(64),
        }],
      },
    },
  }), /Manifest attempt is invalid/);
  for (const attempt of [{
    run: 'run-001.json',
    pid: null,
    exitStatus: -1,
    valid: false,
    failureReason: 'WORKER_EXIT',
    artifactSha256: 'a'.repeat(64),
  }, {
    run: 'run-001.json',
    pid: 404,
    exitStatus: -1,
    valid: false,
    failureReason: 'CHILD_SPAWN_FAILED',
    artifactSha256: 'a'.repeat(64),
  }]) {
    assert.throws(() => validateManifest({
      schemaVersion: 3,
      artifactKind: 'performance-wave-0-manifest',
      groups: {
        'synthetic-browser:smoke': {
          profileKind: 'synthetic-browser',
          mode: 'smoke',
          readOnlyAttested: null,
          copyMethod: null,
          attempts: [attempt],
        },
      },
    }), /Manifest attempt is invalid/);
  }
});

test('spawn failure survives per-run snapshot mismatch and final group mismatch', async (t) => {
  const fixture = await privateSpawnFailureFixture(
    t,
    'session-analyzer-wave0-spawn-snapshot-mismatch-',
  );
  const digests = ['reference', 'changed-before-run', 'reference', 'reference'];
  let digestIndex = 0;
  const result = await runRepetitionGroup({
    profileKind: 'private-corpus',
    mode: 'smoke',
    outputDir: fixture.outputDir,
    repetitions: 1,
    source: 'codex',
    repo: process.cwd(),
    sourceHome: fixture.sourceHome,
    snapshotRoot: fixture.snapshotRoot,
    snapshotGroup: 'private-combined-snapshot',
    readOnlyAttested: true,
    copyMethod: 'independent-byte-copy',
    calibrationFile: '',
  }, {
    defaultLiveHome: fixture.defaultLiveHome,
    workerFactory() { return { command: fixture.missingExecutable, args: [] }; },
    validateArtifact() { return true; },
    async computeSnapshotDigest() {
      const digest = digests[digestIndex];
      digestIndex += 1;
      return digest;
    },
  });
  assert.equal(digestIndex, 4);
  assert.equal(result.attempts[0].pid, null);
  assert.equal(result.attempts[0].exitStatus, -1);
  assert.equal(result.attempts[0].valid, false);
  assert.equal(result.attempts[0].failureReason, 'CHILD_SPAWN_FAILED');
  assert.equal(result.summary.snapshotEquality.allMatched, false);
  assert.equal(result.summary.acceptance.passed, false);
  assert.equal(result.summary.validAttemptCount, 0);
  assert.equal(result.summary.invalidAttemptCount, 1);
  assert.equal(
    JSON.parse(await fsp.readFile(
      path.join(fixture.outputDir, 'private-corpus', 'run-001.json'),
      'utf8',
    )).failureReason,
    'CHILD_SPAWN_FAILED',
  );
  const attempt = await persistedAttempt(fixture.outputDir, 'private-corpus:smoke');
  assert.equal(attempt.pid, null);
  assert.equal(attempt.failureReason, 'CHILD_SPAWN_FAILED');
});

test('spawn failure survives a final-only snapshot group mismatch', async (t) => {
  const fixture = await privateSpawnFailureFixture(
    t,
    'session-analyzer-wave0-spawn-group-mismatch-',
  );
  const digests = ['reference', 'reference', 'reference', 'changed-final'];
  let digestIndex = 0;
  const result = await runRepetitionGroup({
    profileKind: 'private-corpus',
    mode: 'smoke',
    outputDir: fixture.outputDir,
    repetitions: 1,
    source: 'codex',
    repo: process.cwd(),
    sourceHome: fixture.sourceHome,
    snapshotRoot: fixture.snapshotRoot,
    snapshotGroup: 'private-combined-group',
    readOnlyAttested: true,
    copyMethod: 'independent-byte-copy',
    calibrationFile: '',
  }, {
    defaultLiveHome: fixture.defaultLiveHome,
    workerFactory() { return { command: fixture.missingExecutable, args: [] }; },
    validateArtifact() { return true; },
    async computeSnapshotDigest() {
      const digest = digests[digestIndex];
      digestIndex += 1;
      return digest;
    },
  });
  assert.equal(digestIndex, 4);
  assert.equal(result.attempts[0].pid, null);
  assert.equal(result.attempts[0].failureReason, 'CHILD_SPAWN_FAILED');
  assert.equal(result.summary.snapshotEquality.allMatched, false);
  assert.equal(result.summary.acceptance.passed, false);
  const attempt = await persistedAttempt(fixture.outputDir, 'private-corpus:smoke');
  assert.equal(attempt.pid, null);
  assert.equal(attempt.failureReason, 'CHILD_SPAWN_FAILED');
});

test('spawn failure survives calibration mismatch while group acceptance fails', async (t) => {
  const root = await fsp.mkdtemp(path.join(
    os.tmpdir(),
    'session-analyzer-wave0-spawn-calibration-mismatch-',
  ));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'output');
  const calibrationFile = path.join(root, 'calibration.json');
  const missingExecutable = path.join(root, 'missing-worker-executable');
  await fsp.writeFile(calibrationFile, JSON.stringify({
    schemaVersion: 3,
    artifactKind: 'performance-wave-0-calibration',
    profileKind: 'synthetic-browser',
    accepted: true,
    candidateCommitSha: '1'.repeat(40),
    targetSyncSha: '2'.repeat(40),
    targetToCandidateDiffAlgorithm: TARGET_TO_REF_DIFF_ALGORITHM,
    targetToCandidateDiffSha256: '3'.repeat(64),
    profiledImplementationTreeHash: '4'.repeat(64),
    semanticFixtureProof: '5'.repeat(64),
    exactCounterSet: {},
  }));
  const result = await runRepetitionGroup({
    profileKind: 'synthetic-browser',
    mode: 'baseline',
    outputDir,
    repetitions: 1,
    calibrationFile,
  }, {
    workerFactory() { return { command: missingExecutable, args: [] }; },
    validateArtifact() { return true; },
  });
  assert.equal(result.attempts[0].pid, null);
  assert.equal(result.attempts[0].exitStatus, -1);
  assert.equal(result.attempts[0].valid, false);
  assert.equal(result.attempts[0].failureReason, 'CHILD_SPAWN_FAILED');
  assert.equal(result.summary.acceptance.passed, false);
  assert.equal(result.summary.validAttemptCount, 0);
  assert.equal(result.summary.invalidAttemptCount, 1);
  const attempt = await persistedAttempt(outputDir, 'synthetic-browser:baseline');
  assert.equal(attempt.pid, null);
  assert.equal(attempt.failureReason, 'CHILD_SPAWN_FAILED');
});

test('browser invocation template rejects unknown fields', () => {
  const artifact = closedTimelineArtifact();
  assert.equal(validateTimelineArtifact(artifact), true);
  assert.throws(() => validateTimelineArtifact({
    ...artifact,
    invocationTemplate: { ...artifact.invocationTemplate, shell: 'powershell' },
  }), /Timeline invocationTemplate violates its closed schema/);
});

test('calibration freezes only stable eligible counters and ignores sibling request order', () => {
  const first = browserArtifact(1, 10);
  const second = browserArtifact(2, 20);
  second.scenarios.warmSearchPreload.work.targetDiscoveryPasses = 4;
  for (const artifact of [first, second]) {
    artifact.scenarios.warmJumpToLateHit = {
      ...artifact.scenarios.warmSearchPreload,
      work: {
        ...artifact.scenarios.warmSearchPreload.work,
        fullRenders: 20,
        cardGenerations: 31800,
        highlightPasses: 10,
        highlightMarksCreated: 28,
        highlightedOwnerCount: 1,
        targetDiscoveryPasses: 31,
      },
    };
  }
  const exactCounterSet = calibrateExactCounters([first, second]);
  assert.deepEqual(exactCounterSet.warmSearchPreload, [
    'fullRenders',
    'cardGenerations',
    'highlightPasses',
  ]);
  assert.deepEqual(exactCounterSet.warmJumpToLateHit, [
    'highlightPasses',
    'highlightedOwnerCount',
  ]);
  const summary = aggregateArtifacts(
    'synthetic-browser',
    'calibration',
    [first, second],
    [{ valid: true, pid: 101 }, { valid: true, pid: 102 }],
    exactCounterSet,
  );
  assert.equal(summary.causal.warmSearchPreload.passCount, 2);
  assert.deepEqual(summary.categoricalObservations.warmSearchPreload.siblingRequestOrderCounts, {
    'analysis>timeline>fileSuggestions': 1,
    'fileSuggestions>timeline>analysis': 1,
  });
  assert.equal(summary.hardExact['scenarios.warmSearchPreload.work.fullRenders'].distinctValueCount, 1);
  assert.equal(summary.acceptance.passed, true);
});

test('private corpus shape is exact while logical accounted bytes are observational', () => {
  const first = privateArtifact(1, 2);
  const second = privateArtifact(2, 2);
  for (const artifact of [first, second]) {
    artifact.snapshotProof = { group: 'private-a', allMatched: true };
    artifact.acceptance.snapshotProofVerifiedByRunner = true;
  }
  first.logicalAccountedBytes.queryStoreBytes = 10;
  second.logicalAccountedBytes.queryStoreBytes = 12;
  second.logicalAccountedBytes.totalBytes = 12;
  const summary = aggregateArtifacts(
    'private-corpus',
    'baseline',
    [first, second],
    [{ valid: true, pid: 101 }, { valid: true, pid: 102 }],
  );
  assert.equal(summary.hardExact['corpus.sessionCount'].distinctValueCount, 1);
  assert.equal(summary.hardExact['logicalAccountedBytes.queryStoreBytes'], undefined);
  assert.deepEqual(summary.observational['logicalAccountedBytes.queryStoreBytes'], {
    repeatCount: 2,
    median: 11,
    min: 10,
    max: 12,
  });
  assert.equal(summary.acceptance.passed, true);
});

test('private runner checks snapshot before, during, and after without publishing digests', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-wave0-private-runner-'));
  const outputDir = path.join(root, 'output');
  const snapshotRoot = path.join(root, 'snapshot');
  const sourceHome = path.join(snapshotRoot, 'codex-home');
  const defaultLiveHome = path.join(root, 'live-home');
  await fsp.mkdir(sourceHome, { recursive: true });
  await fsp.mkdir(defaultLiveHome, { recursive: true });
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  let digestCalls = 0;
  const result = await runRepetitionGroup({
    profileKind: 'private-corpus',
    mode: 'smoke',
    outputDir,
    repetitions: 2,
    source: 'codex',
    repo: process.cwd(),
    sourceHome,
    snapshotRoot,
    snapshotGroup: 'private-a',
    readOnlyAttested: true,
    copyMethod: 'independent-byte-copy',
    calibrationFile: '',
  }, {
    defaultLiveHome,
    workerFactory(repetition) { return encodedWorker(privateArtifact(repetition)); },
    validateArtifact() { return true; },
    async computeSnapshotDigest() {
      digestCalls += 1;
      return 'private-reference-digest';
    },
  });
  assert.equal(digestCalls, 6);
  assert.equal(result.groupProof.allMatched, true);
  assert.equal(result.summary.snapshotEquality.checkpointCount, 6);
  assert.equal(result.summary.snapshotEquality.proofVersion, 2);
  assert.equal(result.summary.snapshotEquality.copyMethod, 'independent-byte-copy');
  assert.equal(result.summary.acceptance.passed, true);
  const runText = await fsp.readFile(path.join(outputDir, 'private-corpus', 'run-001.json'), 'utf8');
  const summaryText = await fsp.readFile(path.join(outputDir, 'private-corpus', 'summary.json'), 'utf8');
  assert.equal(runText.includes('private-reference-digest'), false);
  assert.equal(summaryText.includes('private-reference-digest'), false);
  const proofStateText = await fsp.readFile(path.join(outputDir, '.private-proof-state.json'), 'utf8');
  assert.equal(proofStateText.includes('private-reference-digest'), true);
  assert.equal(JSON.parse(proofStateText).proofVersion, 2);
});
