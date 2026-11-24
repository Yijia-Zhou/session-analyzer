'use strict';

// Keep source scans useful even when some artifacts are unreadable, without
// retaining an unbounded list of filenames or any transcript payload.
function createSourceDiagnostics() {
  const summary = { totalCount: 0, counts: {}, samples: [], truncatedCount: 0 };
  function addCount(key, count) {
    Object.defineProperty(summary.counts, key, {
      value: (Object.hasOwn(summary.counts, key) ? summary.counts[key] : 0) + count,
      enumerable: true, configurable: true, writable: true,
    });
  }
  return {
    summary,
    add({ code, path = '', message = '' }) {
      const key = String(code || 'SOURCE_ARTIFACT_UNREADABLE').slice(0, 100);
      summary.totalCount += 1;
      addCount(key, 1);
      if (summary.samples.length < 20) {
        summary.samples.push({ code: key, path: String(path).slice(0, 2048), message: String(message).slice(0, 1024) });
      } else summary.truncatedCount += 1;
    },
    merge(other) {
      if (!other) return;
      summary.totalCount += other.totalCount;
      for (const [key, count] of Object.entries(other.counts)) addCount(key, count);
      summary.samples.push(...other.samples.slice(0, 20 - summary.samples.length));
      summary.truncatedCount = summary.totalCount - summary.samples.length;
    },
  };
}

module.exports = { createSourceDiagnostics };
