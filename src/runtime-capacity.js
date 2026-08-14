'use strict';

const LARGE_TRANSCRIPT_HISTORY_WARNING_CODE = 'SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY';

// Empirical warning threshold, not a supported maximum or an OOM boundary.
const LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES = 800 * 1024 * 1024;

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function largeTranscriptHistoryWarning(progress, options = {}) {
  const thresholdBytes = options.thresholdBytes ?? LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES;
  const candidateBytes = Number(progress?.candidateBytes) || 0;
  if (progress?.phase !== 'parsing' || candidateBytes < thresholdBytes) return null;

  const candidateFileCount = Number(progress?.candidateFileCount) || 0;
  const fileSummary = candidateFileCount === 1
    ? '1 candidate transcript file'
    : `${candidateFileCount} candidate transcript files`;
  return {
    warningCode: LARGE_TRANSCRIPT_HISTORY_WARNING_CODE,
    thresholdBytes,
    candidateBytes,
    candidateFileCount,
    message: [
      `[${LARGE_TRANSCRIPT_HISTORY_WARNING_CODE}] Large matching transcript history detected (${formatMiB(candidateBytes)} across ${fileSummary}); this is transcript-history size, not source-repository size.`,
      'This is a capacity warning, not an indexing error: indexing will continue normally, and no heap change is needed if it succeeds.',
      'Current Codex measurements around 850–900 MB used about 1.9 GB peak V8 heap, but this is empirical guidance rather than an OOM boundary.',
      'Only if indexing fails with "JavaScript heap out of memory", retry once with a moderately larger temporary heap (for example NODE_OPTIONS=--max-old-space-size=4096); use --log-dir <path> to collect aggregate diagnostics.',
    ].join(' '),
  };
}

function createLargeTranscriptHistoryWarning(options = {}) {
  const warn = options.warn || console.warn;
  let emitted = false;
  return {
    observe(progress) {
      if (emitted) return null;
      const warning = largeTranscriptHistoryWarning(progress, options);
      if (!warning) return null;
      emitted = true;
      try {
        warn(warning.message);
      } catch {
        // Capacity guidance must never block or fail indexing.
      }
      try {
        options.onWarning?.(warning);
      } catch {
        // Optional diagnostic recording is best-effort for the same reason.
      }
      return warning;
    },
  };
}

module.exports = {
  LARGE_TRANSCRIPT_HISTORY_WARNING_BYTES,
  LARGE_TRANSCRIPT_HISTORY_WARNING_CODE,
  createLargeTranscriptHistoryWarning,
  largeTranscriptHistoryWarning,
};
