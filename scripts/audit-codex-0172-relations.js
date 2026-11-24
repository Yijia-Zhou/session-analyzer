'use strict';

// Worker for the isolated writer probe. Do not pass a real transcript root.
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { zstdDecompressSync } = require('node:zlib');
const codex = require('../src/codex');
const { disposeIndexResources } = require('../src/index-resources');
const { materializeSessionForIndex } = require('../src/source-adapters');

async function main() {
  const [, , codexHome, repoRoot, encoded] = process.argv;
  const threads = JSON.parse(encoded);
  const diagnostics = {};
  const options = { codexHome, repoRoot, onDiagnostic: ({ code }) => {
    diagnostics[code] = (diagnostics[code] || 0) + 1;
  } };
  const uncompacted = await codex.__testOnly.buildUncompactedIndexForDetailTests(options);
  const compactResident = await codex.buildIndex(options);
  const sourceCold = await codex.buildSourceBackedIndex(options);
  const reindexed = await codex.buildSourceBackedIndex({ ...options, previousIndex: sourceCold });
  const paths = { uncompacted, compactResident, sourceCold, reindexed };
  const reusedSessions = reindexed.sessions === sourceCold.sessions;
  const rows = [];
  const directory = path.join(codexHome, 'sessions');
  for (const file of await fsp.readdir(directory, { recursive: true })) {
    if (!/\.jsonl(?:\.zst)?$/.test(file)) continue;
    const bytes = await fsp.readFile(path.join(directory, file));
    const records = (file.endsWith('.zst') ? zstdDecompressSync(bytes) : bytes).toString('utf8').trim().split('\n').map(JSON.parse);
    const meta = records[0].payload;
    for (const [mode, cases] of Object.entries(threads)) {
      for (const [kind, id] of Object.entries(cases)) {
        if (id !== meta.id) continue;
        const row = { mode, kind, attached: meta.attached_thread === true,
          sourceClass: meta.thread_source === 'tui_side_chat' ? 'tui_side_chat' : 'other',
          forkMatches: meta.forked_from_id === cases.source, hasBase: Boolean(meta.history_base),
          records: records.length, baseKeys: Object.keys(meta.history_base || {}),
          ordinal: records[0].ordinal, paths: {} };
        for (const [name, index] of Object.entries(paths)) {
          const indexed = index.sessionsById.get(id);
          if (!indexed) {
            row.paths[name] = { admitted: false };
            continue;
          }
          const session = indexed.logicalEvents ? indexed : await materializeSessionForIndex(index, indexed);
          const boundary = codex.query.getTimeline(index, session, { layer: 'main', q: 'Side conversation boundary.' });
          const audio = {};
          if (kind === 'audio') {
            for (const layer of ['main', 'protocol', 'raw']) audio[layer] = codex.query.getTimeline(
              index, session, { layer, q: 'external fixture caption' }).searchEventCount;
          }
          row.paths[name] = { admitted: true, main: session.logicalEvents.filter(e => e.layer === 'main').length,
            ...(kind === 'audio' ? { captionHits: audio } : {}),
            mainBoundaryHits: boundary.searchEventCount, users: indexed.counts?.userMessages,
            fork: indexed.forkedFromSessionId === cases.source, parent: indexed.parentSessionId === cases.source,
            relation: indexed.derivedRelationship || null,
            revertedHits: codex.query.getTimeline(index, session, {
              layer: 'main', q: 'fixture reverted turn',
            }).searchEventCount };
        }
        rows.push(row);
      }
    }
  }
  await Promise.all(Object.values(paths).map(index => disposeIndexResources(index)));
  assert.equal(rows.length, 9);
  assert.equal(rows.filter(row => row.mode === 'paginated' && row.kind === 'ordinary').length, 2);
  const side = rows.find(row => row.kind === 'side');
  for (const result of Object.values(side.paths)) {
    assert.equal(result.mainBoundaryHits, 1);
    assert.equal(result.users, 2);
  }
  for (const row of rows) for (const result of Object.values(row.paths)) {
    assert.equal(result.admitted, true);
    assert.equal(result.revertedHits, 0);
    if (row.kind === 'audio') assert.deepEqual(result.captionHits, { main: 1, protocol: 0, raw: 2 });
    assert.deepEqual(result, row.paths.uncompacted);
  }
  console.log(JSON.stringify({ legacyAttached: threads.legacy.attachedError, diagnostics,
    indexDiagnostics: sourceCold.sourceDiagnostics?.counts, reusedSessions,
    checkedPaths: Object.keys(paths), rows: rows.map(({ paths: observations, ...physical }) =>
      ({ ...physical, result: observations.uncompacted })) }));
}

main().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
