'use strict';

const { addRecordedUsage } = require('./pi-recorded-state');
const { abort } = require('./pi-storage');

// A physical line identifies an entry within this accepted artifact snapshot.
// Request blocks are counted at their recorded array positions, never by call ID.
// No leaf-bound event, result pairing or retained ledger participates in totals.
function* iteratePiPhysicalContributors(document, signal) {
  for (const row of document.entries) {
    abort(signal);
    const entry = row.parsed;
    const admitted = !document.invalidTree && typeof entry?.id === 'string'
      && document.byId.get(entry.id) === row;
    yield { line: row.line, entry, malformed: Boolean(row.parseError), admitted };
  }
}

function nativeStatistics(document, sourceFile, options = {}) {
  abort(options.signal);
  if (document.invalidTree) return null;
  const counts = { rawRecords: document.rows.length, entryRecords: 0, malformedRecords: 0, unlinkedRecords: 0,
    userMessages: 0, assistantMessages: 0, systemMessages: 0, toolResultMessages: 0, otherMessages: 0,
    assistantToolRequests: 0, directShellExecutions: 0 };
  const usageByCategory = {};
  for (const contributor of iteratePiPhysicalContributors(document, options.signal)) {
    counts.entryRecords++;
    if (contributor.malformed) counts.malformedRecords++;
    if (!contributor.admitted) { counts.unlinkedRecords++; continue; }
    const entry = contributor.entry;
    addRecordedUsage(usageByCategory, entry);
    if (entry.type !== 'message') continue;
    const role = entry.message?.role;
    if (role === 'user') counts.userMessages++;
    else if (role === 'assistant') {
      counts.assistantMessages++;
      if (Array.isArray(entry.message.content)) for (const block of entry.message.content) {
        abort(options.signal);
        if (block?.type === 'toolCall') counts.assistantToolRequests++;
      }
    } else if (role === 'system') counts.systemMessages++;
    else if (role === 'toolResult') counts.toolResultMessages++;
    else if (role === 'bashExecution') counts.directShellExecutions++;
    else counts.otherMessages++;
  }
  return { schemaVersion: 1, scope: 'native_session', basis: 'accepted_physical_records',
    sourceSessionId: document.header.id, sourceFile, counts, usageByCategory };
}

module.exports = { iteratePiPhysicalContributors, nativeStatistics };
