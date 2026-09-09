'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PRIVATE_PROOF_VERSION,
  S1_M0_BASELINE_SHA,
  computePrivateSnapshotDigest,
  enumeratePrivateSnapshotFiles,
  invocationTemplate,
  m0CliErrorLine,
  parseArgs,
  parseM0Args,
  privateCliErrorLine,
  profileM0Synthetic,
  publicOptions,
  selectMaterializationCandidates,
  snapshotProofVerdict,
  timingStats,
  validateM0Artifact,
  validatePrivateArtifact,
  validatePrivateSummary,
} = require('../scripts/project-query-store-profile');
const lifecycleComparison = require('../scripts/cold-session-lifecycle-comparison');

test('project query profile accepts bounded options and redacts every local path', () => {
  const options = parseArgs([
    '--source', 'claude',
    '--repo', 'private-project',
    '--source-home', 'private-home',
    '--repeats', '5',
  ]);
  assert.equal(options.source, 'claude-code');
  assert.equal(options.repeats, 5);
  assert.deepEqual(publicOptions(options), {
    source: 'claude-code',
    repo: '<redacted>',
    sourceHome: '<redacted>',
    repeats: 5,
    snapshotGroup: 'unassigned',
    repetitionIndex: 1,
    repetitionCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(publicOptions(options)), /private-(?:project|home)/);
});

test('project query profile reports exact repeat count, median, and range', () => {
  assert.deepEqual(timingStats([9, 3, 7, 5]), {
    repeatCount: 4,
    medianMs: 6,
    minMs: 3,
    maxMs: 9,
  });
  assert.throws(
    () => parseArgs(['--source', 'codex', '--repo', '.', '--repeats', '21']),
    { code: 'INVALID_PROFILE_ARGUMENT' },
  );
  assert.deepEqual(invocationTemplate(), {
    worker: 'project-query',
    runtime: 'node-expose-gc',
    inputRole: 'external-private-copy',
    outputRole: 'external-artifact-directory',
  });
});

test('S1 M0 parser keeps synthetic and sealed-private modes distinct', () => {
  assert.deepEqual(parseM0Args([
    '--m0-q-scan', 'synthetic',
    '--repeats', '2',
  ]), {
    profileKind: 'synthetic',
    source: 'synthetic',
    repo: '',
    sourceHome: '',
    repeats: 2,
    snapshotGroup: 'synthetic',
    adapter: null,
  });
  const privateOptions = parseM0Args([
    '--m0-q-scan', 'private',
    '--source', 'codex',
    '--repo', 'private-project',
    '--source-home', 'private-copy',
    '--snapshot-group', 's1-m0-a',
    '--repeats', '3',
  ]);
  assert.equal(privateOptions.profileKind, 'private');
  assert.equal(privateOptions.source, 'codex');
  assert.equal(privateOptions.repeats, 3);
  assert.equal(privateOptions.snapshotGroup, 's1-m0-a');
  assert.equal(privateOptions.adapter.kind, 'codex');
  assert.throws(
    () => parseM0Args(['--m0-q-scan', 'private', '--source', 'codex', '--repo', '.']),
    { code: 'INVALID_PROFILE_ARGUMENT' },
  );
  assert.equal(
    m0CliErrorLine(new Error('private path and source text')),
    'PERFORMANCE_SERVER_S1_M0_ERROR:M0_PROFILE_FAILURE\n',
  );
});

test('S1 M0 synthetic attribution is exact for absent, sparse, and dense q classes', async () => {
  const artifact = await profileM0Synthetic({
    repeats: 1,
    fixtureOptions: {
      sessionCount: 2,
      rowsPerSession: 6,
      sparseEvery: 4,
      densePreviewOccurrences: 2,
      denseSearchTextOccurrences: 3,
    },
  });
  assert.equal(validateM0Artifact(artifact), true);
  assert.equal(artifact.baselineSha, S1_M0_BASELINE_SHA);
  assert.deepEqual(artifact.corpus.rowCounts, { main: 12, protocol: 0, raw: 0 });
  assert.equal(artifact.corpus.sessionCount, 2);
  assert.equal(artifact.acceptance.structural, true);
  assert.deepEqual(artifact.abort, {
    layer: 'main',
    abortRequested: true,
    abortObserved: true,
    rowsProcessedBeforeAbort: 6,
    textChunksProcessedBeforeAbort: 1,
    textChunksDecodedBeforeAbort: 1,
    abortToSettlementMs: artifact.abort.abortToSettlementMs,
  });
  assert.ok(artifact.abort.abortToSettlementMs >= 0);

  const { absent, sparse, dense } = artifact.layers.main.queryClasses;
  const structural = {
    eligibleSessions: 2,
    sessionsScanned: 2,
    rowsScanned: 12,
    structurallyEligibleRows: 12,
    textChunksDecoded: 2,
    identityTextChunks: 2,
    gzipTextChunks: 0,
    compressedTextBytes: 18270,
    uncompressedTextBytes: 18270,
  };
  for (const result of [absent, sparse, dense]) {
    assert.deepEqual(
      Object.fromEntries(Object.keys(structural).map((field) => [field, result.metrics[field]])),
      structural,
    );
    assert.equal(result.metrics.previewSearchInvocations, 12);
    assert.equal(result.metrics.searchTextSearchInvocations, 12);
    assert.equal(result.metrics.booleanHitChecks, 12);
    assert.equal(result.parity.profilerModelMatchesProduction, true);
    assert.equal(result.parity.shortCircuitMatchesCurrent, true);
    assert.equal(result.candidateAssessment.exactProjectResultParity, true);
    assert.equal(result.phaseTimings.gzipDecodeOnly, null);
    assert.equal(result.phaseTimings.latestResultPresentationHydration, null);
    assert.equal(result.phaseTimings.productionProjectScopeQuery.repeatCount, 1);
  }

  assert.deepEqual({
    rowsHit: absent.metrics.rowsHit,
    matchingEvents: absent.metrics.matchingEvents,
    matchingSessions: absent.metrics.matchingSessions,
    fullOccurrenceIterations: absent.metrics.fullOccurrenceIterations,
    candidateSearchTextInvocations: absent.candidateAssessment.searchTextSearchInvocations,
  }, {
    rowsHit: 0,
    matchingEvents: 0,
    matchingSessions: 0,
    fullOccurrenceIterations: 0,
    candidateSearchTextInvocations: 12,
  });
  assert.deepEqual({
    rowsHit: sparse.metrics.rowsHit,
    matchingEvents: sparse.metrics.matchingEvents,
    matchingSessions: sparse.metrics.matchingSessions,
    latestEventSelections: sparse.metrics.latestEventSelections,
    latestEventComparisons: sparse.metrics.latestEventComparisons,
    fullOccurrenceIterations: sparse.metrics.fullOccurrenceIterations,
    candidateSearchTextInvocations: sparse.candidateAssessment.searchTextSearchInvocations,
    candidateSearchTextInvocationsAvoided: sparse.candidateAssessment.searchTextInvocationsAvoided,
  }, {
    rowsHit: 3,
    matchingEvents: 3,
    matchingSessions: 2,
    latestEventSelections: 3,
    latestEventComparisons: 1,
    fullOccurrenceIterations: 3,
    candidateSearchTextInvocations: 10,
    candidateSearchTextInvocationsAvoided: 2,
  });
  assert.deepEqual({
    rowsHit: dense.metrics.rowsHit,
    matchingEvents: dense.metrics.matchingEvents,
    matchingSessions: dense.metrics.matchingSessions,
    latestEventSelections: dense.metrics.latestEventSelections,
    latestEventComparisons: dense.metrics.latestEventComparisons,
    previewMatchOccurrences: dense.metrics.previewMatchOccurrences,
    searchTextMatchOccurrences: dense.metrics.searchTextMatchOccurrences,
    fullOccurrenceIterations: dense.metrics.fullOccurrenceIterations,
    candidateSearchTextInvocations: dense.candidateAssessment.searchTextSearchInvocations,
    candidateSearchTextInvocationsAvoided: dense.candidateAssessment.searchTextInvocationsAvoided,
    fullOccurrenceIterationsAvoided: dense.candidateAssessment.fullOccurrenceIterationsAvoided,
  }, {
    rowsHit: 12,
    matchingEvents: 12,
    matchingSessions: 2,
    latestEventSelections: 12,
    latestEventComparisons: 10,
    previewMatchOccurrences: 24,
    searchTextMatchOccurrences: 36,
    fullOccurrenceIterations: 60,
    candidateSearchTextInvocations: 0,
    candidateSearchTextInvocationsAvoided: 12,
    fullOccurrenceIterationsAvoided: 48,
  });

  const serialized = JSON.stringify(artifact);
  assert.equal(serialized.includes('synthetic-session-'), false);
  assert.equal(serialized.includes('synthetic-event-'), false);
  assert.equal(serialized.includes('__session_analyzer_'), false);
  assert.throws(
    () => validateM0Artifact({ ...artifact, unexpected: true }),
    /closed nested schema/,
  );
  const mislabeledAbsent = structuredClone(artifact);
  mislabeledAbsent.layers.main.queryClasses.absent.metrics.rowsHit = 1;
  mislabeledAbsent.layers.main.queryClasses.absent.metrics.matchingEvents = 1;
  assert.throws(
    () => validateM0Artifact(mislabeledAbsent),
    /cross-field accounting is invalid/,
  );
});

function minimalPrivateArtifact() {
  const memory = (value = 1) => ({ heapUsed: value, rss: value, external: value, arrayBuffers: value });
  const timing = (repeatCount = 3) => ({ repeatCount, medianMs: 1, minMs: 1, maxMs: 1 });
  const selection = () => ({ sourceBytes: 1, rawRows: 1, logicalRows: 1 });
  const ownerStats = () => Object.fromEntries([
    'indexRevision', 'retired', 'maxEstimatedMaterializedBytes', 'maxCachedSessions',
    'cacheSessionCount', 'estimatedMaterializedBytes', 'queuedJobCount', 'activeJobCount',
    'waiterCount', 'hits', 'misses', 'coalesced', 'admitted', 'busy', 'started', 'completed',
    'failed', 'waiterAborts', 'jobAborts', 'retiredJobs', 'peakCacheSessionCount',
    'peakEstimatedMaterializedBytes', 'cacheAdmissions', 'cacheTouches', 'cachePromotions',
    'evictions', 'evictedEstimatedBytes', 'speculativeEvictions', 'foregroundEvictions',
    'oversizeForegroundAdmissions', 'speculativeAdmissionRejections', 'prewarmScheduled',
    'prewarmStarted', 'prewarmCompleted', 'prewarmPromoted', 'prewarmPreempted',
    'prewarmFailed', 'prewarmSkippedBusy', 'prewarmSkippedSize', 'prewarmSkippedBudget',
    'prewarmSkippedCached', 'prewarmSkippedCacheCapacity', 'prewarmRetired', 'prewarmCacheHits',
  ].map((field) => [field, field === 'retired' ? false : 0]));
  const materializedClass = () => ({
    selection: selection(),
    coldMs: 1,
    warm: timing(),
    warmRepeatCount: 3,
    adapterCalls: 1,
    exactWarmIdentity: true,
    estimatedOwnerBytes: 1,
    processMaxRssBefore: 1,
    processMaxRssAfter: 1,
    materializationPhaseMs: { adapter_materialization: 1 },
    attributedColdMs: 1,
    unattributedColdMs: 0,
    projectionChunkSamples: 1,
    transientPeak: memory(),
    transientPeakOverBefore: memory(),
    afterCache: memory(),
    afterCacheDelta: memory(),
    afterRetirement: memory(),
    afterRetirementDelta: memory(),
  });
  const scan = () => ({
    oracle: null,
    packed: timing(),
    chunks: 3,
    transientDecodePeak: memory(),
    transientDecodePeakOverCommitted: memory(),
  });
  return {
    schemaVersion: 3,
    artifactKind: 'project-query-server-run',
    identity: {
      repository: 'Yijia-Zhou/session-analyzer',
      targetBranch: 'towards-0.2.0',
      currentBranch: 'towards-0.2.0',
      inspectedBaseSha: 'd370cc7bca56380457c147dc4c33637a0baedf68',
      preWave0Head: '377a0356fe884a5a95f234bd5d6f22240ca8052b',
      head: '377a0356fe884a5a95f234bd5d6f22240ca8052b',
      candidateCommitSha: '1'.repeat(40),
      targetSyncSha: '2'.repeat(40),
      targetToCandidateDiffAlgorithm: 'git-diff-binary-no-ext-diff-full-index-v1',
      targetToCandidateDiffSha256: '3'.repeat(64),
      dirty: false,
      profiledTrackedDiffSha256AtRun: '4'.repeat(64),
      profiledImplementationTreeHash: '5'.repeat(64),
      repetitionIndex: 1,
      repetitionCount: 3,
      recordedAt: '2026-08-24T00:00:00.000Z',
    },
    environment: {
      node: 'v24.18.1',
      v8: '13.6',
      npm: '12.0.2',
      playwright: '1.60.0',
      chromium: '148.0.7778.96',
      execArgv: ['--expose-gc'],
      exposedGc: true,
      heapLimitBytes: 100,
      platform: 'win32',
      osRelease: '10.0',
      architecture: 'x64',
      cpu: 'test-cpu',
      cpuCount: 1,
      totalMemoryBytes: 100,
      ci: false,
      headless: null,
      viewport: null,
      locale: 'en-US',
      timezone: 'UTC',
    },
    options: {
      source: 'codex',
      repo: '<redacted>',
      sourceHome: '<redacted>',
      repeats: 3,
      snapshotGroup: 'private-a',
      repetitionIndex: 1,
      repetitionCount: 3,
    },
    invocationTemplate: invocationTemplate(),
    snapshotProof: {
      proofVersion: PRIVATE_PROOF_VERSION,
      algorithm: 'SHA-256',
      group: 'private-a',
      checkpointCount: 3,
      allMatched: true,
      matches: [true, true, true],
    },
    corpus: {
      sourceKind: 'codex',
      sessionCount: 2,
      rowCounts: { main: 1, protocol: 1, raw: 1 },
      sourceBytes: 3,
      dependencyCount: 0,
    },
    logicalAccountedBytes: {
      sessionMetadataBytes: 1,
      dependencyBytes: 1,
      catalogBytes: 1,
      legacyRawOwnerBytes: 1,
      queryStoreBytes: 1,
      totalBytes: 5,
    },
    runtimeMemory: {
      beforeBuild: memory(),
      committedAfterGc: memory(),
      committedDelta: memory(),
      processMaxRssBytes: 1,
      heapLimitBytes: 100,
      exposedGc: true,
    },
    build: {
      invocationCount: 1,
      elapsedMs: 1,
      before: memory(),
      observedTransientPeak: memory(),
      observedTransientPeakOverBefore: memory(),
      processMaxRssBytesAtBuildEnd: 1,
      sampling: { progressBoundarySamples: 1, preRawCompactionSamples: 1, postFinalizeSamples: 1 },
    },
    validation: {
      invocationCount: 1,
      elapsedMs: 1,
      before: memory(),
      observedTransientPeak: memory(),
      observedTransientPeakOverBefore: memory(),
      processMaxRssBytesAfterValidation: 1,
      chunkSamples: 1,
    },
    commit: {
      arithmeticBuildPlusValidationMs: 2,
      observedTransientPeak: memory(),
      observedTransientPeakOverBefore: memory(),
      processMaxRssBytes: 1,
      committedAfterGc: memory(),
      committedDelta: memory(),
    },
    materialization: {
      candidateCount: 2,
      ordinals: { small: 1, medium: 1, large: 2, largest: 2 },
      small: materializedClass(),
      medium: materializedClass(),
      large: materializedClass(),
      largest: materializedClass(),
      coldQueueing: {
        first: selection(),
        second: selection(),
        firstWaitToStartMs: 1,
        firstMaterializationMs: 1,
        secondQueueWaitMs: 1,
        secondMaterializationMs: 1,
        secondTotalMs: 2,
        queueDepthAtSecondAdmission: 1,
        activeCountAtSecondAdmission: 1,
        adapterCalls: 2,
        finalStats: ownerStats(),
      },
      quickSessionSwitch: {
        first: selection(),
        second: selection(),
        sourceStreamToSwitchMs: 1,
        switchToAbortObservationMs: 1,
        switchToWaiterRejectionMs: 1,
        secondQueueWaitMs: 1,
        switchToSecondCompletionMs: 1,
        queueDepthAtSecondAdmission: 1,
        activeCountAtSecondAdmission: 1,
        adapterCalls: 2,
        finalStats: ownerStats(),
      },
      largestCancellation: {
        selection: selection(),
        queuedToAbortMs: 1,
        queuedToWaiterRejectionMs: 1,
        queuedToJobSettlementMs: 1,
        cacheSessionCount: 0,
        completedCount: 0,
      },
    },
    scans: { main: scan(), protocol: scan(), raw: scan() },
    acceptance: {
      structural: true,
      privacyAuditPassed: true,
      snapshotProofVerifiedByRunner: true,
      numericalLatencyGate: false,
    },
  };
}

test('private artifact schema and leak audit allow only closed content-free output', () => {
  const artifact = minimalPrivateArtifact();
  assert.equal(validatePrivateArtifact(artifact), true);
  assert.equal(JSON.stringify(artifact).includes('sessionId'), false);
  assert.equal(JSON.stringify(artifact).includes('private-project'), false);

  assert.throws(
    () => validatePrivateArtifact({ ...artifact, unexpected: true }),
    /top-level schema is not closed/,
  );
  assert.throws(
    () => validatePrivateArtifact({
      ...artifact,
      invocationTemplate: { ...artifact.invocationTemplate, shell: 'powershell' },
    }),
    /invocationTemplate violates its closed schema/,
  );
  for (const absolutePath of [
    '/secret',
    '/private/file',
    'C:\\secret',
    '\\\\server\\share',
  ]) {
    assert.throws(
      () => validatePrivateArtifact({
        ...artifact,
        options: { ...artifact.options, repo: absolutePath },
      }),
      /forbidden string value/,
    );
  }
  assert.throws(
    () => validatePrivateArtifact({
      ...artifact,
      corpus: { ...artifact.corpus, sessionId: '18181818-1818-4181-8181-181818181818' },
    }),
    /closed nested schema/,
  );

  const summary = {
    schemaVersion: 3,
    artifactKind: 'performance-wave-0-summary',
    profileKind: 'private-corpus',
    mode: 'baseline',
    expectedRepeatCount: 3,
    validAttemptCount: 3,
    invalidAttemptCount: 0,
    processIsolation: {},
    identityEquality: {},
    proofEquality: {},
    hardExact: {},
    causal: {},
    exactCounterSet: {},
    observational: {},
    categoricalObservations: {},
    outliersRetained: true,
    acceptance: {},
    snapshotEquality: {
      proofVersion: PRIVATE_PROOF_VERSION,
      algorithm: 'SHA-256',
      group: 'private-v2-a',
      checkpointCount: 8,
      allMatched: true,
      copyMethod: 'independent-byte-copy',
    },
  };
  assert.equal(validatePrivateSummary(summary), true);
  assert.throws(
    () => validatePrivateSummary({
      ...summary,
      snapshotEquality: { ...summary.snapshotEquality, referenceDigest: 'secret' },
    }),
    /closed nested schema/,
  );
});

test('private snapshot aggregate SHA-256 is root-independent and detects name, length, and content changes', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-private-proof-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const makeTree = async (name, fileName = 'record.bin', value = 'same-content') => {
    const tree = path.join(root, name);
    await fsp.mkdir(path.join(tree, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(tree, 'nested', fileName), value);
    return tree;
  };
  const first = await makeTree('first');
  const second = await makeTree('second');
  const renamed = await makeTree('renamed', 'other.bin');
  const lengthChanged = await makeTree('length', 'record.bin', 'same-content-longer');
  const contentChanged = await makeTree('content', 'record.bin', 'same-contend');
  const firstDigest = await computePrivateSnapshotDigest(first);
  assert.equal(firstDigest, await computePrivateSnapshotDigest(second));
  assert.notEqual(firstDigest, await computePrivateSnapshotDigest(renamed));
  assert.notEqual(firstDigest, await computePrivateSnapshotDigest(lengthChanged));
  assert.notEqual(firstDigest, await computePrivateSnapshotDigest(contentChanged));
  assert.deepEqual(snapshotProofVerdict(firstDigest, [firstDigest, firstDigest], 'private-a'), {
    proofVersion: PRIVATE_PROOF_VERSION,
    algorithm: 'SHA-256',
    group: 'private-a',
    checkpointCount: 2,
    allMatched: true,
    matches: [true, true],
  });
  assert.equal(snapshotProofVerdict(firstDigest, [firstDigest, 'changed'], 'private-a').allMatched, false);
});

test('private proof v2 uses global UTF-8 ordinal paths and rejects root, child, and hard links', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-private-proof-v2-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const physical = path.join(root, 'physical');
  await fsp.mkdir(physical);
  await fsp.writeFile(path.join(physical, 'z.bin'), 'z');
  await fsp.writeFile(path.join(physical, 'ä.bin'), 'a-umlaut');
  const listed = await enumeratePrivateSnapshotFiles(physical);
  const expectedOrder = ['z.bin', 'ä.bin'].sort((left, right) => (
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  ));
  assert.deepEqual(listed.files.map((entry) => entry.relative), expectedOrder);

  const rootLink = path.join(root, 'root-link');
  await fsp.symlink(physical, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    computePrivateSnapshotDigest(rootLink),
    { code: 'PRIVATE_SNAPSHOT_ROOT_INVALID' },
  );

  const childTree = path.join(root, 'child-tree');
  const childTarget = path.join(root, 'child-target');
  await fsp.mkdir(childTree);
  await fsp.mkdir(childTarget);
  await fsp.writeFile(path.join(childTarget, 'outside.bin'), 'outside');
  await fsp.symlink(
    childTarget,
    path.join(childTree, 'linked-child'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    computePrivateSnapshotDigest(childTree),
    { code: 'PRIVATE_SNAPSHOT_ENTRY_INVALID' },
  );

  const hardLinkTree = path.join(root, 'hard-link-tree');
  await fsp.mkdir(hardLinkTree);
  const original = path.join(hardLinkTree, 'original.bin');
  await fsp.writeFile(original, 'hard-link-content');
  try {
    await fsp.link(original, path.join(hardLinkTree, 'alias.bin'));
    await assert.rejects(
      computePrivateSnapshotDigest(hardLinkTree),
      { code: 'PRIVATE_SNAPSHOT_HARD_LINK' },
    );
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }
});

test('private CLI failures expose only closed stable error codes', () => {
  const privatePath = path.join(os.tmpdir(), 'private-source', 'secret.jsonl');
  const line = privateCliErrorLine(Object.assign(
    new Error(`EACCES reading ${privatePath}`),
    { code: 'EACCES' },
  ));
  assert.equal(line, 'PERFORMANCE_WAVE_0_ERROR:PRIVATE_PROFILE_FAILURE\n');
  assert.equal(line.includes(privatePath), false);
  assert.equal(line.includes('EACCES reading'), false);
  assert.equal(
    privateCliErrorLine({ code: 'INVALID_PROFILE_ARGUMENT', message: privatePath }),
    'PERFORMANCE_WAVE_0_ERROR:INVALID_PROFILE_ARGUMENT\n',
  );
});

test('materialization profile selects deterministic decile, median, and maximum classes', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    id: `session-${String(index + 1).padStart(2, '0')}`,
    bytes: (index + 1) * 100,
  }));
  const selected = selectMaterializationCandidates(sessions);
  assert.equal(selected.candidateCount, 10);
  assert.deepEqual(
    Object.fromEntries(
      ['small', 'medium', 'large', 'largest'].map((name) => [
        name,
        { ordinal: selected[name].ordinal, bytes: selected[name].session.bytes },
      ]),
    ),
    {
      small: { ordinal: 1, bytes: 100 },
      medium: { ordinal: 5, bytes: 500 },
      large: { ordinal: 9, bytes: 900 },
      largest: { ordinal: 10, bytes: 1000 },
    },
  );
  assert.equal(selectMaterializationCandidates([{ id: 'empty', bytes: 0 }]), null);
});

test('controlled lifecycle comparison accepts only bounded content-free fixture options', () => {
  assert.deepEqual(
    lifecycleComparison.parseArgs([
      '--pre-root', '.',
      '--event-count', '2400',
      '--text-bytes', '4096',
      '--warm-repeats', '5',
    ]),
    {
      preRoot: require('node:path').resolve('.'),
      eventCount: 2400,
      textBytes: 4096,
      warmRepeats: 5,
    },
  );
  assert.throws(
    () => lifecycleComparison.parseArgs(['--pre-root', '.', '--warm-repeats', '11']),
    { code: 'INVALID_PROFILE_ARGUMENT' },
  );
  for (const args of [
    ['--pre-root', '.', '--event-count', '20001'],
    ['--pre-root', '.', '--text-bytes', '65537'],
    ['--pre-root', '.', '--event-count', '2000', '--text-bytes', '40000'],
  ]) {
    assert.throws(
      () => lifecycleComparison.parseArgs(args),
      { code: 'INVALID_PROFILE_ARGUMENT' },
    );
  }
});
