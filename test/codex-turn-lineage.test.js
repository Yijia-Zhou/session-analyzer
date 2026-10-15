'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const { buildEventDetailForSession, materializeSessionForIndex } = require('../src/source-adapters');
const { createTurnLineageBuilder, extractTurnLineageFact, turnLineageSection, validTurnLineageFact } = require('../src/codex-turn-lineage');
const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');
const { renderSection } = require('../src/browser/renderers');

const start = (turn_id, parent_turn_id, root_turn_id, extra = {}) => ({ type: 'event_msg', payload: {
  type: 'task_started', turn_id, root_turn_id,
  turn_attribution: { turn_id, parent_turn_id, root_turn_id }, ...extra,
} });
const message = (text) => ({ type: 'event_msg', payload: { type: 'user_message', message: text } });
const end = (turn_id, root_turn_id) => ({ type: 'event_msg', payload: { type: 'task_complete', turn_id, root_turn_id } });
async function fixture(t, sessions) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'turn-lineage-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot); await fs.mkdir(path.join(home, 'sessions', 'nested'), { recursive: true });
  for (const [sessionId, rows] of Object.entries(sessions)) {
    await fs.writeFile(path.join(home, 'sessions', 'nested', `rollout-${sessionId}.jsonl`),
      [{ type: 'session_meta', payload: { id: sessionId, cwd: repoRoot, cli_version: '0.100.0' } }, ...rows]
        .map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row })).join('\n') + '\n');
  }
  return { codexHome: home, repoRoot };
}
async function section(index, sessionId, turnId) {
  let session = index.sessionsById.get(sessionId);
  if (session.materializationDescriptor) session = await materializeSessionForIndex(index, session);
  const entry = Object.entries(index.codexTurnLineage.sessions[sessionId].events).find(([, id]) => id === turnId);
  const event = session.logicalEvents.find((e) => e.id === entry[0]);
  const detail = await buildEventDetailForSession(index, session, event.id, event.layer, { indexRevision: 7 });
  return detail.inspectorSections.find((s) => s.type === 'turn_lineage');
}

test('resident lineage snapshot verification checks ownership beyond the navigation anchor', async (t) => {
  for (const compressed of [false, true]) {
    const options = await fixture(t, {
      root: [start('r'), message('Root request'), end('r'),
        start('later'), message('x'.repeat(128 * 1024)), end('later')],
    });
    const plain = path.join(options.codexHome, 'sessions', 'nested', 'rollout-root.jsonl');
    const file = compressed ? `${plain}.zst` : plain;
    const original = await fs.readFile(plain, 'utf8');
    const encode = (text) => compressed ? require('node:zlib').zstdCompressSync(Buffer.from(text)) : Buffer.from(text);
    if (compressed) {
      await fs.writeFile(file, encode(original));
      await fs.unlink(plain);
    }
    const index = await codex.buildIndex(options);
    const session = index.sessionsById.get('root');
    await codex.verifyCodexTurnLineageSnapshot(index, session);
    // A later lifecycle record can alter ownership without changing the anchor.
    const changed = original.replace('"type":"task_complete","turn_id":"later"', '"type":"task_complete","turn_id":"other"');
    assert.notEqual(changed, original);
    assert.equal(Buffer.byteLength(changed), Buffer.byteLength(original));
    const handle = await fs.open(file, 'r+');
    try {
      const bytes = encode(changed);
      await handle.write(bytes, 0, bytes.length, 0);
      if (compressed) await handle.truncate(bytes.length);
    } finally { await handle.close(); }
    await assert.rejects(codex.verifyCodexTurnLineageSnapshot(index, session), { code: 'INDEXED_SOURCE_STALE' });
  }
});

test('lineage is identical across resident, compact, source-backed, cold/warm and hydrated detail', async (t) => {
  const options = await fixture(t, {
    root: [start('r', null, 'r'), message('Root request'), end('r', 'r')],
    child: [start('c', 'r', 'r'), message('Child request'), end('c', 'r'),
      start('c2', 'r2', 'r2'), message('Second task'), end('c2', 'r2')],
    grandchild: [start('g', 'c', 'r'), message('Grandchild request'), end('g', 'r')],
    unrelated: [start('r2', null, 'r2'), message('Unrelated request'), end('r2', 'r2')],
  });
  let baseline;
  for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
    const index = await build(options);
    const result = await section(index, 'grandchild', 'g');
    assert.equal(result.parent.target.sessionId, 'child');
    assert.equal(result.root.target.sessionId, 'root');
    assert.equal(result.root.target.layer, 'main');
    assert.equal(result.root.target.indexRevision, 7);
    assert.equal((await section(index, 'root', 'r')).root.status, 'self');
    assert.equal((await section(index, 'child', 'c2')).root.target.sessionId, 'unrelated');
    validateLogicalDetailSection(result);
    assert.ok(Object.isFrozen(index.codexTurnLineage.sessions.child.turns.c.parent));
    if (baseline) assert.deepEqual(result, baseline); else baseline = result;
    const warm = await build({ ...options, previousIndex: index });
    assert.deepEqual(await section(warm, 'grandchild', 'g'), result);
    assert.equal(index.totals.eventCount, warm.totals.eventCount);
  }
});

test('independent parent/root conflicts, missing, duplicate identities, cycles and legacy unknowns', async (t) => {
  const options = await fixture(t, {
    parent: [start('p', null, 'p'), message('parent')],
    cases: [start('mismatch', 'p', 'p', { turn_attribution: { turn_id: 'wrong', parent_turn_id: 'p', root_turn_id: 'wrong' } }), message('mismatch'), end('mismatch', 'p'),
      start('roots', 'p', 'p'), message('roots'), end('roots', 'other'),
      start('root-only', null, 'p'), message('root only'), end('root-only', 'p'),
      start('self', 'self', 'self'), message('self'), end('self', 'self'),
      start('absent', 'missing', 'p'), message('missing'), end('absent', 'p'),
      start('dup-user', 'dup', 'p'), message('dup user'), end('dup-user', 'p'),
      start('legacy'), message('legacy'), end('legacy'),
      start('cycle-a', 'cycle-b', 'p'), message('a'), end('cycle-a', 'p'),
      start('cycle-b', 'cycle-a', 'p'), message('b'), end('cycle-b', 'p')],
    duplicate1: [start('dup'), message('duplicate 1')], duplicate2: [start('dup'), message('duplicate 2')],
    protocol: [start('protocol-only', 'p', 'p')],
    protocolUser: [start('protocol-user', 'protocol-only', 'p'), message('protocol user')],
  });
  const index = await codex.buildSourceBackedIndex(options);
  const expected = { mismatch: ['invalid', 'resolved'], roots: ['resolved', 'conflict'], 'root-only': ['unrecorded', 'resolved'],
    self: ['invalid', 'self'], absent: ['missing', 'resolved'], 'dup-user': ['ambiguous', 'resolved'], legacy: ['unrecorded', 'unrecorded'],
    'cycle-a': ['invalid', 'resolved'], 'cycle-b': ['invalid', 'resolved'] };
  for (const [turn, statuses] of Object.entries(expected)) {
    const s = await section(index, 'cases', turn);
    assert.deepEqual([s.parent.status, s.root.status], statuses, turn);
    validateLogicalDetailSection(s);
  }
  assert.equal((await section(index, 'protocolUser', 'protocol-user')).parent.target.layer, 'protocol');
  const valid = await section(index, 'cases', 'root-only');
  assert.match(renderSection(valid), /Turn relationships/);
  globalThis.sessionAnalyzerLocale = 'zh-CN';
  try { assert.match(renderSection(valid), /Turn 关系/); } finally { delete globalThis.sessionAnalyzerLocale; }
  assert.throws(() => validateLogicalDetailSection({ ...valid, parent: { ...valid.parent, target: valid.root.target } }), /unresolved navigation target/);
  assert.throws(() => validateLogicalDetailSection({ ...valid, root: { ...valid.root, payload: {} } }), /unknown field/);
  const windowsRef = { ...valid.root.rawRefs[0], file: 'nested\\rollout.jsonl',
    sourceLocator: { type: 'jsonl_line', file: 'nested/rollout.jsonl', line: valid.root.rawRefs[0].line } };
  validateLogicalDetailSection({ ...valid, root: { ...valid.root, rawRefs: [windowsRef] } });
  assert.throws(() => validateLogicalDetailSection({ ...valid, root: { ...valid.root,
    rawRefs: [{ ...windowsRef, file: 'different\\rollout.jsonl' }] } }), /invalid Raw locator/);
});

test('raw ownership excludes inherited records and refuses mixed or unknown groups', () => {
  const rows = [start('parent', null, 'parent'), start('a', 'parent', 'parent'), start('b', 'parent', 'parent')];
  const rawEvents = rows.map((parsed, i) => ({ parsed, rawId: `raw-${i}`, turnId: parsed.payload.turn_id,
    recordType: 'event_msg', payloadType: 'task_started', source: { file: 'test.jsonl', line: i + 1 } }));
  rawEvents[0].subagentInherited = true;
  const logicalEvents = [ { id: 'mixed', layer: 'main', turnId: 'a', rawRefs: [{ rawId: 'raw-1' }, { rawId: 'raw-2' }] },
    { id: 'unknown', layer: 'main', turnId: 'a', rawRefs: [{ rawId: 'raw-1' }, { rawId: 'missing' }] },
    { id: 'own', layer: 'protocol', rawRefs: [{ rawId: 'raw-1' }] } ];
  const session = { id: 's', sourceKind: 'codex', rawEvents, logicalEvents };
  const builder = createTurnLineageBuilder(); builder.addSession(session);
  const index = { sourceKind: 'codex', repoRoot: '/repo', sessionsById: new Map([['s', session]]), codexTurnLineage: builder.finish() };
  assert.equal(turnLineageSection(index, 's', 'mixed'), null);
  assert.equal(turnLineageSection(index, 's', 'unknown'), null);
  assert.equal(turnLineageSection(index, 's', 'own').parent.status, 'missing');
  assert.equal(index.codexTurnLineage.targets.parent, undefined);
  assert.equal(extractTurnLineageFact({ type: 'token_usage_record', payload: { turn_id: 'a', root_turn_id: 'fake' } }), null);
  assert.equal(extractTurnLineageFact(start('', 'p', 'r')), null);
  assert.equal(validTurnLineageFact({ ...extractTurnLineageFact(start('a', 'p', 'r')), payload: {} }), false);
  const target = { id: 'target', sourceKind: 'codex', title: 'Target', rawEvents: [
    { ...rawEvents[2], rawId: 'target-raw', turnId: 'parent', parsed: start('parent'), subagentInherited: false },
  ], logicalEvents: [] };
  const withTarget = createTurnLineageBuilder(); withTarget.addSession(session); withTarget.addSession(target);
  const scoped = { ...index, sessionsById: new Map([['s', session], ['target', target]]), codexTurnLineage: withTarget.finish() };
  Object.defineProperty(scoped, 'sessions', { get() { throw new Error('must not scan all Sessions'); } });
  assert.equal(turnLineageSection(scoped, 's', 'own').parent.status, 'no_anchor');
  assert.equal(turnLineageSection({ ...index, sourceKind: 'claude-code' }, 's', 'own'), null);
});

test('steering, compaction and interrupt/recovery preserve independent evidence without last-write wins', async (t) => {
  const options = await fixture(t, { s: [start('r', null, 'r'), message('root'), end('r', 'r'),
    start('c', 'r', 'r'), message('work'), message('steering'),
    { type: 'compacted', payload: { message: 'synthetic compacted context' } },
    { type: 'turn_context', payload: { turn_id: 'c', root_turn_id: 'r', model: 'synthetic' } },
    { type: 'event_msg', payload: { type: 'turn_aborted', root_turn_id: 'r', reason: 'interrupted' } },
    start('c', 'r'), message('recovered'), end('c'),
    start('conflicting', 'r', 'r'), message('conflict'), end('conflicting'),
    start('conflicting', 'another'), message('second record'), end('conflicting'),
    start('interrupt-only'), message('interrupted'),
    { type: 'event_msg', payload: { type: 'turn_aborted', root_turn_id: 'r', reason: 'interrupted' } },
  ] });
  const index = await codex.buildSourceBackedIndex(options);
  const s = await section(index, 's', 'c');
  assert.equal(s.parent.status, 'resolved'); assert.equal(s.root.status, 'resolved');
  assert.equal(s.root.rawRefs.length, 3);
  const conflict = await section(index, 's', 'conflicting');
  assert.equal(conflict.parent.status, 'conflict'); assert.equal(conflict.root.status, 'resolved');
  assert.equal((await section(index, 's', 'interrupt-only')).root.status, 'resolved');
});

test('revert chains admit only selected owned prefixes and preserve physical evidence in plain/Zstd storage', async (t) => {
  const { zstdCompressSync } = require('node:zlib');
  const options = await fixture(t, {});
  const sessionId = 'aaaaaaaa-0162-4162-9162-aaaaaaaaaaaa';
  const headId = 'bbbbbbbb-0162-4162-9162-bbbbbbbbbbbb';
  const alternativeId = 'cccccccc-0162-4162-9162-cccccccccccc';
  const childId = 'dddddddd-0162-4162-9162-dddddddddddd';
  const name = (rollout, owner = sessionId) => `rollout-2026-10-14T10-00-00-${owner}${rollout === owner ? '' : '_' + rollout}.jsonl`;
  const meta = (owner, history_base) => ({ type: 'session_meta', payload: { id: owner, cwd: options.repoRoot,
    history_mode: 'paginated', ...(history_base ? { history_base } : {}) } });
  const encode = (rows, first = 0) => rows.map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ordinal: first + i, ...row })).join('\n') + '\n';
  const prefix = encode([meta(sessionId), start('r', null, 'r'), message('kept'), end('r', 'r')]);
  const historyBase = { thread_id: sessionId, end_ordinal_exclusive: 4, end_byte_offset: Buffer.byteLength(prefix) };
  const artifacts = {
    [name(sessionId)]: prefix + encode([start('removed', 'r', 'wrong'), message('removed-tail')], 4),
    [name(headId)]: encode([meta(sessionId, historyBase), start('c', 'r', 'r'), message('current')], 4),
    [name(alternativeId)]: encode([meta(sessionId, historyBase), start('c', 'wrong', 'wrong'), message('unselected')], 4),
    [name(childId, childId)]: encode([meta(childId, historyBase), start('g', 'c', 'r'), message('child-owned')], 4),
  };
  for (const compressed of [false, true]) {
    for (const [file, content] of Object.entries(artifacts)) {
      await fs.writeFile(path.join(options.codexHome, 'sessions', file + (compressed ? '.zst' : '')), compressed ? zstdCompressSync(Buffer.from(content)) : content);
      if (compressed) await fs.unlink(path.join(options.codexHome, 'sessions', file));
    }
    const buildOptions = { ...options, currentRolloutPathsForTests: new Map([[sessionId,
      path.join(options.codexHome, 'sessions', name(headId) + (compressed ? '.zst' : ''))]]) };
    for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
      const index = await build(buildOptions);
      assert.equal(index.sessions.length, 2, JSON.stringify(index.sourceDiagnostics));
      assert.deepEqual(index.codexTurnLineage.targets.r, [sessionId]);
      assert.equal(index.codexTurnLineage.targets.removed, undefined);
      const current = await section(index, sessionId, 'c');
      assert.equal(current.parent.status, 'resolved'); assert.equal(current.root.status, 'resolved');
      assert.ok(current.parent.rawRefs.every((ref) => ref.file.includes(headId)));
      const child = await section(index, childId, 'g');
      assert.equal(child.parent.target.sessionId, sessionId);
      assert.equal(child.root.target.sessionId, sessionId);
      const session = index.sessionsById.get(sessionId).materializationDescriptor
        ? await materializeSessionForIndex(index, index.sessionsById.get(sessionId)) : index.sessionsById.get(sessionId);
      for (const q of ['removed-tail', 'unselected']) assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q }).searchEventCount, 0);
      const before = JSON.stringify(session.counts);
      await section(index, sessionId, 'c'); assert.equal(JSON.stringify(session.counts), before);
      const ancestorFile = path.join(options.codexHome, 'sessions', name(sessionId) + (compressed ? '.zst' : ''));
      const rewriteAncestor = async (content) => {
        const handle = await fs.open(ancestorFile, 'r+');
        try {
          const bytes = compressed ? zstdCompressSync(Buffer.from(content)) : Buffer.from(content);
          await handle.write(bytes, 0, bytes.length, 0);
          await handle.truncate(bytes.length);
        } finally { await handle.close(); }
      };
      await codex.verifyCodexTurnLineageSnapshot(index, session, current.parent.rawRefs);
      if (!compressed) {
        await rewriteAncestor(artifacts[name(sessionId)].replace('removed-tail', 'ignored-tail'));
        await codex.verifyCodexTurnLineageSnapshot(index, session, current.parent.rawRefs);
      }
      await rewriteAncestor(artifacts[name(sessionId)].replace('"turn_id":"r"', '"turn_id":"x"'));
      await assert.rejects(codex.verifyCodexTurnLineageSnapshot(index, session, current.parent.rawRefs), { code: 'INDEXED_SOURCE_STALE' });
      await rewriteAncestor(artifacts[name(sessionId)]);
      if (compressed && build === codex.buildSourceBackedIndex) {
        await codex.verifyCodexTurnLineageSnapshot(index, session, current.parent.rawRefs);
        await fs.unlink(path.join(options.codexHome, 'sessions', name(sessionId) + '.zst'));
        await assert.rejects(codex.verifyCodexTurnLineageSnapshot(index, session, current.parent.rawRefs), { code: 'INDEXED_SOURCE_STALE' });
      }
    }
  }
});
