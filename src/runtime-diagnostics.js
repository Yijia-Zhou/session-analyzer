'use strict';

const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');

const DEFAULT_MAX_LOG_FILES = 20;
const DEFAULT_PROGRESS_INTERVAL_MS = 1000;
const LOG_PREFIX = 'index-';
const LOG_SUFFIX = '.jsonl';

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

function mergePeak(peak, current) {
  for (const [key, value] of Object.entries(current)) {
    peak[key] = Math.max(peak[key] || 0, value || 0);
  }
  return peak;
}

function diagnosticLogFiles(logDir) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(LOG_PREFIX) && entry.name.endsWith(LOG_SUFFIX))
    .map((entry) => {
      const filePath = path.join(logDir, entry.name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath));
}

function pruneDiagnosticLogs(logDir, maxLogFiles = DEFAULT_MAX_LOG_FILES) {
  for (const entry of diagnosticLogFiles(logDir).slice(Math.max(0, maxLogFiles))) {
    fs.rmSync(entry.filePath, { force: true });
  }
}

function progressFields(progress = {}) {
  const fields = {};
  for (const key of [
    'phase',
    'filesTotal',
    'filesScanned',
    'candidateFileCount',
    'skippedFileCount',
    'unknownFileCount',
    'indexedFileCount',
    'reusedFileCount',
    'candidateBytes',
    'indexedBytes',
    'sessionCount',
    'rawEventCount',
    'logicalEventCount',
    'elapsedMs',
  ]) {
    if (progress[key] !== undefined) fields[key] = progress[key];
  }
  return fields;
}

function createIndexDiagnostics(options = {}) {
  if (!options.logDir) return null;

  const logDir = path.resolve(options.logDir);
  const now = options.now || (() => new Date());
  const clock = options.clock || Date.now;
  const readMemory = options.readMemory || memorySnapshot;
  const maxLogFiles = options.maxLogFiles || DEFAULT_MAX_LOG_FILES;
  const progressIntervalMs = options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  fs.mkdirSync(logDir, { recursive: true });
  pruneDiagnosticLogs(logDir, Math.max(0, maxLogFiles - 1));

  const startedAtMs = clock();
  const safeTimestamp = now().toISOString().replace(/[:.]/g, '-');
  const jobId = String(options.jobId || 'startup').replace(/[^A-Za-z0-9_-]/g, '_');
  const filePath = path.join(logDir, `${LOG_PREFIX}${safeTimestamp}-${process.pid}-${jobId}${LOG_SUFFIX}`);
  const peak = {};
  let lastProgressAt = -Infinity;
  let lastPhase = '';
  let finished = false;
  let disabled = false;
  let warned = false;

  const append = (payload, required = false) => {
    if (disabled) return;
    try {
      fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    } catch (error) {
      if (required) throw error;
      disabled = true;
      if (!warned) {
        warned = true;
        console.warn('Index diagnostics disabled after a write failure.');
      }
    }
  };

  const write = (event, details = {}, required = false) => {
    const memory = readMemory();
    mergePeak(peak, memory);
    append({
      timestamp: now().toISOString(),
      event,
      sourceKind: options.sourceKind || '',
      ...details,
      memory,
    }, required);
  };

  write('indexing_started', {
    heapSizeLimit: v8.getHeapStatistics().heap_size_limit,
  }, true);

  return {
    filePath,
    progress(progress) {
      if (finished) return;
      const elapsedMs = clock() - startedAtMs;
      const phase = progress?.phase || '';
      if (phase === lastPhase && elapsedMs - lastProgressAt < progressIntervalMs) return;
      lastPhase = phase;
      lastProgressAt = elapsedMs;
      write('indexing_progress', progressFields(progress));
    },
    finish(status, details = {}) {
      if (finished) return;
      finished = true;
      const memory = readMemory();
      mergePeak(peak, memory);
      append({
        timestamp: now().toISOString(),
        event: 'indexing_finished',
        sourceKind: options.sourceKind || '',
        status,
        elapsedMs: clock() - startedAtMs,
        ...details,
        memory,
        peakMemory: peak,
      });
      if (!disabled) {
        try {
          pruneDiagnosticLogs(logDir, maxLogFiles);
        } catch {
          console.warn('Index diagnostic log retention could not be applied.');
        }
      }
    },
  };
}

module.exports = {
  createIndexDiagnostics,
  diagnosticLogFiles,
  memorySnapshot,
  pruneDiagnosticLogs,
  progressFields,
};
