'use strict';

function capacitySession(id, count = 1, searchText = 'synthetic needle', layers = ['main', 'protocol', 'raw']) {
  const logicalEvents = [];
  const rawEvents = [];
  for (const layer of layers) {
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const event = {
        id: `${id}:${layer}:${ordinal}`, rawId: `${id}:${layer}:${ordinal}`,
        sourceKind: 'claude-code', layer, kind: 'message', subtype: 'assistant_message',
        timestamp: '2026-10-02T00:00:00.000Z', rawRefs: [],
        recordType: 'assistant', payloadType: 'message', role: 'assistant',
        label: 'Synthetic capacity message', preview: 'Synthetic preview', searchText,
        status: '', toolName: '', touchedFiles: ['src/capacity.js'], source: { file: `${id}.jsonl`, line: ordinal + 1 },
      };
      (layer === 'raw' ? rawEvents : logicalEvents).push(event);
    }
  }
  return { id, sourceKind: 'claude-code', title: id, sourceFile: `${id}.jsonl`,
    startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    counts: { messages: count, toolCalls: 0, failedCommands: 0 },
    logicalEvents, rawEvents, analysis: { patchedFiles: [], protocolStats: [], toolUsage: [], failedCommands: [] } };
}

function capacityIndex(query, sessions, store) {
  const indexed = sessions.map(session => ({ ...session, ...query.projectSessionMetadata(session) }));
  return { sourceKind: 'claude-code', repoRoot: '/synthetic/repo', sessions: indexed,
    sessionsById: new Map(indexed.map(session => [session.id, session])), projectQueryStore: store };
}

module.exports = { capacitySession, capacityIndex };
