'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { zstdCompressSync } = require('node:zlib');
const codex = require('../src/codex');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { createHistoryService } = require('../src/history-service');
const { parseRolloutArtifactIdentity, parseHistoryBase, resolveRolloutHistoryPlans, validateHistorySegmentBoundary } = require('../src/codex-rollout-history');

// Synthetic structural fixtures for rust-v0.162.1 history positions and filenames.
const ROOT = 'aaaaaaaa-0162-4162-9162-aaaaaaaaaaaa';
const ONE = 'bbbbbbbb-0162-4162-9162-bbbbbbbbbbbb';
const TWO = 'cccccccc-0162-4162-9162-cccccccccccc';
const OTHER = 'dddddddd-0162-4162-9162-dddddddddddd';
const file = (rollout = ROOT, thread = ROOT, date = '2026-10-14T10-00-00') => `2026/10/14/rollout-${date}-${thread}${rollout === thread ? '' : `_${rollout}`}.jsonl`;
const base = (thread_id, end_ordinal_exclusive, end_byte_offset) => ({ thread_id, end_ordinal_exclusive, end_byte_offset });
const node = (rollout, historyBase = null, extra = {}) => ({ sessionId: ROOT, sourceFile: file(rollout), bytes: 1000, historyBase, ...extra });
const codes = (result) => new Set(result.diagnostics.map((entry) => entry.code));

test('physical rollout identities distinguish stable thread and optional rollout ID', () => {
  assert.equal(parseRolloutArtifactIdentity(file()).rolloutId, ROOT);
  assert.deepEqual(parseRolloutArtifactIdentity(file(ONE) + '.zst'), { threadId: ROOT, rolloutId: ONE, timestamp: '2026-10-14T10:00:00Z' });
  assert.equal(parseRolloutArtifactIdentity(file(ONE).toUpperCase()).rolloutId, ONE);
  for (const invalid of ['rollout-random.jsonl', file(ONE) + '.tmp', file(ONE).replace(ONE, 'invalid'), file(ONE, ROOT, '2026-02-30T10-00-00')]) assert.equal(parseRolloutArtifactIdentity(invalid), null);
});

test('HistoryPosition requires nonnegative safe exclusive ordinal and byte offset', () => {
  assert.equal(parseHistoryBase(null).base, null);
  assert.deepEqual(parseHistoryBase(base(ONE, 123, 456)).base, { rolloutId: ONE, endOrdinalExclusive: 123, endByteOffset: 456 });
  for (const invalid of [[], {}, base('invalid', 1, 1), base(ONE, -1, 1), base(ONE, 1, 1.5), base(ONE, Number.MAX_SAFE_INTEGER + 1, 1)]) assert.equal(parseHistoryBase(invalid).error, 'CODEX_HISTORY_BASE_INVALID');
});

test('single-file plans preserve ad hoc filenames; multiple reverts compose explicit prefixes', () => {
  const single = resolveRolloutHistoryPlans([{ sourceFile: 'legacy.jsonl', sessionId: 'legacy', bytes: 100 }]);
  assert.equal(single.plans.length, 1);
  assert.equal(single.plans[0].segments[0].acceptedBytes, 100);
  assert.deepEqual(single.diagnostics, []);
  const chain = resolveRolloutHistoryPlans([node(TWO, base(ONE, 9, 300)), node(ROOT), node(ONE, base(ROOT, 6, 500))]);
  assert.deepEqual(chain.diagnostics, []);
  assert.equal(chain.plans.length, 1);
  assert.equal(chain.plans[0].sessionId, ROOT);
  assert.equal(chain.plans[0].headRolloutId, TWO);
  assert.deepEqual(chain.plans[0].segments.map((segment) => [segment.rolloutId, segment.startOrdinal, segment.endOrdinalExclusive, segment.acceptedBytes]), [[ROOT, 0, 6, 500], [ONE, 6, 9, 300], [TWO, 9, null, 1000]]);
});

test('branching, disconnected, cyclic, missing, malformed and contradictory chains never claim complete plans', () => {
  const scenarios = [
    [[node(ROOT), node(ONE, base(ROOT, 3, 100)), node(TWO, base(ROOT, 3, 100))], 'CODEX_HISTORY_HEAD_AMBIGUOUS'],
    [[node(ROOT), node(ONE)], 'CODEX_HISTORY_HEAD_AMBIGUOUS'],
    [[node(ROOT, base(ONE, 3, 100)), node(ONE, base(ROOT, 4, 100))], 'CODEX_HISTORY_CYCLE'],
    [[node(ONE, base(ROOT, 3, 100))], 'CODEX_HISTORY_BASE_MISSING'],
    [[node(ROOT), node(ONE, base(ROOT, 3, 1001))], 'CODEX_HISTORY_BOUNDARY_INVALID'],
    [[node(ROOT), node(ONE, base(ROOT, 6, 100)), node(TWO, base(ONE, 5, 100))], 'CODEX_HISTORY_BOUNDARY_INVALID'],
    [[node(ROOT), node(ONE, {})], 'CODEX_HISTORY_BASE_INVALID'],
    [[node(ROOT, null, { sourceFile: file(ROOT, OTHER) })], 'CODEX_HISTORY_OWNER_CONFLICT'],
    [[node(ROOT), node(ROOT, null, { sourceFile: file(ROOT, ROOT, '2026-10-14T11-00-00') })], 'CODEX_HISTORY_ARTIFACT_ID_AMBIGUOUS'],
    [[node(ROOT, null, { sourceFile: '../escape.jsonl' })], 'CODEX_HISTORY_ARTIFACT_INVALID'],
  ];
  for (const [nodes, expected] of scenarios) {
    const result = resolveRolloutHistoryPlans(nodes);
    assert.equal(result.plans.length, 0, expected);
    assert.ok(codes(result).has(expected), expected);
  }
});

test('explicit cross-thread physical bases do not remove the parent logical head', () => {
  const result = resolveRolloutHistoryPlans([node(ROOT), { sessionId: OTHER, sourceFile: file(OTHER, OTHER), bytes: 200, historyBase: base(ROOT, 3, 100) }]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.plans.length, 2);
  const child = result.plans.find((plan) => plan.sessionId === OTHER);
  assert.deepEqual(child.segments.map((segment) => segment.sessionId), [ROOT, OTHER]);
  assert.equal(result.plans.find((plan) => plan.sessionId === ROOT).headRolloutId, ROOT);
});

test('segment reader boundaries couple physical bytes and global recorded-row ordinals', () => {
  const segment = { startOrdinal: 6, endOrdinalExclusive: 9, acceptedBytes: 300 };
  assert.equal(validateHistorySegmentBoundary(segment, 3, 300), 9);
  assert.equal(validateHistorySegmentBoundary({ startOrdinal: 9, endOrdinalExclusive: null, acceptedBytes: 500 }, 5, 500), 14);
  for (const [rows, bytes] of [[2, 300], [3, 299], [3.5, 300]]) assert.throws(() => validateHistorySegmentBoundary(segment, rows, bytes), { code: 'CODEX_HISTORY_BOUNDARY_INVALID' });
});

test('validated current-path hints select a branch or pre-cutover ancestor independently of mtime', () => {
  const artifacts = [node(ROOT), node(ONE, base(ROOT, 3, 100)), node(TWO, base(ROOT, 3, 100))];
  for (const selected of [ROOT, ONE, TWO]) {
    const result = resolveRolloutHistoryPlans(artifacts, { currentPaths: new Map([[ROOT, file(selected)]]) });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.plans[0].headRolloutId, selected);
    assert.equal(result.plans[0].headSelection, 'state-pointer');
    assert.ok(result.plans[0].unselectedSourceFiles.length > 0);
  }
  assert.ok(codes(resolveRolloutHistoryPlans(artifacts, { currentPaths: new Map([[ROOT, 'missing.jsonl']]) })).has('CODEX_HISTORY_CURRENT_PATH_UNRESOLVED'));
  assert.equal(resolveRolloutHistoryPlans([node(ROOT)]).plans[0].headSelection, 'filesystem-inferred');
});

async function historyFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-chain-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const codexHome = path.join(root, 'codex');
  const sessionsRoot = path.join(codexHome, 'sessions');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(sessionsRoot, '2026/10/14'), { recursive: true });
  const message = (text, timestamp) => ({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const header = (history_base, timestamp) => ({ timestamp, type: 'session_meta', payload: { id: ROOT, cwd: repoRoot, cli_version: '0.162.1', history_mode: 'paginated', ...(history_base ? { history_base } : {}) } });
  const firstRows = [header(null, '2026-10-14T10:00:00Z'), message('kept-ancestor', '2026-10-14T10:00:01Z'), message('superseded-root-tail', '2026-10-14T10:00:02Z')];
  firstRows.forEach((row, ordinal) => { row.ordinal = ordinal; });
  const prefix = firstRows.slice(0, 2).map(JSON.stringify).join('\n') + '\n';
  const secondRows = [header(base(ROOT, 2, Buffer.byteLength(prefix)), '2026-10-14T11:00:00Z'), message('current-head-message', '2026-10-14T11:00:01Z')];
  secondRows.forEach((row, position) => { row.ordinal = 2 + position; });
  await fs.writeFile(path.join(sessionsRoot, file(ROOT)), firstRows.map(JSON.stringify).join('\n') + '\n');
  await fs.writeFile(path.join(sessionsRoot, file(ONE)), secondRows.map(JSON.stringify).join('\n') + '\n');
  return { repoRoot, codexHome, sessionsRoot, firstRows, secondRows, options: { repoRoot, codexHome, currentRolloutPathsForTests: new Map([[ROOT, path.join(sessionsRoot, file(ONE))]]) } };
}

test('history observation samples full physical ancestors including compressed and admitted archived dependencies', async (t) => {
  for (const archived of [false, true]) for (const compressed of [false, true]) {
    await t.test(`${archived ? 'archived' : 'live'} ${compressed ? 'Zstd' : 'plain'}`, async (t) => {
      const f = await historyFixture(t);
      let ancestor = path.join(f.sessionsRoot, file(ROOT));
      if (archived) {
        const target = path.join(f.codexHome, 'archived_sessions', file(ROOT));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(ancestor, target);
        ancestor = target;
      }
      if (compressed) {
        await fs.writeFile(ancestor + '.zst', zstdCompressSync(await fs.readFile(ancestor)));
        await fs.unlink(ancestor);
        ancestor += '.zst';
      }
      const service = await createHistoryService({ repo: f.repoRoot, source: 'codex', codexHome: f.codexHome });
      t.after(() => service.close());
      const hit = (await service.execute('search', { query: 'kept-ancestor' })).items[0];
      assert.ok(hit);
      assert.match((await service.execute('read', { refs: [hit.ref], parts: ['projection'] })).items[0].parts[0].text, /kept-ancestor/u);
      const before = await service.execute('observe', { callerSessionId: hit.sessionId });
      assert.equal(before.observation.counts.metadata_unchanged, 2);
      assert.equal(before.observation.baseline.dependencies.sampledFiles, archived ? 1 : 0);
      await fs.appendFile(ancestor, 'suffix');
      const after = await service.execute('observe', { callerSessionId: hit.sessionId });
      assert.equal(after.observation.caller.counts.size_increased, 1);
      assert.equal(after.items[0].physicalPath, ancestor);
      assert.equal(after.items[0].baseline.basis, archived ? 'post_index_dependency_observation' : 'pre_index_inventory');
      assert.equal(after.items[0].projectMembership, 'indexed_dependency');
    });
  }
});

test('resident history combines only explicit ancestor prefixes, preserving physical Raw', async (t) => {
  const f = await historyFixture(t);
  const index = await codex.__testOnly.buildUncompactedIndexForDetailTests(f.options);
  assert.equal(index.sessions.length, 1);
  const session = index.sessions[0];
  assert.equal(session.id, ROOT);
  assert.equal(session.sourceFile.replace(/\\/gu, '/'), file(ONE));
  assert.equal(session.rawEvents.length, 4);
  assert.equal(session.counts.userMessages, 2);
  assert.equal(session.logicalEvents.filter((event) => event.subtype === 'session_meta').length, 1);
  assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'superseded-root-tail' }).searchEventCount, 0);
  for (const text of ['kept-ancestor', 'current-head-message']) assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: text }).searchEventCount, 1);
  assert.equal(new Set(session.rawEvents.map((raw) => raw.rawId)).size, 4);
  for (const raw of session.rawEvents) {
    const read = await codex.readRawLine(index, raw.source.file, raw.source.line);
    const expected = raw.source.file.replace(/\\/gu, '/') === file(ROOT) ? f.firstRows : f.secondRows;
    assert.deepEqual(read.parsed, expected[raw.source.line - 1]);
  }
});

test('source-backed history materializes the same chain with strict source dependencies', async (t) => {
  const f = await historyFixture(t);
  const index = await codex.buildSourceBackedIndex(f.options);
  assert.equal(index.sessions.length, 1);
  await validateIndexOwnershipForCommit(index, 'codex');
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(session.counts.userMessages, 2);
  for (const q of ['kept-ancestor', 'current-head-message']) {
    const result = codex.query.getTimeline(index, session, { layer: 'main', q });
    assert.equal(result.searchEventCount, 1);
    const owner = session.logicalEvents.find((e) => e.searchText.includes(q));
    const detail = await codex.buildHydratedEventDetail(index, session, owner.id, 'main', { locale: 'en' });
    assert.match(JSON.stringify(detail), new RegExp(q));
  }
});

test('invalid cutoffs report source diagnostics while unrelated logical threads remain readable', async (t) => {
  const f = await historyFixture(t);
  f.secondRows[0].payload.history_base.end_ordinal_exclusive = 999;
  await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), f.secondRows.map(JSON.stringify).join('\n') + '\n');
  await fs.writeFile(path.join(f.sessionsRoot, file(OTHER, OTHER)), JSON.stringify({ type: 'session_meta', payload: { id: OTHER, cwd: f.repoRoot } }) + '\n');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    assert.deepEqual(index.sessions.map((session) => session.id), [OTHER]);
    assert.ok(JSON.stringify(index.sourceDiagnostics).includes('CODEX_HISTORY_BOUNDARY_INVALID'));
    if (build === codex.buildSourceBackedIndex) {
      assert.equal(index.totals.candidateFileCount, 1, 'pass-A exclusion refreshes the cached selected physical count');
      assert.equal(index.totals.indexedFileCount, 1);
    }
  }
});

test('state pointer can select the pre-cutover ancestor and preserve its full current content', async (t) => {
  const f = await historyFixture(t);
  const index = await codex.buildIndex({ ...f.options, currentRolloutPathsForTests: new Map([[ROOT, path.join(f.sessionsRoot, file(ROOT))]]) });
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions[0].counts.userMessages, 2);
  assert.equal(codex.query.getTimeline(index, index.sessions[0], { layer: 'main', q: 'superseded-root-tail' }).searchEventCount, 1);
  assert.equal(codex.query.getTimeline(index, index.sessions[0], { layer: 'main', q: 'current-head-message' }).searchEventCount, 0);
});

test('compressed Unicode/CRLF history uses decoded byte offsets and physical line readback', async (t) => {
  const f = await historyFixture(t);
  f.firstRows[1].payload.content[0].text = '祖先保留 🧪 Unicode';
  const rootText = f.firstRows.map(JSON.stringify).join('\r\n') + '\r\n';
  const prefix = f.firstRows.slice(0, 2).map(JSON.stringify).join('\r\n') + '\r\n';
  f.secondRows[0].payload.history_base.end_byte_offset = Buffer.byteLength(prefix);
  for (const [id, text] of [[ROOT, rootText], [ONE, f.secondRows.map(JSON.stringify).join('\r\n') + '\r\n']]) {
    await fs.writeFile(path.join(f.sessionsRoot, file(id)) + '.zst', zstdCompressSync(Buffer.from(text)));
    await fs.unlink(path.join(f.sessionsRoot, file(id)));
  }
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    assert.equal(index.sessions.length, 1);
    const session = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, index.sessions[0]) : index.sessions[0];
    assert.equal(session.counts.userMessages, 2);
    const owner = session.logicalEvents.find((event) => event.searchText.includes('祖先保留'));
    assert.ok(owner);
    assert.match(JSON.stringify(await codex.buildHydratedEventDetail(index, session, owner.id, 'main', { locale: 'zh-CN' })), /祖先保留 🧪 Unicode/);
    const raw = session.rawEvents.find((r) => r.source.file.replace(/\\/gu, '/') === file(ROOT) && r.source.line === 2);
    assert.deepEqual((await codex.readRawLine(index, raw.source.file, raw.source.line)).parsed, f.firstRows[1]);
  }
});

test('multiple reverts, append, warm reuse and pointer cutovers retain stable accepted identities', async (t) => {
  const f = await historyFixture(t);
  const initial = await codex.buildSourceBackedIndex(f.options);
  const initialSession = await materializeSessionForIndex(initial, initial.sessions[0]);
  const retained = initialSession.logicalEvents.find((e) => e.searchText.includes('kept-ancestor'));
  const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: initial });
  assert.equal(warm.totals.reusedFileCount, 1);
  assert.equal((await materializeSessionForIndex(warm, warm.sessions[0])).logicalEvents.find((e) => e.searchText.includes('kept-ancestor')).id, retained.id);
  const appended = { ordinal: 4, timestamp: '2026-10-14T11:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'discarded-second-tail' }] } };
  await fs.appendFile(path.join(f.sessionsRoot, file(ONE)), JSON.stringify(appended) + '\n');
  const appendedIndex = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: warm });
  assert.equal(appendedIndex.sessions[0].counts.userMessages, 3);
  const secondPrefix = f.secondRows.map(JSON.stringify).join('\n') + '\n';
  const thirdRows = [{ ordinal: 4, timestamp: '2026-10-14T12:00:00Z', type: 'session_meta', payload: { id: ROOT, cwd: f.repoRoot, history_mode: 'paginated', history_base: base(ONE, 4, Buffer.byteLength(secondPrefix)) } },
    { ordinal: 5, timestamp: '2026-10-14T12:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'third-current-message' }] } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(TWO)), thirdRows.map(JSON.stringify).join('\n') + '\n');
  const currentOptions = { ...f.options, currentRolloutPathsForTests: new Map([[ROOT, path.join(f.sessionsRoot, file(TWO))]]) };
  const current = await codex.buildSourceBackedIndex({ ...currentOptions, previousIndex: appendedIndex });
  await validateIndexOwnershipForCommit(current, 'codex');
  const session = await materializeSessionForIndex(current, current.sessions[0]);
  assert.equal(session.counts.userMessages, 3);
  assert.equal(codex.query.getTimeline(current, session, { layer: 'main', q: 'discarded-second-tail' }).searchEventCount, 0);
  assert.equal(codex.query.getTimeline(current, session, { layer: 'main', q: 'third-current-message' }).searchEventCount, 1);
  assert.ok(session.logicalEvents.some((event) => event.id === retained.id));
  for (const raw of session.rawEvents) {
    const legacy = codex.resolveIndexedCodexLegacyRaw(current, raw.source.file, raw.source.line);
    assert.equal(legacy.rawIdHint, raw.rawId);
    assert.equal(legacy.sessionId, ROOT);
  }
  const rewound = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: current,
    currentRolloutPathsForTests: new Map([[ROOT, path.join(f.sessionsRoot, file(ROOT))]]) });
  assert.equal(rewound.sessions[0].counts.userMessages, 2);
  assert.equal(rewound.sessions[0].sourceFile.replace(/\\/gu, '/'), file(ROOT));
});

test('copied history snapshot tampering and ancestor rewrite reject stale or invalid reads', async (t) => {
  const f = await historyFixture(t);
  const index = await codex.buildSourceBackedIndex(f.options);
  const indexed = index.sessions[0];
  const dependencies = index.materializationDependencies.get(indexed.materializationDescriptor.dependencySetId);
  const corrupted = structuredClone(indexed.materializationDescriptor);
  corrupted.payload.historySnapshots[0].acceptedBytes += 1;
  assert.throws(() => codex.validateCodexMaterializationDescriptor({ materializationContext: { sessionsRoot: f.sessionsRoot }, indexedSession: indexed, descriptor: corrupted, dependencySet: dependencies }));
  const corruptDependency = structuredClone(dependencies);
  corruptDependency.entries[0].digest = 'invalid';
  assert.throws(() => codex.validateCodexMaterializationDescriptor({ materializationContext: { sessionsRoot: f.sessionsRoot }, indexedSession: indexed, descriptor: indexed.materializationDescriptor, dependencySet: corruptDependency }));
  const session = await materializeSessionForIndex(index, indexed);
  const raw = session.rawEvents.find((r) => r.source.file.replace(/\\/gu, '/') === file(ROOT) && r.source.line === 2);
  f.firstRows[1].payload.content[0].text = 'tampered-text';
  await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), f.firstRows.map(JSON.stringify).join('\n') + '\n');
  await assert.rejects(codex.readIndexedCodexRawRecord(index, session, raw), { code: 'INDEXED_SOURCE_STALE' });
  const fresh = await codex.buildSourceBackedIndex(f.options);
  const freshIndexed = fresh.sessions[0];
  await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), f.firstRows.map(JSON.stringify).join('\n') + '\nextra\n');
  // Accepted-prefix append does not change a previously accepted history.
  assert.equal((await materializeSessionForIndex(fresh, freshIndexed)).counts.userMessages, 2);
});

test('wrong, missing, duplicate, gapped ordinals and byte-midline cutoffs stay explicit diagnostics', async (t) => {
  const f = await historyFixture(t);
  const original = structuredClone(f.secondRows);
  for (const mutate of [
    (rows) => { delete rows[1].ordinal; },
    (rows) => { rows[1].ordinal = rows[0].ordinal; },
    (rows) => { rows[1].ordinal += 1; },
    (rows) => { rows[0].payload.history_mode = 'legacy'; },
    (rows) => { rows[0].payload.history_base.end_byte_offset -= 1; },
  ]) {
    const rows = structuredClone(original); mutate(rows);
    await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), rows.map(JSON.stringify).join('\n') + '\n');
    for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
      const index = await build(f.options);
      assert.equal(index.sessions.length, 0);
      assert.ok(JSON.stringify(index.sourceDiagnostics).includes('CODEX_HISTORY_'));
    }
  }
});

test('command calls and results correlate across accepted physical segments with exact Raw refs', async (t) => {
  const f = await historyFixture(t);
  f.firstRows[1] = { ordinal: 1, timestamp: '2026-10-14T10:00:01Z', type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'split-command', arguments: JSON.stringify({ command: 'echo split-command' }) } };
  const prefix = f.firstRows.slice(0, 2).map(JSON.stringify).join('\n') + '\n';
  f.secondRows[0].payload.history_base.end_byte_offset = Buffer.byteLength(prefix);
  f.secondRows[1] = { ordinal: 3, timestamp: '2026-10-14T11:00:01Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'split-command', output: 'Exit code: 0\nWall time: 1 second\nOutput:\nsplit-command-result' } };
  await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), f.firstRows.map(JSON.stringify).join('\n') + '\n');
  await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), f.secondRows.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(session.counts.toolCalls, 1);
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  assert.equal(command.rawRefs.length, 2);
  assert.equal(new Set(command.rawRefs.map((ref) => ref.file)).size, 2);
  assert.equal(command.status, 'success');
  const detail = await codex.buildHydratedEventDetail(index, session, command.id, 'main', { locale: 'en' });
  assert.match(JSON.stringify(detail), /split-command-result/);
  assert.equal(detail.timelineSections.find((section) => section.type === 'terminal').stream, 'output');
});

test('cross-thread history bases preserve inherited Raw without attributing parent actions to child Main', async (t) => {
  for (const variant of ['plain', 'zstd', 'archive', 'archive-zstd']) await t.test(variant, async (t) => {
  const f = await historyFixture(t);
  const childRows = [{ ordinal: 2, timestamp: '2026-10-14T12:00:00Z', type: 'session_meta', payload: { id: OTHER, cwd: f.repoRoot,
    history_mode: 'paginated', forked_from_id: ROOT, history_base: f.secondRows[0].payload.history_base } },
    { ordinal: 3, timestamp: '2026-10-14T12:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'child-owned-message' }] } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(OTHER, OTHER)), childRows.map(JSON.stringify).join('\n') + '\n');
  let ancestor = path.join(f.sessionsRoot, file(ROOT));
  if (variant.startsWith('archive')) {
    const archived = path.join(f.codexHome, 'archived_sessions', file(ROOT));
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(ancestor, archived);
    ancestor = archived;
  }
  if (variant.includes('zstd')) {
    await fs.writeFile(`${ancestor}.zst`, zstdCompressSync(await fs.readFile(ancestor)));
    await fs.unlink(ancestor);
  }
  const sourcePath = path.relative(f.sessionsRoot, ancestor);
  const index = await codex.buildSourceBackedIndex(f.options);
  await validateIndexOwnershipForCommit(index, 'codex');
  assert.equal(index.sessions.length, 2);
  const child = await materializeSessionForIndex(index, index.sessionsById.get(OTHER));
  assert.equal(child.counts.userMessages, 1);
  assert.equal(child.rawEvents.length, 4);
  assert.equal(child.rawEvents.filter((raw) => raw.subagentInherited).length, 2);
  assert.equal(codex.query.getTimeline(index, child, { layer: 'main', q: 'kept-ancestor' }).searchEventCount, 0);
  assert.equal(codex.query.getTimeline(index, child, { layer: 'raw', q: 'kept-ancestor' }).searchEventCount, 1);
  const inherited = child.rawEvents.find((raw) => raw.subagentInherited && raw.source.line === 2);
  assert.deepEqual((await codex.readIndexedCodexRawRecord(index, child, inherited)).parsed, f.firstRows[1]);
  assert.equal(child.logicalEvents.some((event) => event.rawRefs.some((ref) => ref.rawId === inherited.rawId)), false);
  assert.equal(codex.resolveIndexedCodexLegacyRaw(index, inherited.source.file, inherited.source.line), null, 'shared physical line has ambiguous legacy owner');
  const parent = await materializeSessionForIndex(index, index.sessionsById.get(ROOT));
  const retainedRaw = parent.rawEvents.find((raw) => raw.source.file === sourcePath && raw.source.line === 2);
  const retainedOwner = parent.logicalEvents.find((event) => event.rawRefs.some((ref) => ref.rawId === retainedRaw.rawId));
  assert.equal(retainedOwner.layer, 'main');

  const service = await createHistoryService({ repo: f.repoRoot, source: 'codex', codexHome: f.codexHome });
  t.after(() => service.close());
  assert.equal((await service.execute('status')).coverage.sessionCount, 2);
  for (const rejectedPath of [sourcePath, ancestor]) {
    await assert.rejects(service.execute('read', { source: { sourcePath: rejectedPath,
      locator: { type: 'jsonl-line', line: 2 } } }),
    { code: 'UNKNOWN_SOURCE', message: /Search the current snapshot.*read the returned event refs/u });
  }
  const retained = (await service.execute('search', { query: 'kept-ancestor', session: ROOT })).items;
  assert.equal(retained.length, 1);
  assert.equal(retained[0].eventId, retainedOwner.id);
  const read = await service.execute('read', { refs: [retained[0].ref], parts: ['message'] });
  assert.match(read.items[0].parts[0].text, /kept-ancestor/u);
  const raw = await service.execute('read', { refs: read.items[0].rawRefs, parts: ['raw'] });
  assert.deepEqual(JSON.parse(raw.items[0].parts[0].text).parsed, f.firstRows[1]);
  assert.equal((await service.execute('search', { query: 'kept-ancestor', session: OTHER })).items.length, 0);
  const inheritedHits = (await service.execute('search', { query: 'kept-ancestor', session: OTHER, layer: 'raw' })).items;
  assert.equal(inheritedHits.length, 1);
  const inheritedRead = await service.execute('read', { refs: [inheritedHits[0].ref], parts: ['raw'] });
  assert.deepEqual(JSON.parse(inheritedRead.items[0].parts[0].text).parsed, f.firstRows[1]);
  assert.equal((await service.execute('search', { query: 'superseded-root-tail', layer: 'raw' })).items.length, 0);
  const head = await service.execute('read', { source: { sourcePath: path.join(f.sessionsRoot, file(ONE)),
    locator: { type: 'jsonl-line', line: 2 } } });
  const headOwner = head.items[0].logicalRefs.find((link) => link.layer === 'main');
  assert.ok(headOwner);
  assert.match((await service.execute('read', { refs: [headOwner.ref], parts: ['message'] })).items[0].parts[0].text,
    /current-head-message/u);
  });
});

test('Code Mode observation and nested ownership cross a verified history-chain interval', async (t) => {
  const f = await historyFixture(t);
  f.firstRows = [f.firstRows[0],
    { ordinal: 1, timestamp: '2026-10-14T10:00:01Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'outer', turn_id: 'chain-turn', input: "const r = await tools.shell_command({command: 'echo chain'}); text(r);" } },
    { ordinal: 2, timestamp: '2026-10-14T10:00:02Z', type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'nested', turn_id: 'chain-turn', arguments: JSON.stringify({ command: 'echo chain' }) } }];
  const prefix = f.firstRows.map(JSON.stringify).join('\n') + '\n';
  f.secondRows = [ { ...f.secondRows[0], ordinal: 3, payload: { ...f.secondRows[0].payload, history_base: base(ROOT, 3, Buffer.byteLength(prefix)) } },
    { ordinal: 4, timestamp: '2026-10-14T11:00:01Z', type: 'event_msg', payload: { type: 'item_completed', thread_id: ROOT, turn_id: 'chain-turn', item: { type: 'CommandExecution', id: 'nested', command: ['echo', 'chain'], status: 'completed', exit_code: 0, aggregated_output: 'chain-result' } } },
    { ordinal: 5, timestamp: '2026-10-14T11:00:02Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'outer', turn_id: 'chain-turn', output: 'Script completed\nOutput:\nchain-result' } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), prefix);
  await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), f.secondRows.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex(f.options);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const nested = session.logicalEvents.find((event) => event.kind === 'command');
  assert.ok(operation);
  assert.ok(nested);
  assert.ok(operation.codeModeOperation.eventRefs.includes(nested.id));
  const detail = await codex.buildHydratedEventDetail(index, session, operation.id, 'main', { locale: 'en' });
  assert.match(JSON.stringify(detail), /chain-result/);
});

test('history service searches and reads physical-chain evidence with snapshot-bound refs after cutover', async (t) => {
  const f = await historyFixture(t);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(f.codexHome, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES (?, ?)').run(ROOT, path.join(f.sessionsRoot, file(ONE)));
  db.close();
  const options = { repo: f.repoRoot, source: 'codex', codexHome: f.codexHome };
  const service = await createHistoryService(options);
  t.after(() => service.close());
  assert.equal((await service.execute('status')).coverage.sessionCount, 1);
  const retained = (await service.execute('search', { query: 'kept-ancestor' })).items[0];
  const withdrawn = (await service.execute('search', { query: 'current-head-message' })).items[0];
  assert.ok(retained.ref);
  assert.ok(withdrawn.ref);
  const read = await service.execute('read', { refs: [retained.ref], parts: ['message'], length: 10000 });
  assert.match(read.items[0].parts[0].text, /kept-ancestor/);
  const rawRead = await service.execute('read', { refs: read.items[0].rawRefs, parts: ['raw'], length: 10000 });
  assert.match(rawRead.items[0].parts[0].text, /kept-ancestor/);
  await service.close();
  const update = new DatabaseSync(path.join(f.codexHome, 'state_5.sqlite'));
  update.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?').run(path.join(f.sessionsRoot, file(ROOT)), ROOT);
  update.close();
  const restarted = await createHistoryService(options);
  t.after(() => restarted.close());
  await assert.rejects(restarted.execute('read', { refs: [retained.ref], parts: ['message'] }), { code: 'STALE_REFERENCE' });
  const refreshed = (await restarted.execute('search', { query: 'kept-ancestor' })).items[0];
  assert.equal(refreshed.eventId, retained.eventId);
  assert.match((await restarted.execute('read', { refs: [refreshed.ref], parts: ['message'] })).items[0].parts[0].text, /kept-ancestor/);
  await assert.rejects(restarted.execute('read', { refs: [withdrawn.ref], parts: ['message'] }));
  assert.equal((await restarted.execute('search', { query: 'superseded-root-tail' })).items.length, 1);
});


test('archived rollouts are explicit dependency-only history sources with exact Raw provenance', async (t) => {
  const f = await historyFixture(t);
  const archived = path.join(f.codexHome, 'archived_sessions', file(ROOT));
  await fs.mkdir(path.dirname(archived), { recursive: true });
  await fs.rename(path.join(f.sessionsRoot, file(ROOT)), archived);
  await fs.writeFile(path.join(path.dirname(archived), path.basename(file(OTHER, OTHER))), JSON.stringify({ type: 'session_meta', payload: { id: OTHER, cwd: f.repoRoot } }) + '\n');
  const relative = path.relative(f.sessionsRoot, archived);
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(f.options);
    assert.equal(index.sessions.length, 1, JSON.stringify(index.sourceDiagnostics));
    assert.equal(index.totals.candidateFileCount, 2);
    assert.equal(index.totals.indexedFileCount, 2);
    assert.equal(index.sourceDiagnostics.samples.some((entry) => entry.code === 'CODEX_HISTORY_BASE_MISSING'), false);
    if (build === codex.buildSourceBackedIndex) await validateIndexOwnershipForCommit(index, 'codex');
    const session = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, index.sessions[0]) : index.sessions[0];
    assert.equal(session.counts.userMessages, 2);
    const raw = session.rawEvents.find((entry) => entry.source.file === relative && entry.source.line === 2);
    assert.ok(raw);
    assert.deepEqual((await codex.readIndexedCodexRawRecord(index, session, raw)).parsed, f.firstRows[1]);
    assert.deepEqual((await codex.readRawLine(index, relative, 2)).parsed, f.firstRows[1]);
    assert.ok(codex.resolveIndexedCodexLegacyRaw(index, relative, 2));
    assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'kept-ancestor' }).searchEventCount, 1);
    if (build === codex.buildSourceBackedIndex) {
      const warm = await codex.buildSourceBackedIndex({ ...f.options, previousIndex: index });
      assert.equal(warm.sessions.length, 1);
      assert.equal(warm.totals.reusedFileCount, 1);
      assert.equal(warm.totals.candidateFileCount, 2);
      assert.equal(warm.totals.indexedFileCount, 2);
    }
  }
});

test('archive path admission rejects arbitrary traversal and symlink escapes', async (t) => {
  const f = await historyFixture(t);
  const storage = require('../src/codex-rollout-storage');
  for (const relative of ['../escape.jsonl', '../archived_sessions/../escape.jsonl', '../archived_sessions/nested/../../escape.jsonl']) {
    assert.equal(storage.isHistoryRelativePath(f.sessionsRoot, relative), false);
    await assert.rejects(storage.resolveRolloutArtifact(f.sessionsRoot, relative, { allowArchivedHistory: true }), { code: 'CODEX_ROLLOUT_STORAGE_INVALID' });
  }
  const archiveRoot = path.join(f.codexHome, 'archived_sessions');
  await fs.mkdir(archiveRoot);
  const link = path.join(archiveRoot, 'escape');
  try { await fs.symlink(f.sessionsRoot, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('symlink permission unavailable'); return; } throw error; }
  const relative = path.join('..', 'archived_sessions', 'escape', file(ROOT));
  await assert.rejects(storage.resolveRolloutArtifact(f.sessionsRoot, relative, { allowArchivedHistory: true }), { code: 'CODEX_ROLLOUT_STORAGE_INVALID' });
});


test('missing accepted history ancestors become stale snapshots for plain, Zstd and archive sources', async (t) => {
  for (const variant of ['plain', 'zstd', 'archive', 'archive-zstd', 'archive-notdir']) await t.test(variant, async (t) => {
    const f = await historyFixture(t);
    let ancestor = path.join(f.sessionsRoot, file(ROOT));
    if (variant.startsWith('archive')) {
      const destination = path.join(f.codexHome, 'archived_sessions', file(ROOT));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(ancestor, destination); ancestor = destination;
    }
    if (variant.includes('zstd')) {
      await fs.writeFile(ancestor + '.zst', zstdCompressSync(await fs.readFile(ancestor)));
      await fs.unlink(ancestor); ancestor += '.zst';
    }
    const index = await codex.buildSourceBackedIndex(f.options);
    assert.equal(index.sessions.length, 1);
    if (variant === 'archive-notdir') {
      await fs.rm(path.join(f.codexHome, 'archived_sessions'), { recursive: true });
      await fs.writeFile(path.join(f.codexHome, 'archived_sessions'), 'not a directory');
    } else await fs.unlink(ancestor);
    await assert.rejects(materializeSessionForIndex(index, index.sessions[0]), { code: 'INDEXED_SOURCE_STALE', statusCode: 409 });
    const controller = new AbortController();
    const cancellation = Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
    controller.abort(cancellation);
    await assert.rejects(materializeSessionForIndex(index, index.sessions[0], { signal: controller.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
  });
});

test('shared ordinary parents count as one physical source across history children and warm builds', async (t) => {
  for (const compressed of [false, true]) await t.test(compressed ? 'Zstd parent' : 'plain parent', async (t) => {
  const f = await historyFixture(t);
  await fs.unlink(path.join(f.sessionsRoot, file(ONE)));
  if (compressed) {
    const parent = path.join(f.sessionsRoot, file(ROOT));
    await fs.writeFile(parent + '.zst', zstdCompressSync(await fs.readFile(parent)));
    await fs.unlink(parent);
  }
  const childRows = [{ ...f.secondRows[0], payload: { ...f.secondRows[0].payload, id: OTHER, forked_from_id: ROOT } }, f.secondRows[1]];
  await fs.writeFile(path.join(f.sessionsRoot, file(OTHER, OTHER)), childRows.map(JSON.stringify).join('\n') + '\n');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    let previousIndex = null;
    for (let round = 0; round < 2; round += 1) {
      const progress = [];
      const index = await build({ ...f.options, previousIndex, onProgress: (entry) => progress.push(entry) });
      assert.equal(index.sessions.length, 2);
      assert.equal(index.totals.candidateFileCount, 2);
      assert.equal(index.totals.indexedFileCount, 2);
      for (const entry of progress.filter((entry) => entry.phase === 'complete')) {
        assert.equal(entry.candidateFileCount, 2);
        assert.equal(entry.indexedFileCount, 2);
      }
      previousIndex = index;
    }
  }
  });
});


test('missing archived ancestor returns HTTP 409 through the timeline route', async (t) => {
  const f = await historyFixture(t);
  const ancestor = path.join(f.codexHome, 'archived_sessions', file(ROOT));
  await fs.mkdir(path.dirname(ancestor), { recursive: true });
  await fs.rename(path.join(f.sessionsRoot, file(ROOT)), ancestor);
  const index = await codex.buildSourceBackedIndex(f.options);
  const { createServer } = require('../server');
  const server = createServer(index, 1, { sessionPrewarm: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await fs.unlink(ancestor);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/${ROOT}/timeline?layer=main`);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'INDEXED_SOURCE_STALE');
});


test('reverted subagent history preserves validated inherited parent records across all physical headers', async (t) => {
  const f = await historyFixture(t);
  const parentRows = [
    { type: 'session_meta', payload: { id: ROOT, cwd: f.repoRoot, history_mode: 'paginated', forked_from_id: OTHER, parent_thread_id: OTHER, subagent_history_start_ordinal: 6, source: { subagent: { thread_spawn: { parent_thread_id: OTHER, depth: 1 } } } } },
    { type: 'session_meta', payload: { id: OTHER, cwd: f.repoRoot, history_mode: 'paginated' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inherited-reverted-parent-message' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'inherited-execution', arguments: JSON.stringify({ command: 'echo inherited-reverted-parent-command' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'inherited-execution', output: 'Exit code: 0\nOutput:\ninherited-reverted-parent-result' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 16384, cached_input_tokens: 16384 } } } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'original-child-owned-message' }] } },
  ].map((row, ordinal) => ({ timestamp: new Date(Date.parse('2026-10-14T10:00:00Z') + ordinal * 1000).toISOString(), ordinal, ...row }));
  const parentText = parentRows.map(JSON.stringify).join('\n') + '\n';
  const headRows = [{ ...f.secondRows[0], ordinal: 7, payload: { ...f.secondRows[0].payload, forked_from_id: OTHER, parent_thread_id: OTHER, subagent_history_start_ordinal: 6, source: parentRows[0].payload.source, history_base: base(ROOT, 7, Buffer.byteLength(parentText)) } }, { ...f.secondRows[1], ordinal: 8 }, { timestamp: '2026-10-14T11:00:02Z', ordinal: 9, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 4096, cached_input_tokens: 0 } } } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), parentText);
  await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), headRows.map(JSON.stringify).join('\n') + '\n');
  const { rawForkSegment } = require('../src/codex-forks');
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    let previousIndex;
    for (let round = 0; round < 2; round += 1) {
      const index = await build({ ...f.options, previousIndex, cacheObservationForTests: true });
      if (build === codex.buildSourceBackedIndex) await validateIndexOwnershipForCommit(index, 'codex');
      const session = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, index.sessions[0], { cacheObservation: true }) : index.sessions[0];
      assert.equal(session.counts.userMessages, 2);
      assert.equal(session.counts.toolCalls, 0);
      assert.equal(session.rawEvents.filter((raw) => raw.subagentInherited).length, 5);
      for (const [layer, expected] of [['main', 0], ['protocol', 0], ['raw', 1]]) {
        assert.equal(codex.query.getTimeline(index, session, { layer, q: 'inherited-reverted-parent-message' }).searchEventCount, expected);
      }
      assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'original-child-owned-message' }).searchEventCount, 1);
      const inherited = session.rawEvents.find((raw) => raw.source.file.endsWith(path.basename(file(ROOT))) && raw.source.line === 4);
      assert.equal(rawForkSegment(session, inherited.rawId), 'inherited_context');
      assert.deepEqual((await codex.readIndexedCodexRawRecord(index, session, inherited)).parsed, parentRows[3]);
      const originalHeader = session.rawEvents.find((raw) => raw.source.file.endsWith(path.basename(file(ROOT))) && raw.source.line === 1);
      assert.equal(originalHeader.subagentInherited === true, false);
      assert.equal(rawForkSegment(session, originalHeader.rawId), 'fork_metadata');
      assert.equal(session.logicalEvents.some((event) => event.cacheObservation?.inputTokens === 16384), false);
      assert.equal(session.logicalEvents.filter((event) => event.cacheObservation?.inputTokens === 4096).length, 1);
      previousIndex = index;
    }
  }
});

test('single-file physical-count work grows linearly with and without progress callbacks', async (t) => {
  const storage = require('../src/codex-rollout-storage');
  const original = storage.logicalRolloutPath;
  let calls = 0;
  storage.logicalRolloutPath = (...args) => { calls += 1; return original(...args); };
  t.after(() => { storage.logicalRolloutPath = original; });
  for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) for (const progress of [false, true]) {
    const counts = [];
    for (const count of [8, 16]) {
      const f = await historyFixture(t);
      await fs.rm(path.join(f.sessionsRoot, '2026'), { recursive: true });
      for (let i = 0; i < count; i += 1) await fs.writeFile(path.join(f.sessionsRoot, `ordinary-${i}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id: `ordinary-${i}`, cwd: f.repoRoot } }) + '\n');
      calls = 0;
      const index = await build({ ...f.options, onProgress: progress ? () => {} : undefined });
      counts.push(calls);
      assert.equal(index.sessions.length, count);
      assert.equal(index.totals.candidateFileCount, count);
      assert.equal(index.totals.indexedFileCount, count);
    }
    t.diagnostic(`${build.name} progress=${progress}: normalization operations ${counts.join(' -> ')}`);
    assert.ok(counts[1] <= counts[0] * 2 + 2, `${build.name} progress=${progress}: normalization operations ${counts.join(' -> ')}`);
  }
});


test('committed active heads admit bounded archived unselected evidence without replaying it', async (t) => {
  const f = await historyFixture(t);
  const archived = path.join(f.codexHome, 'archived_sessions', file(ONE));
  await fs.mkdir(path.dirname(archived), { recursive: true });
  await fs.rename(path.join(f.sessionsRoot, file(ONE)), archived);
  const archivedBytes = Buffer.byteLength(f.secondRows.map(JSON.stringify).join('\n') + '\n');
  const replacement = [{ ...f.secondRows[0], ordinal: 4, payload: { ...f.secondRows[0].payload, history_base: base(ONE, 4, archivedBytes) } }, { ...f.secondRows[1], ordinal: 5, payload: { ...f.secondRows[1].payload, content: [{ type: 'input_text', text: 'unselected-replacement-only' }] } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(TWO)), replacement.map(JSON.stringify).join('\n') + '\n');
  const index = await codex.buildSourceBackedIndex({ ...f.options, currentRolloutPathsForTests: new Map([[ROOT, path.join(f.sessionsRoot, file(ROOT))]]) });
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  assert.ok(indexed.materializationDescriptor.payload.historyPlan.unselectedSourceFiles.includes(path.relative(f.sessionsRoot, archived)));
  await validateIndexOwnershipForCommit(index, 'codex');
  const session = await materializeSessionForIndex(index, indexed);
  assert.equal(session.rawEvents.length, f.firstRows.length);
  assert.equal(session.rawEvents.some((raw) => raw.source.file.includes('archived_sessions')), false);
  for (const layer of ['main', 'protocol', 'raw']) assert.equal(codex.query.getTimeline(index, session, { layer, q: 'unselected-replacement-only' }).searchEventCount, 0);
  const dependencies = index.materializationDependencies.get(indexed.materializationDescriptor.dependencySetId);
  const { hashPlainValue } = require('../src/plain-value-stream');
  for (const invalid of ['../escape.jsonl', '../archived_sessions/../escape.jsonl', '../archived_sessions/nested/../../escape.jsonl', path.join(f.codexHome, 'absolute.jsonl'), '']) {
    const descriptor = structuredClone(indexed.materializationDescriptor);
    descriptor.payload.historyPlan.unselectedSourceFiles = [invalid];
    descriptor.sourceSnapshotId = 'codex-snapshot:' + hashPlainValue({ dependencySet: dependencies, payload: descriptor.payload });
    assert.throws(() => codex.validateCodexMaterializationDescriptor({ materializationContext: { sessionsRoot: f.sessionsRoot }, indexedSession: indexed, descriptor, dependencySet: dependencies }), /head-selection evidence/);
  }
});

test('retained owned ancestor shell context controls command detail with first qualifying environment precedence', async (t) => {
  for (const archive of [false, true]) await t.test(archive ? 'archived ancestor' : 'live ancestor', async (t) => {
    const f = await historyFixture(t);
    const environment = (shell) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' + (shell ? '<shell>' + shell + '</shell>' : '<cwd>missing-shell</cwd>') + '</environment_context>' }] } });
    const rootRows = [f.firstRows[0], environment(''), environment('powershell'), f.firstRows[1], environment('bash')].map((row, ordinal) => ({ ...row, ordinal }));
    const prefix = rootRows.slice(0, 4).map(JSON.stringify).join('\n') + '\n';
    const headRows = [{ ...f.secondRows[0], ordinal: 4, payload: { ...f.secondRows[0].payload, history_base: base(ROOT, 4, Buffer.byteLength(prefix)) } },
      { ordinal: 5, type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'shell-context-command', arguments: JSON.stringify({ command: 'git status' }) } },
      { ordinal: 6, type: 'response_item', payload: { type: 'function_call_output', call_id: 'shell-context-command', output: 'Exit code: 0\nOutput:\nclean' } }, { ...environment('bash'), ordinal: 7 }];
    await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), rootRows.map(JSON.stringify).join('\n') + '\n');
    await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), headRows.map(JSON.stringify).join('\n') + '\n');
    if (archive) { const target = path.join(f.codexHome, 'archived_sessions', file(ROOT)); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rename(path.join(f.sessionsRoot, file(ROOT)), target); }
    for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
      let previousIndex;
      for (let round = 0; round < 2; round += 1) {
        const index = await build({ ...f.options, previousIndex });
        if (build === codex.buildSourceBackedIndex) await validateIndexOwnershipForCommit(index, 'codex');
        const session = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, index.sessions[0]) : index.sessions[0];
        assert.equal(session.shell || session._shell, 'powershell');
        const command = session.logicalEvents.find((event) => event.kind === 'command');
        const detail = await codex.buildHydratedEventDetail(index, session, command.id, 'main', { locale: 'en' });
        assert.equal(detail.timelineSections.find((section) => section.type === 'code' && section.code === 'git status').language, 'powershell');
        previousIndex = index;
      }
    }
  });
});


test('history shell context excludes inherited, superseded and unselected environments', async (t) => {
  const environment = (shell) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' + (shell ? '<shell>' + shell + '</shell>' : '<cwd>missing-shell</cwd>') + '</environment_context>' }] } });
  for (const scenario of ['missing tag then head', 'inherited only', 'superseded only', 'unselected only', 'oversized first']) await t.test(scenario, async (t) => {
    const f = await historyFixture(t);
    let rootRows = [f.firstRows[0], f.firstRows[1]];
    if (scenario === 'missing tag then head') rootRows.push(environment(''));
    if (scenario === 'oversized first') rootRows.push(environment('x'.repeat(8192)));
    if (scenario === 'inherited only') {
      rootRows = [{ ...f.firstRows[0], payload: { ...f.firstRows[0].payload, forked_from_id: OTHER, parent_thread_id: OTHER, subagent_history_start_ordinal: 4, source: { subagent: { thread_spawn: { parent_thread_id: OTHER, depth: 1 } } } } },
        { type: 'session_meta', payload: { id: OTHER, cwd: f.repoRoot, history_mode: 'paginated' } }, environment('powershell'), f.firstRows[1], f.firstRows[1]];
    }
    rootRows = rootRows.map((row, ordinal) => ({ ...row, ordinal }));
    const cutoff = rootRows.length;
    const prefix = rootRows.map(JSON.stringify).join('\n') + '\n';
    if (scenario === 'superseded only') rootRows.push({ ...environment('powershell'), ordinal: cutoff });
    const headRows = [{ ...f.secondRows[0], ordinal: cutoff, payload: { ...f.secondRows[0].payload, history_base: base(ROOT, cutoff, Buffer.byteLength(prefix)) } },
      { ordinal: cutoff + 1, type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'shell-negative-command', arguments: JSON.stringify({ command: 'git status' }) } },
      { ordinal: cutoff + 2, type: 'response_item', payload: { type: 'function_call_output', call_id: 'shell-negative-command', output: 'Exit code: 0\nOutput:\nclean' } }];
    if (scenario === 'missing tag then head' || scenario === 'oversized first') headRows.push({ ...environment('powershell'), ordinal: cutoff + 3 });
    await fs.writeFile(path.join(f.sessionsRoot, file(ROOT)), rootRows.map(JSON.stringify).join('\n') + '\n');
    const headText = headRows.map(JSON.stringify).join('\n') + '\n';
    await fs.writeFile(path.join(f.sessionsRoot, file(ONE)), headText);
    if (scenario === 'unselected only') {
      const replacement = [{ ...headRows[0], ordinal: cutoff + 3, payload: { ...headRows[0].payload, history_base: base(ONE, cutoff + 3, Buffer.byteLength(headText)) } }, { ...environment('powershell'), ordinal: cutoff + 4 }];
      await fs.writeFile(path.join(f.sessionsRoot, file(TWO)), replacement.map(JSON.stringify).join('\n') + '\n');
    }
    for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
      const index = await build(f.options);
      if (build === codex.buildSourceBackedIndex) await validateIndexOwnershipForCommit(index, 'codex');
      const session = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, index.sessions[0]) : index.sessions[0];
      assert.equal(session.shell || session._shell || '', scenario === 'missing tag then head' ? 'powershell' : '');
      const command = session.logicalEvents.find((event) => event.kind === 'command');
      const detail = await codex.buildHydratedEventDetail(index, session, command.id, 'main', { locale: 'en' });
      assert.equal(detail.timelineSections.find((section) => section.type === 'code' && section.code === 'git status').language, scenario === 'missing tag then head' ? 'powershell' : 'shell');
    }
  });
});


test('archived parent heads remain dependency-only while inferred child and unrelated sessions survive', async (t) => {
  const f = await historyFixture(t);
  const archive = path.join(f.codexHome, 'archived_sessions', file(ONE));
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.rename(path.join(f.sessionsRoot, file(ONE)), archive);
  const parentText = f.secondRows.map(JSON.stringify).join('\n') + '\n';
  const childRows = [{ ordinal: 4, type: 'session_meta', payload: { id: OTHER, cwd: f.repoRoot, history_mode: 'paginated', forked_from_id: ROOT, history_base: base(ONE, 4, Buffer.byteLength(parentText)) } },
    { ...f.secondRows[1], ordinal: 5, payload: { ...f.secondRows[1].payload, content: [{ type: 'input_text', text: 'archive-parent-child-owned' }] } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(OTHER, OTHER)), childRows.map(JSON.stringify).join('\n') + '\n');
  await fs.writeFile(path.join(f.sessionsRoot, file(TWO, TWO)), JSON.stringify({ type: 'session_meta', payload: { id: TWO, cwd: f.repoRoot } }) + '\n');
  const activePointers = new Map([[ROOT, path.join(f.sessionsRoot, file(ROOT))], [OTHER, path.join(f.sessionsRoot, file(OTHER, OTHER))]]);
  for (const pointer of [null, activePointers]) for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    let previousIndex;
    for (let round = 0; round < 2; round += 1) {
      const index = await build({ ...f.options, currentRolloutPathsForTests: pointer, previousIndex });
      assert.deepEqual(new Set(index.sessions.map((session) => session.id)), new Set(pointer ? [ROOT, OTHER, TWO] : [OTHER, TWO]));
      assert.equal(index.sourceDiagnostics.samples.some((entry) => entry.code === 'CODEX_HISTORY_STANDALONE_HEAD_UNAVAILABLE'), !pointer);
      assert.equal(index.totals.candidateFileCount, 4);
      assert.equal(index.totals.indexedFileCount, 4);
      if (build === codex.buildSourceBackedIndex) await validateIndexOwnershipForCommit(index, 'codex');
      const indexed = index.sessionsById.get(OTHER);
      const child = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, indexed) : indexed;
      assert.equal(child.counts.userMessages, 1);
      assert.equal(child.rawEvents.filter((raw) => raw.subagentInherited).length, 4);
      const archivedRaw = child.rawEvents.find((raw) => raw.source.file.includes('archived_sessions') && raw.source.line === 2);
      assert.ok(archivedRaw);
      assert.deepEqual((await codex.readIndexedCodexRawRecord(index, child, archivedRaw)).parsed, f.secondRows[1]);
      assert.equal(codex.query.getTimeline(index, child, { layer: 'main', q: 'archive-parent-child-owned' }).searchEventCount, 1);
      assert.equal(codex.query.getTimeline(index, child, { layer: 'main', q: 'current-head-message' }).searchEventCount, 0);
      previousIndex = index;
    }
  }
});

test('candidate logical threads discover archived bases from active heads with another project cwd', async (t) => {
  const f = await historyFixture(t);
  const otherRepo = path.join(f.codexHome, 'different-project');
  await fs.mkdir(otherRepo);
  const archive = path.join(f.codexHome, 'archived_sessions', file(ONE));
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.rename(path.join(f.sessionsRoot, file(ONE)), archive);
  const parentText = f.secondRows.map(JSON.stringify).join('\n') + '\n';
  const headRows = [{ ...f.secondRows[0], ordinal: 4, payload: { ...f.secondRows[0].payload, cwd: otherRepo, history_base: base(ONE, 4, Buffer.byteLength(parentText)) } },
    { ...f.secondRows[1], ordinal: 5, payload: { ...f.secondRows[1].payload, content: [{ type: 'input_text', text: 'different-cwd-active-head' }] } }];
  await fs.writeFile(path.join(f.sessionsRoot, file(TWO)), headRows.map(JSON.stringify).join('\n') + '\n');
  const currentRolloutPathsForTests = new Map([[ROOT, path.join(f.sessionsRoot, file(TWO))]]);
  for (const pointer of [currentRolloutPathsForTests, null]) for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
    let previousIndex;
    for (let round = 0; round < 2; round += 1) {
      const index = await build({ ...f.options, currentRolloutPathsForTests: pointer, previousIndex });
      assert.equal(index.sessions.length, 1, JSON.stringify(index.sourceDiagnostics));
      assert.equal(index.sessions[0].sourceFile.replace(/\\/gu, '/'), file(TWO));
      assert.equal(index.totals.candidateFileCount, 3);
      assert.equal(index.totals.indexedFileCount, 3);
      assert.equal(index.sourceDiagnostics.samples.some((entry) => entry.code === 'CODEX_HISTORY_BASE_MISSING'), false);
      if (build === codex.buildSourceBackedIndex) await validateIndexOwnershipForCommit(index, 'codex');
      const session = build === codex.buildSourceBackedIndex ? await materializeSessionForIndex(index, index.sessions[0]) : index.sessions[0];
      assert.equal(session.counts.userMessages, 3);
      assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q: 'different-cwd-active-head' }).searchEventCount, 1);
      assert.ok(session.rawEvents.some((raw) => raw.source.file.includes('archived_sessions')));
      previousIndex = index;
    }
  }
});
