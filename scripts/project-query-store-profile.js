'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { promisify } = require('node:util');
const v8 = require('node:v8');
const { gunzip } = require('node:zlib');
const {
  getSourceAdapter,
  materializeSessionForIndex,
  normalizeSourceKind,
  queryForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { SESSION_LIFECYCLE } = require('../src/source-adapter-contract');
const {
  createMaterializationScheduler,
  createMaterializedSessionOwner,
} = require('../src/materialized-session-owner');
const {
  buildProjectQueryStore,
  scanProjectQueryShard,
} = require('../src/project-query-store');
const {
  captureGitIdentity,
  utf8OrdinalCompare,
} = require('./performance-wave-0-identity');

const gunzipAsync = promisify(gunzip);
const PROFILE_QUERY = '__session_analyzer_absent_project_query_profile_phrase__';
const PROFILE_LAYERS = Object.freeze(['main', 'protocol', 'raw']);
const PROFILE_SCHEMA_VERSION = 3;
const PRIVATE_PROOF_VERSION = 2;
const PRIVATE_PROOF_TAG = 'performance-wave-0-private-copy-v2';
const INSPECTED_BASE_SHA = 'd370cc7bca56380457c147dc4c33637a0baedf68';
const PRE_WAVE_0_HEAD = '377a0356fe884a5a95f234bd5d6f22240ca8052b';
const S1_M0_SCHEMA_VERSION = 1;
const S1_M0_BASELINE_SHA = 'f9eaa5f686e98d814c3e3ac29c2ff3cc3ba1e7aa';
const S1_M0_SCAN_CONCURRENCY = 8;
const S1_M0_QUERY_TEXT = Object.freeze({
  absent: PROFILE_QUERY,
  sparse: '__session_analyzer_s1_m0_sparse_hit__',
  dense: '__session_analyzer_s1_m0_dense_hit__',
});
const S1_M0_QUERY_CLASSES = Object.freeze(Object.keys(S1_M0_QUERY_TEXT));
const S1_M0_METRIC_FIELDS = Object.freeze([
  'eligibleSessions',
  'sessionsScanned',
  'rowsScanned',
  'structurallyEligibleRows',
  'rowsHit',
  'textChunksDecoded',
  'identityTextChunks',
  'gzipTextChunks',
  'compressedTextBytes',
  'uncompressedTextBytes',
  'previewSearchInvocations',
  'searchTextSearchInvocations',
  'booleanHitChecks',
  'previewMatchOccurrences',
  'searchTextMatchOccurrences',
  'fullOccurrenceIterations',
  'matchingEvents',
  'matchingSessions',
  'latestEventSelections',
  'latestEventComparisons',
  'snippetHydrations',
  'resultDtoConstructions',
]);
const S1_M0_CANDIDATE_FIELDS = Object.freeze([
  'previewSearchInvocations',
  'searchTextSearchInvocations',
  'booleanHitChecks',
  'firstMatchDetections',
  'searchTextInvocationsAvoided',
  'fullOccurrenceIterationsAvoided',
  'rowHitMismatches',
  'exactRowHitParity',
  'exactProjectResultParity',
]);
const S1_M0_PHASE_FIELDS = Object.freeze([
  'eligibleSessionSelection',
  'packedMetadataTraversal',
  'gzipDecodeOnly',
  'frameStringMaterializationOnly',
  'textDecodeMaterializationTraversal',
  'currentFullOccurrenceHitDetection',
  'shortCircuitBooleanHitDetection',
  'resultAggregationLatestSelection',
  'productionProjectScopeQuery',
  'latestResultPresentationHydration',
]);
const SERVER_ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'identity',
  'environment',
  'options',
  'invocationTemplate',
  'snapshotProof',
  'corpus',
  'logicalAccountedBytes',
  'runtimeMemory',
  'build',
  'validation',
  'commit',
  'materialization',
  'scans',
  'acceptance',
]);
const FORBIDDEN_PRIVATE_KEYS = new Set([
  'argv',
  'command',
  'commands',
  'content',
  'cwd',
  'dependencySetId',
  'digest',
  'hmac',
  'message',
  'output',
  'path',
  'prompt',
  'rawUrl',
  'repoPath',
  'sessionId',
  'sourceHomePath',
  'sourcePath',
  'url',
]);
const PRIVATE_PROOF_ERROR_CODES = new Set([
  'PRIVATE_SNAPSHOT_ROOT_INVALID',
  'PRIVATE_SNAPSHOT_ENTRY_INVALID',
  'PRIVATE_SNAPSHOT_ESCAPE',
  'PRIVATE_SNAPSHOT_HARD_LINK',
  'PRIVATE_SNAPSHOT_IO_FAILURE',
]);

function usageError(message) {
  const error = new Error(`${message}\nUsage: node --expose-gc scripts/project-query-store-profile.js --source <codex|claude-code> --repo <path> [--source-home <path>] [--repeats <1..20>] [--snapshot-group <opaque-label>] [--repetition-index <n> --repetition-count <n>]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseArgs(argv) {
  const options = {
    source: '',
    repo: '',
    sourceHome: '',
    repeats: 3,
    snapshotGroup: 'unassigned',
    repetitionIndex: 1,
    repetitionCount: 1,
    candidateSha: '',
    targetSyncSha: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (![
      '--source', '--repo', '--source-home', '--repeats', '--snapshot-group',
      '--repetition-index', '--repetition-count', '--candidate-sha', '--target-sync-sha',
    ].includes(name)) {
      throw usageError(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--source') options.source = normalizeSourceKind(value);
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--candidate-sha') options.candidateSha = value;
    if (name === '--target-sync-sha') options.targetSyncSha = value;
    if (name === '--snapshot-group') {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)) {
        throw usageError('--snapshot-group must be an opaque alphanumeric/hyphen label of at most 64 characters');
      }
      options.snapshotGroup = value;
    }
    if (name === '--repeats') {
      options.repeats = Number(value);
      if (!Number.isSafeInteger(options.repeats) || options.repeats < 1 || options.repeats > 20) {
        throw usageError('--repeats must be an integer from 1 through 20');
      }
    }
    if (name === '--repetition-index' || name === '--repetition-count') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw usageError(`${name} must be a positive integer`);
      }
      if (name === '--repetition-index') options.repetitionIndex = parsed;
      else options.repetitionCount = parsed;
    }
  }
  if (!options.source) throw usageError('--source is required');
  if (!options.repo) throw usageError('--repo is required');
  if (options.repetitionIndex > options.repetitionCount) {
    throw usageError('--repetition-index must not exceed --repetition-count');
  }
  for (const [name, value] of [
    ['--candidate-sha', options.candidateSha],
    ['--target-sync-sha', options.targetSyncSha],
  ]) {
    if (value && !/^[0-9a-f]{40}$/.test(value)) throw usageError(`${name} must be a full commit SHA`);
  }
  const adapter = getSourceAdapter(options.source);
  if (!adapter) throw usageError(`Unsupported source: ${options.source}`);
  return { ...options, adapter };
}

function m0UsageError(message) {
  const error = new Error(`${message}\nUsage: node scripts/project-query-store-profile.js --m0-q-scan <synthetic|private> [--source <codex|claude-code> --repo <path> --source-home <external-copy> --snapshot-group <opaque-label>] [--repeats <1..20>]`);
  error.code = 'INVALID_PROFILE_ARGUMENT';
  return error;
}

function parseM0Args(argv) {
  const options = {
    profileKind: '',
    source: '',
    repo: '',
    sourceHome: '',
    repeats: 5,
    snapshotGroup: 'synthetic',
  };
  const allowed = new Set([
    '--m0-q-scan', '--source', '--repo', '--source-home', '--repeats', '--snapshot-group',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!allowed.has(name)) throw m0UsageError(`Unknown option: ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw m0UsageError(`Missing value for ${name}`);
    index += 1;
    if (name === '--m0-q-scan') options.profileKind = value;
    if (name === '--source') options.source = normalizeSourceKind(value);
    if (name === '--repo') options.repo = path.resolve(value);
    if (name === '--source-home') options.sourceHome = path.resolve(value);
    if (name === '--repeats') {
      options.repeats = Number(value);
      if (!Number.isSafeInteger(options.repeats) || options.repeats < 1 || options.repeats > 20) {
        throw m0UsageError('--repeats must be an integer from 1 through 20');
      }
    }
    if (name === '--snapshot-group') {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)) {
        throw m0UsageError('--snapshot-group must be an opaque alphanumeric/hyphen label of at most 64 characters');
      }
      options.snapshotGroup = value;
    }
  }
  if (!['synthetic', 'private'].includes(options.profileKind)) {
    throw m0UsageError('--m0-q-scan must be synthetic or private');
  }
  if (options.profileKind === 'synthetic') {
    if (options.source || options.repo || options.sourceHome || options.snapshotGroup !== 'synthetic') {
      throw m0UsageError('synthetic M0 profiling does not accept private-corpus options');
    }
    return { ...options, source: 'synthetic', adapter: null };
  }
  if (!options.source || !options.repo || !options.sourceHome) {
    throw m0UsageError('private M0 profiling requires --source, --repo, and --source-home');
  }
  if (options.snapshotGroup === 'synthetic') {
    throw m0UsageError('private M0 profiling requires an opaque --snapshot-group');
  }
  const adapter = getSourceAdapter(options.source);
  if (!adapter) throw m0UsageError(`Unsupported source: ${options.source}`);
  return { ...options, adapter };
}

function memorySample() {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    rss: memory.rss,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function memoryDelta(after, before) {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
}

function memoryMaximum(left, right) {
  return Object.fromEntries(Object.keys(left).map((key) => [key, Math.max(left[key], right[key])]));
}

function redactedSessionSelection(session) {
  return {
    sourceBytes: session.bytes,
    rawRows: session.rawEventCount,
    logicalRows: session.logicalEventCount,
  };
}

function timingStats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    repeatCount: sorted.length,
    medianMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

async function m0TimeAsync(repeats, task) {
  const values = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const started = performance.now();
    await task();
    values.push(performance.now() - started);
  }
  return timingStats(values);
}

function m0TimeSync(repeats, task) {
  const values = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const started = performance.now();
    task();
    values.push(performance.now() - started);
  }
  return timingStats(values);
}

function createM0SyntheticIndex(options = {}) {
  const sessionCount = options.sessionCount ?? 12;
  const rowsPerSession = options.rowsPerSession ?? 768;
  const sparseEvery = options.sparseEvery ?? 97;
  const densePreviewOccurrences = options.densePreviewOccurrences ?? 8;
  const denseSearchTextOccurrences = options.denseSearchTextOccurrences ?? 24;
  for (const [name, value] of Object.entries({
    sessionCount,
    rowsPerSession,
    sparseEvery,
    densePreviewOccurrences,
    denseSearchTextOccurrences,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw m0UsageError(`Synthetic fixture ${name} must be a positive integer`);
    }
  }
  const densePreview = Array(densePreviewOccurrences).fill(S1_M0_QUERY_TEXT.dense).join(' ');
  const denseSearchText = Array(denseSearchTextOccurrences).fill(S1_M0_QUERY_TEXT.dense).join(' ');
  const sessions = [];
  let globalOrdinal = 0;
  for (let sessionOrdinal = 0; sessionOrdinal < sessionCount; sessionOrdinal += 1) {
    const logicalEvents = [];
    for (let rowOrdinal = 0; rowOrdinal < rowsPerSession; rowOrdinal += 1) {
      const sparseOrdinal = globalOrdinal % sparseEvery === 0
        ? Math.floor(globalOrdinal / sparseEvery)
        : -1;
      const sparseInPreview = sparseOrdinal >= 0 && sparseOrdinal % 2 === 0;
      const sparseInSearchText = sparseOrdinal >= 0 && !sparseInPreview;
      const preview = [
        'synthetic-preview',
        densePreview,
        sparseInPreview ? S1_M0_QUERY_TEXT.sparse : '',
        'p'.repeat(320),
      ].filter(Boolean).join(' ');
      const searchText = [
        'synthetic-search-text',
        denseSearchText,
        sparseInSearchText ? S1_M0_QUERY_TEXT.sparse : '',
        's'.repeat(960),
      ].filter(Boolean).join(' ');
      logicalEvents.push({
        id: `synthetic-event-${sessionOrdinal}-${rowOrdinal}`,
        layer: 'main',
        timestamp: new Date(Date.UTC(2026, 7, 31) + globalOrdinal * 1000).toISOString(),
        kind: 'message',
        subtype: 'assistant_message',
        status: '',
        toolName: '',
        label: 'Synthetic Event',
        preview,
        searchText,
        source: { file: 'synthetic-source' },
        touchedFiles: [],
        rawRefs: [],
      });
      globalOrdinal += 1;
    }
    sessions.push({
      id: `synthetic-session-${sessionOrdinal}`,
      logicalEvents,
      rawEvents: [],
    });
  }
  const projectQueryStore = buildProjectQueryStore(sessions);
  const projectedSessions = sessions.map((session, sessionOrdinal) => ({
    id: session.id,
    sourceKind: 'codex',
    sourceSessionId: session.id,
    sourceDerivedId: '',
    sourceClientVersion: '',
    projectAssociation: '',
    title: `Synthetic Session ${sessionOrdinal + 1}`,
    sourceFile: 'synthetic-source',
    bytes: session.logicalEvents.reduce((sum, event) => (
      sum + Buffer.byteLength(event.preview, 'utf8') + Buffer.byteLength(event.searchText, 'utf8')
    ), 0),
    lineCount: rowsPerSession,
    cwdSet: [],
    parentSessionId: '',
    parentSessionInferred: false,
    forkedFromSessionId: '',
    forkStorageMode: '',
    forkedAt: '',
    forkPointUuid: '',
    forkContinuationState: '',
    forkEvidence: null,
    inheritedContext: null,
    supersededBySessionId: '',
    supersededAt: '',
    supersededReason: '',
    agentNickname: '',
    primarySessionMetaKind: '',
    derivedRunId: '',
    derivedRelationship: null,
    startedAt: session.logicalEvents[0]?.timestamp || '',
    updatedAt: session.logicalEvents.at(-1)?.timestamp || '',
    counts: {},
    rawEventCount: 0,
    logicalEventCount: rowsPerSession,
    summary: {
      topTools: [],
      failedCommandCount: 0,
      patchedFiles: [],
      protocolCount: 0,
    },
    queryShardId: session.id,
  }));
  return {
    sourceKind: 'codex',
    repoRoot: 'synthetic-project',
    sessions: projectedSessions,
    sessionsById: new Map(projectedSessions.map((session) => [session.id, session])),
    projectQueryStore,
    materializationDependencies: new Map(),
  };
}

function selectM0EligibleSessions(index, filters = {}) {
  return (index.sessions || []).filter((session) => {
    const activityAt = String(session.updatedAt || session.startedAt || '');
    if (filters.from && activityAt < `${filters.from}T00:00:00.000Z`) return false;
    if (filters.to && activityAt > `${filters.to}T23:59:59.999Z`) return false;
    return true;
  });
}

function m0LayerChunks(index, eligibleSessions, layer) {
  const chunks = [];
  for (const session of eligibleSessions) {
    const shard = index.projectQueryStore.shardsBySessionId.get(session.id)?.[layer];
    if (!shard) continue;
    for (const chunk of shard.textChunks) chunks.push(chunk);
  }
  return chunks;
}

function m0LayerInventory(index, eligibleSessions, layer) {
  const inventory = {
    eligibleSessions: eligibleSessions.length,
    sessionsScanned: eligibleSessions.length,
    rowsScanned: 0,
    structurallyEligibleRows: 0,
    textChunksDecoded: 0,
    identityTextChunks: 0,
    gzipTextChunks: 0,
    compressedTextBytes: 0,
    uncompressedTextBytes: 0,
  };
  for (const session of eligibleSessions) {
    const shard = index.projectQueryStore.shardsBySessionId.get(session.id)?.[layer];
    if (!shard) continue;
    inventory.rowsScanned += shard.rowCount;
    inventory.structurallyEligibleRows += shard.rowCount;
    for (const chunk of shard.textChunks) {
      inventory.textChunksDecoded += 1;
      if (chunk.codec === 'identity') inventory.identityTextChunks += 1;
      if (chunk.codec === 'gzip-1') inventory.gzipTextChunks += 1;
      inventory.compressedTextBytes += chunk.data.byteLength;
      inventory.uncompressedTextBytes += chunk.uncompressedBytes;
    }
  }
  return inventory;
}

async function scanM0Layer(index, eligibleSessions, layer, options, visit) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < eligibleSessions.length) {
      options.signal?.throwIfAborted?.();
      const sessionIndex = nextIndex;
      nextIndex += 1;
      const session = eligibleSessions[sessionIndex];
      await scanProjectQueryShard(index.projectQueryStore, session.id, layer, options, (row, rowIndex) => {
        visit(row, rowIndex, session, sessionIndex);
      });
    }
  }
  const workerCount = Math.min(S1_M0_SCAN_CONCURRENCY, eligibleSessions.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function decodeM0GzipChunks(chunks) {
  let nextIndex = 0;
  let decodedBytes = 0;
  async function worker() {
    while (nextIndex < chunks.length) {
      const chunkIndex = nextIndex;
      nextIndex += 1;
      const chunk = chunks[chunkIndex];
      const decoded = await gunzipAsync(chunk.data);
      if (decoded.length !== chunk.uncompressedBytes) {
        throw new Error('M0 gzip-only decode observed an inflated length mismatch');
      }
      decodedBytes += decoded.length;
    }
  }
  const workerCount = Math.min(S1_M0_SCAN_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return decodedBytes;
}

function materializeM0FrameStrings(decodedChunks) {
  let materializedCharacters = 0;
  for (const descriptor of decodedChunks) {
    const { buffer, chunk } = descriptor;
    for (let localIndex = 0; localIndex < chunk.rowCount; localIndex += 1) {
      const start = chunk.rowOffsets[localIndex];
      const end = chunk.rowOffsets[localIndex + 1];
      if (end - start < 8) throw new Error('M0 frame materialization observed a truncated frame');
      const previewLength = buffer.readUInt32LE(start);
      const searchLength = buffer.readUInt32LE(start + 4);
      const previewStart = start + 8;
      const searchStart = previewStart + previewLength;
      if (searchStart + searchLength !== end) {
        throw new Error('M0 frame materialization observed invalid frame lengths');
      }
      const preview = buffer.toString('utf8', previewStart, searchStart);
      const searchText = buffer.toString('utf8', searchStart, end);
      materializedCharacters += preview.length + searchText.length;
    }
  }
  return materializedCharacters;
}

async function profileM0DecodePhases(chunks, repeats) {
  const gzipChunks = chunks.filter((chunk) => chunk.codec === 'gzip-1');
  let gzipDecodeOnly = null;
  if (gzipChunks.length > 0) {
    await decodeM0GzipChunks(gzipChunks);
    gzipDecodeOnly = await m0TimeAsync(repeats, () => decodeM0GzipChunks(gzipChunks));
  }
  const decodedChunks = [];
  for (const chunk of chunks) {
    const buffer = chunk.codec === 'identity' ? chunk.data : await gunzipAsync(chunk.data);
    if (buffer.length !== chunk.uncompressedBytes) {
      throw new Error('M0 frame materialization setup observed an inflated length mismatch');
    }
    decodedChunks.push({ buffer, chunk });
  }
  materializeM0FrameStrings(decodedChunks);
  const frameStringMaterializationOnly = m0TimeSync(
    repeats,
    () => materializeM0FrameStrings(decodedChunks),
  );
  return { gzipDecodeOnly, frameStringMaterializationOnly };
}

async function captureM0Rows(index, eligibleSessions, layer) {
  const captured = eligibleSessions.map((session) => ({ session, rows: [] }));
  await scanM0Layer(index, eligibleSessions, layer, { includeText: true }, (
    row,
    rowIndex,
    _session,
    sessionIndex,
  ) => {
    captured[sessionIndex].rows.push({ row, rowIndex });
  });
  return captured;
}

function m0SearchPhraseRegex(q, flags = '') {
  const phrase = String(q || '').trim();
  if (!phrase) return null;
  const pattern = phrase
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(pattern, flags.includes('i') ? flags : `${flags}i`);
}

function m0CountSearchMatches(text, q) {
  const regex = m0SearchPhraseRegex(q, 'g');
  return regex ? [...String(text || '').matchAll(regex)].length : 0;
}

function m0CurrentEventHasSearchHit(row, q) {
  return Math.max(
    m0CountSearchMatches(row.preview, q),
    m0CountSearchMatches(row.searchText, q),
  ) > 0;
}

function m0BooleanSearch(text, q) {
  const regex = m0SearchPhraseRegex(q);
  return regex ? regex.test(String(text || '')) : true;
}

function m0ShortCircuitEventHasSearchHit(row, q) {
  return m0BooleanSearch(row.preview, q) || m0BooleanSearch(row.searchText, q);
}

function evaluateM0Matchers(captured, q) {
  const current = {
    previewSearchInvocations: 0,
    searchTextSearchInvocations: 0,
    booleanHitChecks: 0,
    previewMatchOccurrences: 0,
    searchTextMatchOccurrences: 0,
    fullOccurrenceIterations: 0,
  };
  const candidate = {
    previewSearchInvocations: 0,
    searchTextSearchInvocations: 0,
    booleanHitChecks: 0,
    firstMatchDetections: 0,
    searchTextInvocationsAvoided: 0,
    fullOccurrenceIterationsAvoided: 0,
    rowHitMismatches: 0,
    exactRowHitParity: false,
    exactProjectResultParity: false,
  };
  const currentHits = captured.map(() => []);
  const candidateHits = captured.map(() => []);
  for (let sessionIndex = 0; sessionIndex < captured.length; sessionIndex += 1) {
    for (const { row } of captured[sessionIndex].rows) {
      current.booleanHitChecks += 1;
      current.previewSearchInvocations += 1;
      const previewOccurrences = m0CountSearchMatches(row.preview, q);
      current.previewMatchOccurrences += previewOccurrences;
      current.searchTextSearchInvocations += 1;
      const searchTextOccurrences = m0CountSearchMatches(row.searchText, q);
      current.searchTextMatchOccurrences += searchTextOccurrences;
      const currentHit = Math.max(previewOccurrences, searchTextOccurrences) > 0;
      currentHits[sessionIndex].push(currentHit);

      candidate.booleanHitChecks += 1;
      candidate.previewSearchInvocations += 1;
      let candidateHit = m0BooleanSearch(row.preview, q);
      if (!candidateHit) {
        candidate.searchTextSearchInvocations += 1;
        candidateHit = m0BooleanSearch(row.searchText, q);
      }
      if (candidateHit) candidate.firstMatchDetections += 1;
      candidateHits[sessionIndex].push(candidateHit);
      if (candidateHit !== currentHit) candidate.rowHitMismatches += 1;
    }
  }
  current.fullOccurrenceIterations = current.previewMatchOccurrences
    + current.searchTextMatchOccurrences;
  candidate.searchTextInvocationsAvoided = current.searchTextSearchInvocations
    - candidate.searchTextSearchInvocations;
  candidate.fullOccurrenceIterationsAvoided = Math.max(
    0,
    current.fullOccurrenceIterations - candidate.firstMatchDetections,
  );
  candidate.exactRowHitParity = candidate.rowHitMismatches === 0;
  return { current, candidate, currentHits, candidateHits };
}

function m0AggregateHits(captured, hitsBySession) {
  const results = [];
  let matchingEvents = 0;
  let latestEventSelections = 0;
  let latestEventComparisons = 0;
  for (let sessionIndex = 0; sessionIndex < captured.length; sessionIndex += 1) {
    const { session, rows } = captured[sessionIndex];
    let eventCount = 0;
    let latest = null;
    for (let timelineIndex = 0; timelineIndex < rows.length; timelineIndex += 1) {
      if (!hitsBySession[sessionIndex][timelineIndex]) continue;
      const candidate = { ...rows[timelineIndex], timelineIndex };
      eventCount += 1;
      matchingEvents += 1;
      if (!latest) {
        latest = candidate;
        latestEventSelections += 1;
        continue;
      }
      latestEventComparisons += 1;
      if (String(candidate.row.timestamp).localeCompare(String(latest.row.timestamp)) > 0
          || (candidate.row.timestamp === latest.row.timestamp
            && candidate.timelineIndex > latest.timelineIndex)) {
        latest = candidate;
        latestEventSelections += 1;
      }
    }
    if (latest) results.push({ session, eventCount, latest });
  }
  results.sort((left, right) => {
    const timestampOrder = String(right.latest.row.timestamp)
      .localeCompare(String(left.latest.row.timestamp));
    if (timestampOrder) return timestampOrder;
    const timelineOrder = right.latest.timelineIndex - left.latest.timelineIndex;
    if (timelineOrder) return timelineOrder;
    return String(left.session.id).localeCompare(String(right.session.id));
  });
  return {
    matchingEvents,
    matchingSessions: results.length,
    latestEventSelections,
    latestEventComparisons,
    snippetHydrations: results.length,
    resultDtoConstructions: results.length,
    signature: {
      total: results.length,
      matchingEventTotal: matchingEvents,
      sessions: results.map(({ session, eventCount, latest }) => ({
        sessionId: session.id,
        eventCount,
        eventId: latest.row.eventId,
        timestamp: latest.row.timestamp,
        timelineIndex: latest.timelineIndex,
      })),
    },
  };
}

function m0ProductionSignature(result) {
  return {
    total: result.total,
    matchingEventTotal: result.matchingEventTotal,
    sessions: result.sessions.map((session) => ({
      sessionId: session.id,
      eventCount: session.searchMatch.eventCount,
      eventId: session.searchMatch.latestEvent.id,
      timestamp: session.searchMatch.latestEvent.timestamp,
      timelineIndex: session.searchMatch.latestEvent.timelineIndex,
    })),
  };
}

function timeM0Matcher(rows, q, matcher, repeats) {
  let checksum = 0;
  const run = () => {
    let hits = 0;
    for (const row of rows) {
      if (matcher(row, q)) hits += 1;
    }
    checksum ^= hits;
  };
  run();
  const result = m0TimeSync(repeats, run);
  if (checksum < 0) throw new Error('M0 matcher checksum is invalid');
  return result;
}

async function profileM0QueryClass({
  index,
  query,
  layer,
  queryClass,
  q,
  repeats,
  captured,
  inventory,
  traversalTimings,
}) {
  const evaluated = evaluateM0Matchers(captured, q);
  const currentAggregate = m0AggregateHits(captured, evaluated.currentHits);
  const candidateAggregate = m0AggregateHits(captured, evaluated.candidateHits);
  const rows = captured.flatMap((entry) => entry.rows.map(({ row }) => row));
  const currentFullOccurrenceHitDetection = timeM0Matcher(
    rows,
    q,
    m0CurrentEventHasSearchHit,
    repeats,
  );
  const shortCircuitBooleanHitDetection = timeM0Matcher(
    rows,
    q,
    m0ShortCircuitEventHasSearchHit,
    repeats,
  );
  m0AggregateHits(captured, evaluated.currentHits);
  const resultAggregationLatestSelection = m0TimeSync(
    repeats,
    () => m0AggregateHits(captured, evaluated.currentHits),
  );
  const filters = { q, layer, locale: 'en' };
  await query.filterSessions(index, filters);
  let productionResult = null;
  const productionProjectScopeQuery = await m0TimeAsync(repeats, async () => {
    productionResult = await query.filterSessions(index, filters);
  });
  const profilerModelMatchesProduction = JSON.stringify(currentAggregate.signature)
    === JSON.stringify(m0ProductionSignature(productionResult));
  const shortCircuitMatchesCurrent = evaluated.candidate.exactRowHitParity
    && JSON.stringify(currentAggregate.signature) === JSON.stringify(candidateAggregate.signature);
  evaluated.candidate.exactProjectResultParity = profilerModelMatchesProduction
    && shortCircuitMatchesCurrent;
  return {
    metrics: {
      ...inventory,
      rowsHit: currentAggregate.matchingEvents,
      previewSearchInvocations: evaluated.current.previewSearchInvocations,
      searchTextSearchInvocations: evaluated.current.searchTextSearchInvocations,
      booleanHitChecks: evaluated.current.booleanHitChecks,
      previewMatchOccurrences: evaluated.current.previewMatchOccurrences,
      searchTextMatchOccurrences: evaluated.current.searchTextMatchOccurrences,
      fullOccurrenceIterations: evaluated.current.fullOccurrenceIterations,
      matchingEvents: currentAggregate.matchingEvents,
      matchingSessions: currentAggregate.matchingSessions,
      latestEventSelections: currentAggregate.latestEventSelections,
      latestEventComparisons: currentAggregate.latestEventComparisons,
      snippetHydrations: currentAggregate.snippetHydrations,
      resultDtoConstructions: currentAggregate.resultDtoConstructions,
    },
    candidateAssessment: evaluated.candidate,
    phaseTimings: {
      ...traversalTimings,
      currentFullOccurrenceHitDetection,
      shortCircuitBooleanHitDetection,
      resultAggregationLatestSelection,
      productionProjectScopeQuery,
      latestResultPresentationHydration: null,
    },
    parity: {
      profilerModelMatchesProduction,
      shortCircuitMatchesCurrent,
    },
  };
}

async function profileM0Layer(
  index,
  layer,
  queryClasses,
  repeats,
  queryTexts = S1_M0_QUERY_TEXT,
) {
  const filters = { layer };
  selectM0EligibleSessions(index, filters);
  const eligibleSessionSelection = m0TimeSync(
    repeats,
    () => selectM0EligibleSessions(index, filters),
  );
  const eligibleSessions = selectM0EligibleSessions(index, filters);
  const inventory = m0LayerInventory(index, eligibleSessions, layer);
  await scanM0Layer(index, eligibleSessions, layer, { includeText: false }, () => {});
  const packedMetadataTraversal = await m0TimeAsync(repeats, () => (
    scanM0Layer(index, eligibleSessions, layer, { includeText: false }, () => {})
  ));
  await scanM0Layer(index, eligibleSessions, layer, { includeText: true }, () => {});
  const textDecodeMaterializationTraversal = await m0TimeAsync(repeats, () => (
    scanM0Layer(index, eligibleSessions, layer, { includeText: true }, () => {})
  ));
  const chunks = m0LayerChunks(index, eligibleSessions, layer);
  const decodePhases = await profileM0DecodePhases(chunks, repeats);
  const captured = await captureM0Rows(index, eligibleSessions, layer);
  const query = queryForIndex(index);
  const traversalTimings = {
    eligibleSessionSelection,
    packedMetadataTraversal,
    gzipDecodeOnly: decodePhases.gzipDecodeOnly,
    frameStringMaterializationOnly: decodePhases.frameStringMaterializationOnly,
    textDecodeMaterializationTraversal,
  };
  const profiledClasses = {};
  for (const queryClass of queryClasses) {
    profiledClasses[queryClass] = await profileM0QueryClass({
      index,
      query,
      layer,
      queryClass,
      q: queryTexts[queryClass],
      repeats,
      captured,
      inventory,
      traversalTimings,
    });
  }
  return { queryClasses: profiledClasses };
}

async function profileM0Abort(index, layer, q = S1_M0_QUERY_TEXT.absent) {
  const query = queryForIndex(index);
  const controller = new AbortController();
  let completedRows = 0;
  let completedChunks = 0;
  let decodedTextChunks = 0;
  let rowsProcessedBeforeAbort = 0;
  let textChunksProcessedBeforeAbort = 0;
  let textChunksDecodedBeforeAbort = 0;
  let abortRequestedAt = 0;
  let abortObserved = false;
  try {
    await query.filterSessions(index, {
      q,
      layer,
      locale: 'en',
    }, {
      signal: controller.signal,
      onTextChunk() {
        decodedTextChunks += 1;
      },
      onChunk({ rowCount }) {
        completedChunks += 1;
        completedRows += rowCount;
        if (abortRequestedAt !== 0) return;
        rowsProcessedBeforeAbort = completedRows;
        textChunksProcessedBeforeAbort = completedChunks;
        textChunksDecodedBeforeAbort = decodedTextChunks;
        abortRequestedAt = performance.now();
        controller.abort();
      },
    });
  } catch (error) {
    abortObserved = error?.name === 'AbortError' && controller.signal.aborted;
    if (!abortObserved) throw error;
  }
  const settledAt = performance.now();
  return {
    layer,
    abortRequested: abortRequestedAt !== 0,
    abortObserved,
    rowsProcessedBeforeAbort,
    textChunksProcessedBeforeAbort,
    textChunksDecodedBeforeAbort,
    abortToSettlementMs: abortRequestedAt === 0 ? 0 : settledAt - abortRequestedAt,
  };
}

function m0CorpusFacts(index) {
  return {
    sourceKind: index.sourceKind,
    sessionCount: index.sessions.length,
    rowCounts: aggregateRows(index.projectQueryStore),
    sourceBytes: index.sessions.reduce((sum, session) => sum + Number(session.bytes || 0), 0),
    dependencyCount: index.materializationDependencies instanceof Map
      ? index.materializationDependencies.size
      : 0,
    queryStoreAccountedBytes: Number(index.projectQueryStore.accountedBytes || 0),
  };
}

function m0ArtifactOptions(options, layers, queryClasses) {
  return {
    source: options.source,
    repo: options.profileKind === 'private' ? '<redacted>' : '<synthetic>',
    sourceHome: options.profileKind === 'private' ? '<redacted>' : '<synthetic>',
    repeats: options.repeats,
    layers,
    queryClasses,
  };
}

function m0StructuralAcceptance(layers, abort) {
  const queryResults = Object.values(layers).flatMap((layer) => (
    Object.entries(layer.queryClasses)
  ));
  return abort.abortRequested === true
    && abort.abortObserved === true
    && queryResults.length > 0
    && queryResults.every(([queryClass, result]) => (
      (queryClass !== 'absent' || result.metrics.rowsHit === 0)
      && result.metrics.matchingEvents === result.metrics.rowsHit
      && result.parity.profilerModelMatchesProduction === true
      && result.parity.shortCircuitMatchesCurrent === true
      && result.candidateAssessment.exactProjectResultParity === true
    ));
}

function createM0Artifact({
  options,
  index,
  layers,
  queryClasses,
  snapshotProof,
  fixtureShape,
  abort,
}) {
  const layerNames = Object.keys(layers);
  const sourceSnapshotUnchanged = snapshotProof ? snapshotProof.allMatched : null;
  const artifact = {
    schemaVersion: S1_M0_SCHEMA_VERSION,
    artifactKind: 'performance-server-s1-project-q-scan-m0',
    baselineSha: S1_M0_BASELINE_SHA,
    corpusKind: options.profileKind === 'private' ? 'private-copy' : 'synthetic',
    recordedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: os.arch(),
      cpuCount: os.cpus().length,
    },
    semantics: {
      requirement: 'boolean-hit-per-event',
      currentImplementation: 'full-occurrence-count-both-fields',
      projectWideOccurrenceCountRequired: false,
    },
    options: m0ArtifactOptions(options, layerNames, queryClasses),
    snapshotProof,
    corpus: m0CorpusFacts(index),
    fixtureShape,
    layers,
    abort,
    privacy: {
      contentFree: true,
      queryTextPersisted: false,
      externalPrivateCopy: options.profileKind === 'private',
      sourceSnapshotUnchanged,
    },
    acceptance: {
      structural: m0StructuralAcceptance(layers, abort),
      privacyAuditPassed: true,
      numericalLatencyGate: false,
    },
  };
  validateM0Artifact(artifact);
  return artifact;
}

async function profileM0Synthetic(options = {}) {
  const repeats = options.repeats ?? 5;
  const fixtureOptions = options.fixtureOptions || {};
  const normalizedOptions = {
    profileKind: 'synthetic',
    source: 'synthetic',
    repeats,
  };
  const fixtureShape = {
    sessionCount: fixtureOptions.sessionCount ?? 12,
    rowsPerSession: fixtureOptions.rowsPerSession ?? 768,
    sparseEvery: fixtureOptions.sparseEvery ?? 97,
    densePreviewOccurrences: fixtureOptions.densePreviewOccurrences ?? 8,
    denseSearchTextOccurrences: fixtureOptions.denseSearchTextOccurrences ?? 24,
  };
  const index = createM0SyntheticIndex(fixtureShape);
  const layers = {
    main: await profileM0Layer(index, 'main', S1_M0_QUERY_CLASSES, repeats),
  };
  const abort = await profileM0Abort(index, 'main');
  return createM0Artifact({
    options: normalizedOptions,
    index,
    layers,
    queryClasses: S1_M0_QUERY_CLASSES,
    snapshotProof: null,
    fixtureShape,
    abort,
  });
}

async function requireM0ExternalPrivateCopy(options) {
  const { canonicalRoot } = await enumeratePrivateSnapshotFiles(options.sourceHome);
  let canonicalLiveHome;
  try {
    canonicalLiveHome = await fsp.realpath(options.adapter.defaultHome());
  } catch (error) {
    const wrapped = new Error('M0 private-copy live-home validation failed');
    wrapped.code = 'M0_PRIVATE_COPY_INVALID';
    throw wrapped;
  }
  if (canonicalPathInsideOrSame(canonicalRoot, canonicalLiveHome)
      || canonicalPathInsideOrSame(canonicalLiveHome, canonicalRoot)) {
    const error = new Error('M0 private-copy input overlaps the adapter live home');
    error.code = 'M0_PRIVATE_COPY_INVALID';
    throw error;
  }
  return canonicalRoot;
}

function deriveM0PrivateAbsentQuery(referenceProof) {
  const opaque = crypto.createHash('sha256')
    .update('performance-server-s1-m0-private-absent-v1', 'utf8')
    .update(referenceProof, 'utf8')
    .digest('hex');
  return `__session_analyzer_s1_m0_private_absent_${opaque}__`;
}

async function profileM0Private(options) {
  await requireM0ExternalPrivateCopy(options);
  const referenceProof = await computePrivateSnapshotDigest(options.sourceHome);
  const privateAbsentQuery = deriveM0PrivateAbsentQuery(referenceProof);
  const privateQueryTexts = { absent: privateAbsentQuery };
  const index = await options.adapter.buildIndex({
    repoRoot: options.repo,
    sourceKind: options.source,
    sourceHome: options.sourceHome,
  });
  await validateIndexOwnershipForCommit(index);
  const afterBuildProof = await computePrivateSnapshotDigest(options.sourceHome);
  const rowCounts = aggregateRows(index.projectQueryStore);
  if (index.sessions.length === 0 || PROFILE_LAYERS.every((layer) => rowCounts[layer] === 0)) {
    const error = new Error('M0 private-copy corpus has no eligible Project Scope rows');
    error.code = 'M0_PRIVATE_CORPUS_EMPTY';
    throw error;
  }
  const layers = {};
  for (const layer of PROFILE_LAYERS) {
    layers[layer] = await profileM0Layer(
      index,
      layer,
      ['absent'],
      options.repeats,
      privateQueryTexts,
    );
  }
  const abortLayer = PROFILE_LAYERS.find((layer) => rowCounts[layer] > 0);
  const abort = await profileM0Abort(index, abortLayer, privateAbsentQuery);
  const afterProfileProof = await computePrivateSnapshotDigest(options.sourceHome);
  const snapshotProof = snapshotProofVerdict(
    referenceProof,
    [afterBuildProof, afterProfileProof],
    options.snapshotGroup,
  );
  if (!snapshotProof.allMatched) {
    const error = new Error('M0 private-copy snapshot changed during profiling');
    error.code = 'M0_PRIVATE_SNAPSHOT_CHANGED';
    throw error;
  }
  const artifact = createM0Artifact({
    options,
    index,
    layers,
    queryClasses: ['absent'],
    snapshotProof,
    fixtureShape: null,
    abort,
  });
  if (JSON.stringify(artifact).includes(privateAbsentQuery)) {
    const error = new Error('M0 private artifact persisted the opaque absent query');
    error.code = 'M0_PRIVATE_QUERY_LEAK';
    throw error;
  }
  return artifact;
}

async function profileM0(options) {
  if (options.profileKind === 'synthetic') return profileM0Synthetic(options);
  return profileM0Private(options);
}

function aggregateRows(store) {
  const rowCounts = { main: 0, protocol: 0, raw: 0 };
  for (const shards of store.shardsBySessionId.values()) {
    for (const layer of PROFILE_LAYERS) rowCounts[layer] += shards[layer].rowCount;
  }
  return rowCounts;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function accountedIndexBytes(index) {
  const sessionMetadataBytes = index.sessions.reduce((sum, session) => sum + jsonBytes(session), 0);
  const dependencyBytes = index.materializationDependencies instanceof Map
    ? [...index.materializationDependencies.values()]
      .reduce((sum, dependencySet) => sum + jsonBytes(dependencySet), 0)
    : 0;
  const catalogBytes = jsonBytes({
    eventKinds: index.eventKinds,
    codeModeRequests: index.codeModeRequests,
  });
  const legacyRawOwnerBytes = Number(index.legacyRawOwners?.accountedBytes || 0);
  const queryStoreBytes = Number(index.projectQueryStore?.accountedBytes || 0);
  return {
    sessionMetadataBytes,
    dependencyBytes,
    catalogBytes,
    legacyRawOwnerBytes,
    queryStoreBytes,
    totalBytes: sessionMetadataBytes
      + dependencyBytes
      + catalogBytes
      + legacyRawOwnerBytes
      + queryStoreBytes,
  };
}

function publicOptions(options) {
  return {
    source: options.source,
    repo: '<redacted>',
    sourceHome: options.sourceHome ? '<redacted>' : '<adapter-default>',
    repeats: options.repeats,
    snapshotGroup: options.snapshotGroup,
    repetitionIndex: options.repetitionIndex,
    repetitionCount: options.repetitionCount,
  };
}

function invocationTemplate() {
  return {
    worker: 'project-query',
    runtime: 'node-expose-gc',
    inputRole: 'external-private-copy',
    outputRole: 'external-artifact-directory',
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readNpmVersion() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm --version']
    : ['--version'];
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

async function bundledChromiumVersion() {
  const packageRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const registry = JSON.parse(await fsp.readFile(path.join(packageRoot, 'browsers.json'), 'utf8'));
  const chromium = registry.browsers?.find((entry) => entry.name === 'chromium');
  if (!chromium?.browserVersion) throw new Error('Bundled Chromium version metadata is unavailable');
  return chromium.browserVersion;
}

function lengthDelimitedHashRecords(records) {
  const hash = crypto.createHash('sha256');
  for (const value of records) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(data.length));
    hash.update(length);
    hash.update(data);
  }
  return hash.digest('hex');
}

function privateProofError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalPathInsideOrSame(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizedProofPath(relative) {
  return relative.split(path.sep).join('/');
}

async function enumeratePrivateSnapshotFiles(root, dependencies = {}) {
  const fsApi = dependencies.fsp || fsp;
  const resolvedRoot = path.resolve(root);
  try {
    const rootStat = await fsApi.lstat(resolvedRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw privateProofError('PRIVATE_SNAPSHOT_ROOT_INVALID');
    }
    const canonicalRoot = await fsApi.realpath(resolvedRoot);
    const files = [];
    async function visit(absoluteDirectory, relativeDirectory) {
      const names = await fsApi.readdir(absoluteDirectory);
      for (const name of names) {
        const relative = relativeDirectory ? path.join(relativeDirectory, name) : name;
        const absolute = path.join(absoluteDirectory, name);
        const stat = await fsApi.lstat(absolute);
        if (stat.isSymbolicLink()) throw privateProofError('PRIVATE_SNAPSHOT_ENTRY_INVALID');
        const canonical = await fsApi.realpath(absolute);
        if (!canonicalPathInsideOrSame(canonical, canonicalRoot)
            || path.relative(path.resolve(absolute), canonical) !== '') {
          throw privateProofError('PRIVATE_SNAPSHOT_ESCAPE');
        }
        if (stat.isDirectory()) {
          await visit(absolute, relative);
          continue;
        }
        if (!stat.isFile()) throw privateProofError('PRIVATE_SNAPSHOT_ENTRY_INVALID');
        if (Number.isSafeInteger(stat.nlink) && stat.nlink > 1) {
          throw privateProofError('PRIVATE_SNAPSHOT_HARD_LINK');
        }
        files.push({
          absolute: canonical,
          relative: normalizedProofPath(relative),
          byteLength: stat.size,
        });
      }
    }
    await visit(canonicalRoot, '');
    files.sort((left, right) => utf8OrdinalCompare(left.relative, right.relative));
    return { canonicalRoot, files };
  } catch (error) {
    if (PRIVATE_PROOF_ERROR_CODES.has(error?.code)) throw error;
    throw privateProofError('PRIVATE_SNAPSHOT_IO_FAILURE');
  }
}

async function computePrivateSnapshotDigest(root, dependencies = {}) {
  const fsApi = dependencies.fsp || fsp;
  const { files } = await enumeratePrivateSnapshotFiles(root, dependencies);
  const records = [PRIVATE_PROOF_TAG];
  try {
    for (const entry of files) {
      const data = await fsApi.readFile(entry.absolute);
      if (data.length !== entry.byteLength) throw privateProofError('PRIVATE_SNAPSHOT_IO_FAILURE');
      records.push('regular-file', entry.relative, String(data.length), data);
    }
  } catch (error) {
    if (PRIVATE_PROOF_ERROR_CODES.has(error?.code)) throw error;
    throw privateProofError('PRIVATE_SNAPSHOT_IO_FAILURE');
  }
  return lengthDelimitedHashRecords(records);
}

function snapshotProofVerdict(referenceDigest, checkpointDigests, group = 'unassigned') {
  const matches = checkpointDigests.map((digest) => digest === referenceDigest);
  return {
    proofVersion: PRIVATE_PROOF_VERSION,
    algorithm: 'SHA-256',
    group,
    checkpointCount: matches.length,
    allMatched: matches.every(Boolean),
    matches,
  };
}

function validateInvocationTemplate(value) {
  const expected = invocationTemplate();
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error('Private artifact invocationTemplate violates its closed schema');
  }
}

function assertNoPrivateLeak(value, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateLeak(entry, [...keyPath, String(index)]));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_PRIVATE_KEYS.has(key)) {
        throw new Error(`Private artifact contains forbidden field ${[...keyPath, key].join('.')}`);
      }
      if (/session.*(?:id|digest)|(?:id|digest).*session/i.test(key)) {
        throw new Error(`Private artifact contains forbidden Session identity field ${[...keyPath, key].join('.')}`);
      }
      if (/private.*(?:digest|checksum)|(?:digest|checksum).*private/i.test(key)) {
        throw new Error(`Private artifact contains forbidden private proof field ${[...keyPath, key].join('.')}`);
      }
      assertNoPrivateLeak(entry, [...keyPath, key]);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (path.posix.isAbsolute(value)
      || path.win32.isAbsolute(value)
      || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value)
      || /\.jsonl\b/i.test(value)
      || /https?:\/\//i.test(value)) {
    throw new Error(`Private artifact contains forbidden string value at ${keyPath.join('.')}`);
  }
}

function assertClosedKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Private artifact ${label} must be an object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
    throw new Error(`Private artifact ${label} contains an accessor`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Private artifact ${label} violates its closed nested schema`);
  }
}

const MEMORY_SAMPLE_FIELDS = Object.freeze(['heapUsed', 'rss', 'external', 'arrayBuffers']);
const TIMING_STATS_FIELDS = Object.freeze(['repeatCount', 'medianMs', 'minMs', 'maxMs']);
const SELECTION_FIELDS = Object.freeze(['sourceBytes', 'rawRows', 'logicalRows']);
const OWNER_STATS_FIELDS = Object.freeze([
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
]);
const MATERIALIZATION_PHASE_FIELDS = new Set([
  'materialized_pre_adapter_validation', 'adapter_materialization',
  'adapter_source_stream', 'adapter_source_read_wait', 'adapter_source_record_parse',
  'adapter_source_verification_read', 'adapter_source_canonical_construction',
  'adapter_source_finalization', 'materialized_post_adapter_ownership',
  'materialized_canonical_validation', 'materialized_private_validation',
  'materialized_private_fingerprint_capture', 'materialized_private_callback',
  'materialized_private_fingerprint_recheck', 'materialized_fingerprint_reuse',
  'materialized_projection', 'materialized_fingerprint_recheck',
  'materialized_final_admission_check',
]);

function validateMemorySample(value, label) {
  assertClosedKeys(value, MEMORY_SAMPLE_FIELDS, label);
}

function validateTimingStats(value, label) {
  assertClosedKeys(value, TIMING_STATS_FIELDS, label);
}

function validateSelection(value, label) {
  assertClosedKeys(value, SELECTION_FIELDS, label);
}

function validateOwnerStats(value, label) {
  assertClosedKeys(value, OWNER_STATS_FIELDS, label);
}

function validateMaterializedClass(value, label) {
  assertClosedKeys(value, [
    'selection', 'coldMs', 'warm', 'warmRepeatCount', 'adapterCalls', 'exactWarmIdentity',
    'estimatedOwnerBytes', 'processMaxRssBefore', 'processMaxRssAfter',
    'materializationPhaseMs', 'attributedColdMs', 'unattributedColdMs',
    'projectionChunkSamples', 'transientPeak', 'transientPeakOverBefore', 'afterCache',
    'afterCacheDelta', 'afterRetirement', 'afterRetirementDelta',
  ], label);
  validateSelection(value.selection, `${label}.selection`);
  validateTimingStats(value.warm, `${label}.warm`);
  validateMemorySample(value.transientPeak, `${label}.transientPeak`);
  validateMemorySample(value.transientPeakOverBefore, `${label}.transientPeakOverBefore`);
  validateMemorySample(value.afterCache, `${label}.afterCache`);
  validateMemorySample(value.afterCacheDelta, `${label}.afterCacheDelta`);
  validateMemorySample(value.afterRetirement, `${label}.afterRetirement`);
  validateMemorySample(value.afterRetirementDelta, `${label}.afterRetirementDelta`);
  if (!value.materializationPhaseMs || typeof value.materializationPhaseMs !== 'object'
      || Object.keys(value.materializationPhaseMs).some((field) => !MATERIALIZATION_PHASE_FIELDS.has(field))) {
    throw new Error(`Private artifact ${label}.materializationPhaseMs violates its closed nested schema`);
  }
}

function validatePrivateNestedSchema(artifact) {
  assertClosedKeys(artifact.identity, [
    'repository', 'targetBranch', 'currentBranch', 'inspectedBaseSha', 'preWave0Head', 'head',
    'candidateCommitSha', 'targetSyncSha', 'targetToCandidateDiffAlgorithm',
    'targetToCandidateDiffSha256', 'dirty', 'profiledTrackedDiffSha256AtRun',
    'profiledImplementationTreeHash',
    'repetitionIndex', 'repetitionCount',
    'recordedAt',
  ], 'identity');
  assertClosedKeys(artifact.environment, [
    'node', 'v8', 'npm', 'playwright', 'chromium', 'execArgv', 'exposedGc', 'heapLimitBytes',
    'platform', 'osRelease', 'architecture', 'cpu', 'cpuCount', 'totalMemoryBytes', 'ci',
    'headless', 'viewport', 'locale', 'timezone',
  ], 'environment');
  assertClosedKeys(artifact.options, [
    'source', 'repo', 'sourceHome', 'repeats', 'snapshotGroup', 'repetitionIndex',
    'repetitionCount',
  ], 'options');
  assertClosedKeys(artifact.snapshotProof, [
    'proofVersion', 'algorithm', 'group', 'checkpointCount', 'allMatched', 'matches',
  ], 'snapshotProof');
  assertClosedKeys(artifact.corpus, [
    'sourceKind', 'sessionCount', 'rowCounts', 'sourceBytes', 'dependencyCount',
  ], 'corpus');
  assertClosedKeys(artifact.corpus.rowCounts, PROFILE_LAYERS, 'corpus.rowCounts');
  assertClosedKeys(artifact.logicalAccountedBytes, [
    'sessionMetadataBytes', 'dependencyBytes', 'catalogBytes', 'legacyRawOwnerBytes',
    'queryStoreBytes', 'totalBytes',
  ], 'logicalAccountedBytes');
  assertClosedKeys(artifact.runtimeMemory, [
    'beforeBuild', 'committedAfterGc', 'committedDelta', 'processMaxRssBytes',
    'heapLimitBytes', 'exposedGc',
  ], 'runtimeMemory');
  validateMemorySample(artifact.runtimeMemory.beforeBuild, 'runtimeMemory.beforeBuild');
  validateMemorySample(artifact.runtimeMemory.committedAfterGc, 'runtimeMemory.committedAfterGc');
  validateMemorySample(artifact.runtimeMemory.committedDelta, 'runtimeMemory.committedDelta');
  assertClosedKeys(artifact.build, [
    'invocationCount', 'elapsedMs', 'before', 'observedTransientPeak',
    'observedTransientPeakOverBefore', 'processMaxRssBytesAtBuildEnd', 'sampling',
  ], 'build');
  validateMemorySample(artifact.build.before, 'build.before');
  validateMemorySample(artifact.build.observedTransientPeak, 'build.observedTransientPeak');
  validateMemorySample(artifact.build.observedTransientPeakOverBefore, 'build.observedTransientPeakOverBefore');
  assertClosedKeys(artifact.build.sampling, [
    'progressBoundarySamples', 'preRawCompactionSamples', 'postFinalizeSamples',
  ], 'build.sampling');
  assertClosedKeys(artifact.validation, [
    'invocationCount', 'elapsedMs', 'before', 'observedTransientPeak',
    'observedTransientPeakOverBefore', 'processMaxRssBytesAfterValidation', 'chunkSamples',
  ], 'validation');
  validateMemorySample(artifact.validation.before, 'validation.before');
  validateMemorySample(artifact.validation.observedTransientPeak, 'validation.observedTransientPeak');
  validateMemorySample(artifact.validation.observedTransientPeakOverBefore, 'validation.observedTransientPeakOverBefore');
  assertClosedKeys(artifact.commit, [
    'arithmeticBuildPlusValidationMs', 'observedTransientPeak',
    'observedTransientPeakOverBefore', 'processMaxRssBytes', 'committedAfterGc', 'committedDelta',
  ], 'commit');
  for (const field of [
    'observedTransientPeak', 'observedTransientPeakOverBefore', 'committedAfterGc', 'committedDelta',
  ]) validateMemorySample(artifact.commit[field], `commit.${field}`);
  assertClosedKeys(artifact.materialization, [
    'candidateCount', 'ordinals', 'small', 'medium', 'large', 'largest', 'coldQueueing',
    'quickSessionSwitch', 'largestCancellation',
  ], 'materialization');
  assertClosedKeys(artifact.materialization.ordinals, ['small', 'medium', 'large', 'largest'], 'materialization.ordinals');
  for (const name of ['small', 'medium', 'large', 'largest']) {
    validateMaterializedClass(artifact.materialization[name], `materialization.${name}`);
  }
  if (artifact.materialization.coldQueueing !== null) {
    assertClosedKeys(artifact.materialization.coldQueueing, [
      'first', 'second', 'firstWaitToStartMs', 'firstMaterializationMs', 'secondQueueWaitMs',
      'secondMaterializationMs', 'secondTotalMs', 'queueDepthAtSecondAdmission',
      'activeCountAtSecondAdmission', 'adapterCalls', 'finalStats',
    ], 'materialization.coldQueueing');
    validateSelection(artifact.materialization.coldQueueing.first, 'materialization.coldQueueing.first');
    validateSelection(artifact.materialization.coldQueueing.second, 'materialization.coldQueueing.second');
    validateOwnerStats(artifact.materialization.coldQueueing.finalStats, 'materialization.coldQueueing.finalStats');
  }
  if (artifact.materialization.quickSessionSwitch !== null) {
    assertClosedKeys(artifact.materialization.quickSessionSwitch, [
      'first', 'second', 'sourceStreamToSwitchMs', 'switchToAbortObservationMs',
      'switchToWaiterRejectionMs', 'secondQueueWaitMs', 'switchToSecondCompletionMs',
      'queueDepthAtSecondAdmission', 'activeCountAtSecondAdmission', 'adapterCalls', 'finalStats',
    ], 'materialization.quickSessionSwitch');
    validateSelection(artifact.materialization.quickSessionSwitch.first, 'materialization.quickSessionSwitch.first');
    validateSelection(artifact.materialization.quickSessionSwitch.second, 'materialization.quickSessionSwitch.second');
    validateOwnerStats(artifact.materialization.quickSessionSwitch.finalStats, 'materialization.quickSessionSwitch.finalStats');
  }
  assertClosedKeys(artifact.materialization.largestCancellation, [
    'selection', 'queuedToAbortMs', 'queuedToWaiterRejectionMs', 'queuedToJobSettlementMs',
    'cacheSessionCount', 'completedCount',
  ], 'materialization.largestCancellation');
  validateSelection(artifact.materialization.largestCancellation.selection, 'materialization.largestCancellation.selection');
  assertClosedKeys(artifact.scans, PROFILE_LAYERS, 'scans');
  for (const layer of PROFILE_LAYERS) {
    const scan = artifact.scans[layer];
    assertClosedKeys(scan, [
      'oracle', 'packed', 'chunks', 'transientDecodePeak', 'transientDecodePeakOverCommitted',
    ], `scans.${layer}`);
    if (scan.oracle !== null) validateTimingStats(scan.oracle, `scans.${layer}.oracle`);
    validateTimingStats(scan.packed, `scans.${layer}.packed`);
    validateMemorySample(scan.transientDecodePeak, `scans.${layer}.transientDecodePeak`);
    validateMemorySample(scan.transientDecodePeakOverCommitted, `scans.${layer}.transientDecodePeakOverCommitted`);
  }
  assertClosedKeys(artifact.acceptance, [
    'structural', 'privacyAuditPassed', 'snapshotProofVerifiedByRunner', 'numericalLatencyGate',
  ], 'acceptance');
}

function validatePrivateArtifact(artifact) {
  const fields = Object.keys(artifact).sort();
  const expected = [...SERVER_ARTIFACT_FIELDS].sort();
  if (JSON.stringify(fields) !== JSON.stringify(expected)) {
    throw new Error('Private artifact top-level schema is not closed');
  }
  if (artifact.schemaVersion !== PROFILE_SCHEMA_VERSION
      || artifact.artifactKind !== 'project-query-server-run'
      || artifact.snapshotProof?.proofVersion !== PRIVATE_PROOF_VERSION) {
    throw new Error('Private artifact schema identity is invalid');
  }
  validateInvocationTemplate(artifact.invocationTemplate);
  validatePrivateNestedSchema(artifact);
  if (artifact.identity.dirty !== false
      || !/^[0-9a-f]{40}$/.test(artifact.identity.candidateCommitSha)
      || !/^[0-9a-f]{40}$/.test(artifact.identity.targetSyncSha)
      || artifact.identity.targetToCandidateDiffAlgorithm
        !== 'git-diff-binary-no-ext-diff-full-index-v1'
      || !/^[0-9a-f]{64}$/.test(artifact.identity.targetToCandidateDiffSha256)
      || !/^[0-9a-f]{64}$/.test(artifact.identity.profiledTrackedDiffSha256AtRun)
      || !/^[0-9a-f]{64}$/.test(artifact.identity.profiledImplementationTreeHash)) {
    throw new Error('Private artifact capture identity is invalid');
  }
  assertNoPrivateLeak(artifact);
  return true;
}

function validateM0Timing(value, label, repeatCount) {
  validateTimingStats(value, label);
  if (!Number.isSafeInteger(value.repeatCount) || value.repeatCount !== repeatCount) {
    throw new Error(`M0 artifact ${label}.repeatCount is invalid`);
  }
  for (const field of ['medianMs', 'minMs', 'maxMs']) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw new Error(`M0 artifact ${label}.${field} is invalid`);
    }
  }
}

function validateM0Artifact(artifact) {
  assertClosedKeys(artifact, [
    'schemaVersion', 'artifactKind', 'baselineSha', 'corpusKind', 'recordedAt', 'runtime',
    'semantics', 'options', 'snapshotProof', 'corpus', 'fixtureShape', 'layers', 'abort',
    'privacy', 'acceptance',
  ], 'M0 top level');
  if (artifact.schemaVersion !== S1_M0_SCHEMA_VERSION
      || artifact.artifactKind !== 'performance-server-s1-project-q-scan-m0'
      || artifact.baselineSha !== S1_M0_BASELINE_SHA
      || !['synthetic', 'private-copy'].includes(artifact.corpusKind)
      || Number.isNaN(Date.parse(artifact.recordedAt))) {
    throw new Error('M0 artifact identity is invalid');
  }
  assertClosedKeys(artifact.runtime, [
    'node', 'platform', 'architecture', 'cpuCount',
  ], 'M0 runtime');
  assertClosedKeys(artifact.semantics, [
    'requirement', 'currentImplementation', 'projectWideOccurrenceCountRequired',
  ], 'M0 semantics');
  if (artifact.semantics.requirement !== 'boolean-hit-per-event'
      || artifact.semantics.currentImplementation !== 'full-occurrence-count-both-fields'
      || artifact.semantics.projectWideOccurrenceCountRequired !== false) {
    throw new Error('M0 artifact semantic identity is invalid');
  }
  assertClosedKeys(artifact.options, [
    'source', 'repo', 'sourceHome', 'repeats', 'layers', 'queryClasses',
  ], 'M0 options');
  if (!Number.isSafeInteger(artifact.options.repeats)
      || artifact.options.repeats < 1
      || artifact.options.repeats > 20
      || !Array.isArray(artifact.options.layers)
      || !Array.isArray(artifact.options.queryClasses)
      || artifact.options.layers.some((layer) => !PROFILE_LAYERS.includes(layer))
      || artifact.options.queryClasses.some((queryClass) => !S1_M0_QUERY_CLASSES.includes(queryClass))) {
    throw new Error('M0 artifact options are invalid');
  }
  if (artifact.corpusKind === 'private-copy') {
    assertClosedKeys(artifact.snapshotProof, [
      'proofVersion', 'algorithm', 'group', 'checkpointCount', 'allMatched', 'matches',
    ], 'M0 snapshotProof');
    if (artifact.snapshotProof.proofVersion !== PRIVATE_PROOF_VERSION
        || artifact.snapshotProof.algorithm !== 'SHA-256'
        || artifact.snapshotProof.checkpointCount !== 2
        || artifact.snapshotProof.allMatched !== true
        || JSON.stringify(artifact.snapshotProof.matches) !== JSON.stringify([true, true])) {
      throw new Error('M0 artifact private snapshot proof is invalid');
    }
  } else if (artifact.snapshotProof !== null) {
    throw new Error('M0 synthetic artifact must not contain private snapshot proof');
  }
  assertClosedKeys(artifact.corpus, [
    'sourceKind', 'sessionCount', 'rowCounts', 'sourceBytes', 'dependencyCount',
    'queryStoreAccountedBytes',
  ], 'M0 corpus');
  assertClosedKeys(artifact.corpus.rowCounts, PROFILE_LAYERS, 'M0 corpus.rowCounts');
  for (const [field, value] of Object.entries({
    sessionCount: artifact.corpus.sessionCount,
    sourceBytes: artifact.corpus.sourceBytes,
    dependencyCount: artifact.corpus.dependencyCount,
    queryStoreAccountedBytes: artifact.corpus.queryStoreAccountedBytes,
    ...artifact.corpus.rowCounts,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`M0 artifact corpus ${field} is invalid`);
    }
  }
  if (artifact.fixtureShape !== null) {
    assertClosedKeys(artifact.fixtureShape, [
      'sessionCount', 'rowsPerSession', 'sparseEvery', 'densePreviewOccurrences',
      'denseSearchTextOccurrences',
    ], 'M0 fixtureShape');
    if (Object.values(artifact.fixtureShape).some((value) => (
      !Number.isSafeInteger(value) || value < 1
    ))) {
      throw new Error('M0 artifact fixtureShape is invalid');
    }
  } else if (artifact.corpusKind !== 'private-copy') {
    throw new Error('M0 synthetic artifact requires fixtureShape');
  }
  assertClosedKeys(artifact.layers, artifact.options.layers, 'M0 layers');
  for (const layer of artifact.options.layers) {
    assertClosedKeys(artifact.layers[layer], ['queryClasses'], `M0 layers.${layer}`);
    assertClosedKeys(
      artifact.layers[layer].queryClasses,
      artifact.options.queryClasses,
      `M0 layers.${layer}.queryClasses`,
    );
    for (const queryClass of artifact.options.queryClasses) {
      const result = artifact.layers[layer].queryClasses[queryClass];
      const label = `M0 layers.${layer}.queryClasses.${queryClass}`;
      assertClosedKeys(result, [
        'metrics', 'candidateAssessment', 'phaseTimings', 'parity',
      ], label);
      assertClosedKeys(result.metrics, S1_M0_METRIC_FIELDS, `${label}.metrics`);
      for (const [field, value] of Object.entries(result.metrics)) {
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error(`M0 artifact ${label}.metrics.${field} is invalid`);
        }
      }
      if ((queryClass === 'absent' && result.metrics.rowsHit !== 0)
          || result.metrics.rowsScanned !== result.metrics.structurallyEligibleRows
          || result.metrics.textChunksDecoded !== (
            result.metrics.identityTextChunks + result.metrics.gzipTextChunks
          )
          || result.metrics.booleanHitChecks !== result.metrics.structurallyEligibleRows
          || result.metrics.previewSearchInvocations !== result.metrics.booleanHitChecks
          || result.metrics.searchTextSearchInvocations !== result.metrics.booleanHitChecks
          || result.metrics.fullOccurrenceIterations !== (
            result.metrics.previewMatchOccurrences + result.metrics.searchTextMatchOccurrences
          )
          || result.metrics.rowsHit !== result.metrics.matchingEvents
          || result.metrics.snippetHydrations !== result.metrics.matchingSessions
          || result.metrics.resultDtoConstructions !== result.metrics.matchingSessions) {
        throw new Error(`M0 artifact ${label}.metrics cross-field accounting is invalid`);
      }
      assertClosedKeys(
        result.candidateAssessment,
        S1_M0_CANDIDATE_FIELDS,
        `${label}.candidateAssessment`,
      );
      for (const field of S1_M0_CANDIDATE_FIELDS) {
        const value = result.candidateAssessment[field];
        if (field.startsWith('exact')) {
          if (typeof value !== 'boolean') {
            throw new Error(`M0 artifact ${label}.candidateAssessment.${field} is invalid`);
          }
        } else if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error(`M0 artifact ${label}.candidateAssessment.${field} is invalid`);
        }
      }
      if (result.candidateAssessment.booleanHitChecks !== result.metrics.booleanHitChecks
          || result.candidateAssessment.previewSearchInvocations
            !== result.candidateAssessment.booleanHitChecks
          || result.candidateAssessment.searchTextSearchInvocations
            + result.candidateAssessment.searchTextInvocationsAvoided
            !== result.metrics.searchTextSearchInvocations
          || result.candidateAssessment.fullOccurrenceIterationsAvoided
            > result.metrics.fullOccurrenceIterations
          || result.candidateAssessment.rowHitMismatches !== 0
          || result.candidateAssessment.exactRowHitParity !== true
          || result.candidateAssessment.exactProjectResultParity !== true) {
        throw new Error(`M0 artifact ${label}.candidateAssessment accounting is invalid`);
      }
      assertClosedKeys(result.phaseTimings, S1_M0_PHASE_FIELDS, `${label}.phaseTimings`);
      for (const field of S1_M0_PHASE_FIELDS) {
        const value = result.phaseTimings[field];
        if (value === null) {
          if (!['gzipDecodeOnly', 'latestResultPresentationHydration'].includes(field)) {
            throw new Error(`M0 artifact ${label}.phaseTimings.${field} cannot be null`);
          }
          continue;
        }
        validateM0Timing(value, `${label}.phaseTimings.${field}`, artifact.options.repeats);
      }
      assertClosedKeys(
        result.parity,
        ['profilerModelMatchesProduction', 'shortCircuitMatchesCurrent'],
        `${label}.parity`,
      );
      if (result.parity.profilerModelMatchesProduction !== true
          || result.parity.shortCircuitMatchesCurrent !== true) {
        throw new Error(`M0 artifact ${label} parity failed`);
      }
    }
  }
  assertClosedKeys(artifact.abort, [
    'layer', 'abortRequested', 'abortObserved', 'rowsProcessedBeforeAbort',
    'textChunksProcessedBeforeAbort', 'textChunksDecodedBeforeAbort',
    'abortToSettlementMs',
  ], 'M0 abort');
  if (!PROFILE_LAYERS.includes(artifact.abort.layer)
      || artifact.abort.abortRequested !== true
      || artifact.abort.abortObserved !== true
      || !Number.isSafeInteger(artifact.abort.rowsProcessedBeforeAbort)
      || artifact.abort.rowsProcessedBeforeAbort < 0
      || !Number.isSafeInteger(artifact.abort.textChunksProcessedBeforeAbort)
      || artifact.abort.textChunksProcessedBeforeAbort < 0
      || !Number.isSafeInteger(artifact.abort.textChunksDecodedBeforeAbort)
      || artifact.abort.textChunksDecodedBeforeAbort < 0
      || !Number.isFinite(artifact.abort.abortToSettlementMs)
      || artifact.abort.abortToSettlementMs < 0) {
    throw new Error('M0 artifact abort result is invalid');
  }
  assertClosedKeys(artifact.privacy, [
    'contentFree', 'queryTextPersisted', 'externalPrivateCopy', 'sourceSnapshotUnchanged',
  ], 'M0 privacy');
  const privateArtifact = artifact.corpusKind === 'private-copy';
  if (artifact.privacy.contentFree !== true
      || artifact.privacy.queryTextPersisted !== false
      || artifact.privacy.externalPrivateCopy !== privateArtifact
      || artifact.privacy.sourceSnapshotUnchanged !== (privateArtifact ? true : null)) {
    throw new Error('M0 artifact privacy result is invalid');
  }
  assertClosedKeys(artifact.acceptance, [
    'structural', 'privacyAuditPassed', 'numericalLatencyGate',
  ], 'M0 acceptance');
  if (artifact.acceptance.structural !== true
      || artifact.acceptance.privacyAuditPassed !== true
      || artifact.acceptance.numericalLatencyGate !== false) {
    throw new Error('M0 artifact acceptance failed');
  }
  const serialized = JSON.stringify(artifact);
  if (Object.values(S1_M0_QUERY_TEXT).some((queryText) => serialized.includes(queryText))) {
    throw new Error('M0 artifact persisted query text');
  }
  assertNoPrivateLeak(artifact);
  return true;
}

function validatePrivateSummary(summary) {
  assertClosedKeys(summary, [
    'schemaVersion', 'artifactKind', 'profileKind', 'mode', 'expectedRepeatCount',
    'validAttemptCount', 'invalidAttemptCount', 'processIsolation', 'identityEquality',
    'proofEquality', 'hardExact', 'causal', 'exactCounterSet', 'observational',
    'categoricalObservations', 'outliersRetained', 'acceptance', 'snapshotEquality',
  ], 'summary');
  if (summary.schemaVersion !== PROFILE_SCHEMA_VERSION
      || summary.artifactKind !== 'performance-wave-0-summary'
      || summary.profileKind !== 'private-corpus') {
    throw new Error('Private summary schema identity is invalid');
  }
  assertClosedKeys(summary.snapshotEquality, [
    'proofVersion', 'algorithm', 'group', 'checkpointCount', 'allMatched', 'copyMethod',
  ], 'summary.snapshotEquality');
  if (summary.snapshotEquality.proofVersion !== PRIVATE_PROOF_VERSION
      || summary.snapshotEquality.algorithm !== 'SHA-256'
      || summary.snapshotEquality.copyMethod !== 'independent-byte-copy'
      || typeof summary.snapshotEquality.group !== 'string'
      || !summary.snapshotEquality.group
      || !Number.isSafeInteger(summary.snapshotEquality.checkpointCount)
      || summary.snapshotEquality.checkpointCount < 1
      || typeof summary.snapshotEquality.allMatched !== 'boolean') {
    throw new Error('Private summary snapshot equality metadata is invalid');
  }
  assertNoPrivateLeak(summary);
  return true;
}

async function collectIdentity(options) {
  const repoRoot = path.join(__dirname, '..');
  const gitIdentity = await captureGitIdentity(repoRoot, {
    candidateCommitSha: options.candidateSha,
    targetSyncSha: options.targetSyncSha,
  });
  return {
    repository: 'Yijia-Zhou/session-analyzer',
    targetBranch: 'towards-0.2.0',
    inspectedBaseSha: INSPECTED_BASE_SHA,
    preWave0Head: PRE_WAVE_0_HEAD,
    ...gitIdentity,
    repetitionIndex: options.repetitionIndex,
    repetitionCount: options.repetitionCount,
    recordedAt: new Date().toISOString(),
  };
}

const MATERIALIZATION_TOP_LEVEL_PHASES = Object.freeze([
  'materialized_pre_adapter_validation',
  'adapter_materialization',
  'materialized_post_adapter_ownership',
  'materialized_canonical_validation',
  'materialized_private_validation',
  'materialized_fingerprint_reuse',
  'materialized_projection',
  'materialized_fingerprint_recheck',
  'materialized_final_admission_check',
]);

function phaseTimingRecorder(recordSample) {
  const active = new Map();
  const durations = new Map();
  return {
    observe({ phase, state, durationMs }) {
      recordSample();
      if (state === 'duration' && Number.isFinite(durationMs) && durationMs >= 0) {
        durations.set(phase, (durations.get(phase) || 0) + durationMs);
      }
      if (state === 'start') active.set(phase, performance.now());
      if (state === 'end' && active.has(phase)) {
        durations.set(phase, (durations.get(phase) || 0) + performance.now() - active.get(phase));
        active.delete(phase);
      }
    },
    result() {
      return Object.fromEntries(durations);
    },
  };
}

async function profileMaterializedSession(index, session, indexRevision) {
  if (global.gc) global.gc();
  const before = memorySample();
  let transientPeak = before;
  let projectionChunkSamples = 0;
  const recordSample = () => {
    transientPeak = memoryMaximum(transientPeak, memorySample());
  };
  const phaseTimings = phaseTimingRecorder(recordSample);
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  let adapterCalls = 0;
  const processMaxRssBefore = process.resourceUsage().maxRSS * 1024;
  const sampler = setInterval(recordSample, 10);
  sampler.unref();
  const coldStarted = performance.now();
  let cold;
  try {
    cold = await owner.get(session, null, ({ signal }) => {
      adapterCalls += 1;
      return materializeSessionForIndex(index, session, {
        signal,
        onProjectionChunk() {
          projectionChunkSamples += 1;
          recordSample();
        },
        onMaterializationPhase: phaseTimings.observe,
      });
    });
  } finally {
    clearInterval(sampler);
  }
  const coldMs = performance.now() - coldStarted;
  recordSample();
  if (global.gc) global.gc();
  const afterCache = memorySample();
  const warmTimings = [];
  let warm = null;
  let exactWarmIdentity = true;
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const warmStarted = performance.now();
    warm = await owner.get(session, null, async () => {
      adapterCalls += 1;
      return null;
    });
    warmTimings.push(performance.now() - warmStarted);
    exactWarmIdentity = exactWarmIdentity && warm === cold;
  }
  if (!exactWarmIdentity) throw new Error(`Materialization profile lost warm identity for ${session.id}`);
  const ownerStats = owner.stats();
  const retirement = new Error('Materialization profile retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
  cold = null;
  warm = null;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  if (global.gc) global.gc();
  const afterRetirement = memorySample();
  const materializationPhaseMs = phaseTimings.result();
  const attributedColdMs = MATERIALIZATION_TOP_LEVEL_PHASES.reduce(
    (total, phase) => total + Number(materializationPhaseMs[phase] || 0),
    0,
  );
  return {
    selection: redactedSessionSelection(session),
    coldMs,
    warm: timingStats(warmTimings),
    warmRepeatCount: warmTimings.length,
    adapterCalls,
    exactWarmIdentity,
    estimatedOwnerBytes: ownerStats.peakEstimatedMaterializedBytes,
    processMaxRssBefore,
    processMaxRssAfter: process.resourceUsage().maxRSS * 1024,
    materializationPhaseMs,
    attributedColdMs,
    unattributedColdMs: Math.max(0, coldMs - attributedColdMs),
    projectionChunkSamples,
    transientPeak,
    transientPeakOverBefore: memoryDelta(transientPeak, before),
    afterCache,
    afterCacheDelta: memoryDelta(afterCache, before),
    afterRetirement,
    afterRetirementDelta: memoryDelta(afterRetirement, before),
  };
}

async function profileLargeMaterializationCancellation(index, session, indexRevision) {
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  const waiterController = new AbortController();
  let cancellationQueuedAt = 0;
  let abortObservedAt = 0;
  const pending = owner.get(session, waiterController.signal, ({ signal }) => (
    materializeSessionForIndex(index, session, {
      signal,
      onProjectionChunk({ phase }) {
        if (phase !== 'materialized_projection' || cancellationQueuedAt !== 0) return;
        cancellationQueuedAt = performance.now();
        setImmediate(() => {
          abortObservedAt = performance.now();
          waiterController.abort();
        });
      },
    })
  ));
  let rejection;
  try {
    await pending;
  } catch (error) {
    rejection = error;
  }
  const waiterRejectedAt = performance.now();
  while (scheduler.active.size > 0) await new Promise((resolve) => setImmediate(resolve));
  const jobSettledAt = performance.now();
  if (rejection?.name !== 'AbortError' || cancellationQueuedAt === 0 || abortObservedAt === 0) {
    throw new Error(`Large materialization cancellation profile did not observe AbortError for ${session.id}`);
  }
  const result = {
    selection: redactedSessionSelection(session),
    queuedToAbortMs: abortObservedAt - cancellationQueuedAt,
    queuedToWaiterRejectionMs: waiterRejectedAt - cancellationQueuedAt,
    queuedToJobSettlementMs: jobSettledAt - cancellationQueuedAt,
    cacheSessionCount: owner.cache.size,
    completedCount: owner.stats().completed,
  };
  const retirement = new Error('Materialization cancellation profile retirement');
  owner.retire(retirement);
  retirementController.abort(retirement);
  return result;
}

function selectMaterializationCandidates(sessions) {
  const candidates = [...sessions]
    .filter((session) => session.bytes > 0)
    .sort((left, right) => left.bytes - right.bytes || left.id.localeCompare(right.id));
  if (candidates.length === 0) return null;
  const ordinalAt = (fraction) => Math.min(
    candidates.length,
    Math.max(1, Math.ceil(candidates.length * fraction)),
  );
  const select = (ordinal) => ({ ordinal, session: candidates[ordinal - 1] });
  return {
    candidateCount: candidates.length,
    small: select(ordinalAt(0.1)),
    medium: select(ordinalAt(0.5)),
    large: select(ordinalAt(0.9)),
    largest: select(candidates.length),
  };
}

async function profileColdQueueing(index, first, second, indexRevision) {
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  let resolveFirstStarted;
  const firstStarted = new Promise((resolve) => { resolveFirstStarted = resolve; });
  let firstStartedAt = 0;
  let firstCompletedAt = 0;
  let secondStartedAt = 0;
  let secondCompletedAt = 0;
  let adapterCalls = 0;
  try {
    const firstRequestedAt = performance.now();
    const firstPending = owner.get(first, null, ({ signal }) => {
      adapterCalls += 1;
      firstStartedAt = performance.now();
      resolveFirstStarted();
      return materializeSessionForIndex(index, first, { signal });
    }).then((value) => {
      firstCompletedAt = performance.now();
      return value;
    });
    await firstStarted;
    const secondRequestedAt = performance.now();
    const secondPending = owner.get(second, null, ({ signal }) => {
      adapterCalls += 1;
      secondStartedAt = performance.now();
      return materializeSessionForIndex(index, second, { signal });
    }).then((value) => {
      secondCompletedAt = performance.now();
      return value;
    });
    const admissionStats = owner.stats();
    await Promise.all([firstPending, secondPending]);
    while (scheduler.active.size > 0) await new Promise((resolve) => setImmediate(resolve));
    return {
      first: redactedSessionSelection(first),
      second: redactedSessionSelection(second),
      firstWaitToStartMs: firstStartedAt - firstRequestedAt,
      firstMaterializationMs: firstCompletedAt - firstStartedAt,
      secondQueueWaitMs: secondStartedAt - secondRequestedAt,
      secondMaterializationMs: secondCompletedAt - secondStartedAt,
      secondTotalMs: secondCompletedAt - secondRequestedAt,
      queueDepthAtSecondAdmission: admissionStats.queuedJobCount,
      activeCountAtSecondAdmission: admissionStats.activeJobCount,
      adapterCalls,
      finalStats: owner.stats(),
    };
  } finally {
    const retirement = new Error('Materialization queue profile retirement');
    owner.retire(retirement);
    retirementController.abort(retirement);
  }
}

async function profileQuickSessionSwitch(index, first, second, indexRevision) {
  const retirementController = new AbortController();
  const scheduler = createMaterializationScheduler({ warn() {} });
  const owner = createMaterializedSessionOwner({
    index,
    indexRevision,
    retirementController,
    scheduler,
  });
  const firstWaiterController = new AbortController();
  let resolveSourceStreamStarted;
  const sourceStreamStarted = new Promise((resolve) => { resolveSourceStreamStarted = resolve; });
  let firstSourceStreamStartedAt = 0;
  let firstAbortObservedAt = 0;
  let firstWaiterRejectedAt = 0;
  let secondStartedAt = 0;
  let secondCompletedAt = 0;
  let adapterCalls = 0;
  try {
    const firstPending = owner.get(first, firstWaiterController.signal, ({ signal }) => {
      adapterCalls += 1;
      signal.addEventListener('abort', () => { firstAbortObservedAt = performance.now(); }, { once: true });
      return materializeSessionForIndex(index, first, {
        signal,
        onMaterializationPhase({ phase, state }) {
          if (phase !== 'adapter_source_stream' || state !== 'start' || firstSourceStreamStartedAt) return;
          firstSourceStreamStartedAt = performance.now();
          resolveSourceStreamStarted();
        },
      });
    });
    const firstOutcome = firstPending.then(
      () => ({ error: null }),
      (error) => {
        firstWaiterRejectedAt = performance.now();
        return { error };
      },
    );
    await sourceStreamStarted;
    const switchStartedAt = performance.now();
    firstWaiterController.abort();
    const secondRequestedAt = performance.now();
    const secondPending = owner.get(second, null, ({ signal }) => {
      adapterCalls += 1;
      secondStartedAt = performance.now();
      return materializeSessionForIndex(index, second, { signal });
    }).then((value) => {
      secondCompletedAt = performance.now();
      return value;
    });
    const admissionStats = owner.stats();
    const [outcome] = await Promise.all([firstOutcome, secondPending]);
    while (scheduler.active.size > 0) await new Promise((resolve) => setImmediate(resolve));
    if (outcome.error?.name !== 'AbortError' || firstAbortObservedAt === 0) {
      throw new Error(`Quick switch did not cancel the first materialization for ${first.id}`);
    }
    return {
      first: redactedSessionSelection(first),
      second: redactedSessionSelection(second),
      sourceStreamToSwitchMs: switchStartedAt - firstSourceStreamStartedAt,
      switchToAbortObservationMs: firstAbortObservedAt - switchStartedAt,
      switchToWaiterRejectionMs: firstWaiterRejectedAt - switchStartedAt,
      secondQueueWaitMs: secondStartedAt - secondRequestedAt,
      switchToSecondCompletionMs: secondCompletedAt - switchStartedAt,
      queueDepthAtSecondAdmission: admissionStats.queuedJobCount,
      activeCountAtSecondAdmission: admissionStats.activeJobCount,
      adapterCalls,
      finalStats: owner.stats(),
    };
  } finally {
    const retirement = new Error('Quick Session-switch profile retirement');
    owner.retire(retirement);
    retirementController.abort(retirement);
  }
}

async function profileMaterialization(index, adapter) {
  if (adapter.sessionLifecycle !== SESSION_LIFECYCLE.INDEXED_MATERIALIZED) return null;
  const selected = selectMaterializationCandidates(index.sessions);
  if (!selected) return null;
  const canProfileTransition = selected.large.session.id !== selected.medium.session.id;
  return {
    candidateCount: selected.candidateCount,
    ordinals: Object.fromEntries(
      ['small', 'medium', 'large', 'largest'].map((name) => [name, selected[name].ordinal]),
    ),
    small: await profileMaterializedSession(index, selected.small.session, 1),
    medium: await profileMaterializedSession(index, selected.medium.session, 2),
    large: await profileMaterializedSession(index, selected.large.session, 3),
    largest: await profileMaterializedSession(index, selected.largest.session, 4),
    coldQueueing: canProfileTransition
      ? await profileColdQueueing(index, selected.large.session, selected.medium.session, 5)
      : null,
    quickSessionSwitch: canProfileTransition
      ? await profileQuickSessionSwitch(index, selected.large.session, selected.medium.session, 6)
      : null,
    largestCancellation: await profileLargeMaterializationCancellation(
      index,
      selected.largest.session,
      7,
    ),
  };
}

function materializationContractsPass(materialization) {
  if (!materialization) return false;
  const sizeClassesPass = ['small', 'medium', 'large', 'largest'].every((name) => (
    materialization[name]?.adapterCalls === 1
    && materialization[name]?.exactWarmIdentity === true
    && materialization[name]?.warmRepeatCount === 3
    && materialization[name]?.warm?.repeatCount === 3
  ));
  const queueingPass = materialization.coldQueueing === null || (
    materialization.coldQueueing.adapterCalls === 2
    && materialization.coldQueueing.queueDepthAtSecondAdmission === 1
    && materialization.coldQueueing.activeCountAtSecondAdmission === 1
  );
  const switchPass = materialization.quickSessionSwitch === null || (
    materialization.quickSessionSwitch.adapterCalls === 2
    && materialization.quickSessionSwitch.queueDepthAtSecondAdmission === 1
    && materialization.quickSessionSwitch.activeCountAtSecondAdmission === 1
  );
  return sizeClassesPass
    && queueingPass
    && switchPass
    && materialization.largestCancellation?.cacheSessionCount === 0
    && materialization.largestCancellation?.completedCount === 0;
}

async function profile(options) {
  let buildInvocationCount = 0;
  let validationInvocationCount = 0;
  const beforeBuild = memorySample();
  let buildPeak = beforeBuild;
  const buildSampling = {
    progressBoundarySamples: 0,
    preRawCompactionSamples: 0,
    postFinalizeSamples: 0,
  };
  const recordBuildSample = (kind = '') => {
    buildPeak = memoryMaximum(buildPeak, memorySample());
    if (Object.hasOwn(buildSampling, kind)) buildSampling[kind] += 1;
  };
  const buildStarted = performance.now();
  buildInvocationCount += 1;
  const index = await options.adapter.buildIndex({
    repoRoot: options.repo,
    sourceKind: options.source,
    sourceHome: options.sourceHome || options.adapter.defaultHome(),
    onProgress() {
      recordBuildSample('progressBoundarySamples');
    },
    onTransientMemorySample(sample) {
      if (sample?.phase === 'pre_raw_compaction') recordBuildSample('preRawCompactionSamples');
      else if (sample?.phase === 'post_finalize') recordBuildSample('postFinalizeSamples');
      else recordBuildSample();
    },
  });
  recordBuildSample();
  const buildMs = performance.now() - buildStarted;
  const processMaxRssBytesAtBuildEnd = process.resourceUsage().maxRSS * 1024;
  const beforeValidation = memorySample();
  let validationPeak = beforeValidation;
  let validationChunkSamples = 0;
  const validationStarted = performance.now();
  validationInvocationCount += 1;
  await validateIndexOwnershipForCommit(index, {
    onChunk() {
      validationChunkSamples += 1;
      validationPeak = memoryMaximum(validationPeak, memorySample());
    },
  });
  validationPeak = memoryMaximum(validationPeak, memorySample());
  const validationMs = performance.now() - validationStarted;
  const processMaxRssBytesAfterValidation = process.resourceUsage().maxRSS * 1024;
  if (global.gc) global.gc();
  const afterCommit = memorySample();
  const query = queryForIndex(index);
  const hasResidentOracle = options.adapter.sessionLifecycle === SESSION_LIFECYCLE.RESIDENT_COMPLETE;
  const oracleIndex = hasResidentOracle ? { ...index, projectQueryStore: undefined } : null;
  const scans = {};

  for (const layer of PROFILE_LAYERS) {
    const oracleTimings = [];
    const packedTimings = [];
    let decodedPeak = memorySample();
    let chunks = 0;
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      const filters = { q: PROFILE_QUERY, layer, locale: 'en' };
      let expected = null;
      if (oracleIndex) {
        const oracleStarted = performance.now();
        expected = await query.filterSessions(oracleIndex, filters);
        oracleTimings.push(performance.now() - oracleStarted);
      }
      const packedStarted = performance.now();
      const actual = await query.filterSessions(index, filters, {
        onChunk() {
          chunks += 1;
          decodedPeak = memoryMaximum(decodedPeak, memorySample());
        },
      });
      packedTimings.push(performance.now() - packedStarted);
      if (oracleIndex && JSON.stringify(actual) !== JSON.stringify(expected)) {
        const error = new Error(`Packed ${layer} query result diverged from the complete-event oracle`);
        error.code = 'PROJECT_QUERY_PROFILE_PARITY_FAILURE';
        throw error;
      }
    }
    scans[layer] = {
      oracle: oracleTimings.length > 0 ? timingStats(oracleTimings) : null,
      packed: timingStats(packedTimings),
      chunks,
      transientDecodePeak: decodedPeak,
      transientDecodePeakOverCommitted: memoryDelta(decodedPeak, afterCommit),
    };
  }
  const materialization = await profileMaterialization(index, options.adapter);
  const identity = await collectIdentity(options);
  const logicalAccountedBytes = accountedIndexBytes(index);
  const artifact = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    artifactKind: 'project-query-server-run',
    identity,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      npm: readNpmVersion(),
      playwright: require('playwright/package.json').version,
      chromium: await bundledChromiumVersion(),
      execArgv: process.execArgv.filter((value) => (
        value === '--expose-gc' || /^--max-old-space-size=\d+$/.test(value)
      )),
      exposedGc: typeof global.gc === 'function',
      heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
      platform: process.platform,
      osRelease: os.release(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model || '',
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      ci: Boolean(process.env.CI),
      headless: null,
      viewport: null,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    options: publicOptions(options),
    invocationTemplate: invocationTemplate(),
    snapshotProof: {
      proofVersion: PRIVATE_PROOF_VERSION,
      algorithm: 'SHA-256',
      group: options.snapshotGroup,
      checkpointCount: 0,
      allMatched: false,
      matches: [],
    },
    corpus: {
      sourceKind: index.sourceKind,
      sessionCount: index.sessions.length,
      rowCounts: aggregateRows(index.projectQueryStore),
      sourceBytes: index.sessions.reduce((sum, session) => sum + Number(session.bytes || 0), 0),
      dependencyCount: index.materializationDependencies instanceof Map
        ? index.materializationDependencies.size
        : 0,
    },
    logicalAccountedBytes,
    runtimeMemory: {
      beforeBuild,
      committedAfterGc: afterCommit,
      committedDelta: memoryDelta(afterCommit, beforeBuild),
      processMaxRssBytes: processMaxRssBytesAfterValidation,
      heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
      exposedGc: typeof global.gc === 'function',
    },
    build: {
      invocationCount: buildInvocationCount,
      elapsedMs: buildMs,
      before: beforeBuild,
      observedTransientPeak: buildPeak,
      observedTransientPeakOverBefore: memoryDelta(buildPeak, beforeBuild),
      processMaxRssBytesAtBuildEnd,
      sampling: buildSampling,
    },
    validation: {
      invocationCount: validationInvocationCount,
      elapsedMs: validationMs,
      before: beforeValidation,
      observedTransientPeak: validationPeak,
      observedTransientPeakOverBefore: memoryDelta(validationPeak, beforeValidation),
      processMaxRssBytesAfterValidation,
      chunkSamples: validationChunkSamples,
    },
    commit: {
      arithmeticBuildPlusValidationMs: buildMs + validationMs,
      observedTransientPeak: memoryMaximum(buildPeak, validationPeak),
      observedTransientPeakOverBefore: memoryDelta(
        memoryMaximum(buildPeak, validationPeak),
        beforeBuild,
      ),
      processMaxRssBytes: processMaxRssBytesAfterValidation,
      committedAfterGc: afterCommit,
      committedDelta: memoryDelta(afterCommit, beforeBuild),
    },
    materialization,
    scans,
    acceptance: {
      structural: buildInvocationCount === 1
        && validationInvocationCount === 1
        && materializationContractsPass(materialization),
      privacyAuditPassed: true,
      snapshotProofVerifiedByRunner: false,
      numericalLatencyGate: false,
    },
  };
  validatePrivateArtifact(artifact);
  return artifact;
}

async function main(argv = process.argv.slice(2)) {
  const m0Mode = argv.includes('--m0-q-scan');
  const options = m0Mode ? parseM0Args(argv) : parseArgs(argv);
  const result = m0Mode ? await profileM0(options) : await profile(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function privateCliErrorLine(error) {
  const code = error?.code === 'INVALID_PROFILE_ARGUMENT'
    ? 'INVALID_PROFILE_ARGUMENT'
    : 'PRIVATE_PROFILE_FAILURE';
  return `PERFORMANCE_WAVE_0_ERROR:${code}\n`;
}

function m0CliErrorLine(error) {
  const code = error?.code === 'INVALID_PROFILE_ARGUMENT'
    ? 'INVALID_PROFILE_ARGUMENT'
    : 'M0_PROFILE_FAILURE';
  return `PERFORMANCE_SERVER_S1_M0_ERROR:${code}\n`;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  main(argv).catch((error) => {
    process.stderr.write(argv.includes('--m0-q-scan')
      ? m0CliErrorLine(error)
      : privateCliErrorLine(error));
    process.exitCode = 1;
  });
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  PRIVATE_PROOF_VERSION,
  S1_M0_BASELINE_SHA,
  S1_M0_SCHEMA_VERSION,
  assertNoPrivateLeak,
  computePrivateSnapshotDigest,
  createM0SyntheticIndex,
  enumeratePrivateSnapshotFiles,
  invocationTemplate,
  m0CliErrorLine,
  parseArgs,
  parseM0Args,
  profile,
  profileM0,
  profileM0Synthetic,
  privateCliErrorLine,
  publicOptions,
  selectMaterializationCandidates,
  snapshotProofVerdict,
  timingStats,
  validateM0Artifact,
  validatePrivateArtifact,
  validatePrivateSummary,
};
