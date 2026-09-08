'use strict';

// Keep source scans useful even when some artifacts are unreadable, without
// retaining an unbounded list of filenames or any transcript payload.
function createSourceDiagnostics() {
  const summary = { totalCount: 0, counts: {}, samples: [], truncatedCount: 0 };
  return {
    summary,
    add({ code, path = '', message = '' }) {
      const key = String(code || 'SOURCE_ARTIFACT_UNREADABLE').slice(0, 100);
      summary.totalCount += 1;
      Object.defineProperty(summary.counts, key, {
        value: (Object.hasOwn(summary.counts, key) ? summary.counts[key] : 0) + 1,
        enumerable: true, configurable: true, writable: true,
      });
      if (summary.samples.length < 20) {
        summary.samples.push({ code: key, path: String(path).slice(0, 2048), message: String(message).slice(0, 1024) });
      } else summary.truncatedCount += 1;
    },
  };
}

module.exports = { createSourceDiagnostics };
