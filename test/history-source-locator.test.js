'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildSourceBackedIndex } = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { createHistorySourceLocator } = require('../src/history-source-locator');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'source-locator-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'project');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const file = path.join(home, 'sessions', '2026', '01', `rollout-${id}.jsonl`);
  const rows = [
    { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id, cwd: repoRoot } },
    { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'user_message', message: 'hello' } },
    { type: 'response_item', timestamp: '2026-01-01T00:00:02Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'world' }] } },
  ];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${rows.map(JSON.stringify).join('\n')}\n\n`, 'utf8');
  const build = () => buildSourceBackedIndex({ repoRoot, codexHome: home });
  const index = await build();
  assert.equal(index.sessions.length, 1);
  const session = index.sessions[0];
  const sourcePath = session.sourceFile;
  const locator = createHistorySourceLocator({ index, scope: `${repoRoot}:codex:${home}`,
    materialize: (owner) => materializeSessionForIndex(index, owner),
    makeEvidenceRef: (owner, layer, event) => `${owner.id}:${layer}:${event.id || event.rawId}` });
  return { home, repoRoot, file, rows, index, session, sourcePath, locator, build };
}

test('bootstrap resolves exact admitted JSONL line and returns explicit raw/logical links', async (t) => {
  const f = await fixture(t);
  const result = await f.locator.resolveLocator({ sourcePath: f.sourcePath, locator: { type: 'jsonl-line', line: 2 } });
  const absolute = await f.locator.resolveLocator({ sourcePath: f.file, locator: { type: 'jsonl-line', line: 2 } });
  assert.equal(absolute.sourcePath, f.sourcePath);
  assert.equal(absolute.sourceRef, result.sourceRef);
  assert.deepEqual(absolute.matches, result.matches);
  assert.equal(result.verification, 'unverified_legacy_locator');
  assert.equal(result.warnings.length, 1);
  assert.match(result.sourceRef, /^sr1\./u);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].sessionId, f.session.id);
  assert.match(result.matches[0].rawRef, /:raw:/u);
  assert.ok(result.matches[0].logicalRefs.some((link) => link.layer === 'main'));
  const fresh = await f.locator.resolveLocator({ sourceRef: result.sourceRef, locator: { type: 'jsonl-line', line: 2 } });
  assert.equal(fresh.verification, 'source_snapshot_verified');
  assert.deepEqual(fresh.matches, result.matches);
  assert.deepEqual(fresh.warnings, []);
});

test('source references persist across indexing and reject scope or source changes', async (t) => {
  const f = await fixture(t);
  const first = await f.locator.resolveLocator({ sourcePath: f.sourcePath, locator: { type: 'jsonl-line', line: 1 } });
  const rebuilt = await f.build();
  const restarted = createHistorySourceLocator({ index: rebuilt, scope: `${f.repoRoot}:codex:${f.home}`,
    materialize: (owner) => materializeSessionForIndex(rebuilt, owner),
    makeEvidenceRef: (owner, layer, event) => `${owner.id}:${layer}:${event.id || event.rawId}` });
  const same = await restarted.resolveLocator({ sourceRef: first.sourceRef, locator: { type: 'jsonl-line', line: 1 } });
  assert.equal(same.sourceRef, first.sourceRef);
  const wrongScope = createHistorySourceLocator({ index: rebuilt, scope: 'different-project',
    materialize: (owner) => materializeSessionForIndex(rebuilt, owner),
    makeEvidenceRef: () => 'ref' });
  await assert.rejects(wrongScope.resolveLocator({ sourceRef: first.sourceRef, locator: { type: 'jsonl-line', line: 1 } }),
    { code: 'REFERENCE_SCOPE_MISMATCH' });
  await fs.writeFile(f.file, `${f.rows.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const changed = await f.build();
  const changedLocator = createHistorySourceLocator({ index: changed, scope: `${f.repoRoot}:codex:${f.home}`,
    materialize: (owner) => materializeSessionForIndex(changed, owner), makeEvidenceRef: () => 'ref' });
  await assert.rejects(changedLocator.resolveLocator({ sourceRef: first.sourceRef, locator: { type: 'jsonl-line', line: 1 } }),
    { code: 'STALE_REFERENCE' });
});

test('paths and malformed or missing lines are bounded by index metadata', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.locator.resolveLocator({ sourcePath: path.join(f.home, 'outside.jsonl'),
    locator: { type: 'jsonl-line', line: 1 } }), { code: 'UNKNOWN_SOURCE' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: path.join(f.home, 'other', path.basename(f.file)),
    locator: { type: 'jsonl-line', line: 1 } }), { code: 'UNKNOWN_SOURCE' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-line', line: 999 } }), { code: 'INVALID_LOCATOR' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-line', line: 0 } }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-line', line: '2' } }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-byte', line: 2 } }), { code: 'UNSUPPORTED_LOCATOR' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-line', line: 2, offset: 1 } }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.locator.resolveLocator({ sourcePath: f.sourcePath, locator: '2' }),
    { code: 'INVALID_ARGUMENT' });
});

test('logical links are explicit and can have zero or multiple owners', async (t) => {
  const f = await fixture(t);
  const base = await materializeSessionForIndex(f.index, f.session);
  const raw = base.rawEvents.find((candidate) => candidate.sourceLocator?.line === 2);
  const create = (logicalEvents) => createHistorySourceLocator({ index: f.index,
    scope: 'association-test', materialize: async () => ({ ...base, logicalEvents }),
    makeEvidenceRef: (_owner, layer, event) => `${layer}:${event.id || event.rawId}` });
  const input = { sourcePath: f.sourcePath, locator: { type: 'jsonl-line', line: 2 } };
  const empty = await create([]).resolveLocator(input);
  assert.equal(empty.matches[0].rawId, raw.rawId);
  assert.deepEqual(empty.matches[0].logicalRefs, []);
  const event = base.logicalEvents.find((candidate) => candidate.rawRefs?.some((ref) => ref.rawId === raw.rawId));
  const multiple = await create([event, { ...event, id: `${event.id}:second` }]).resolveLocator(input);
  assert.equal(multiple.matches[0].logicalRefs.length, 2);
});

test('physical blank line between indexed raws has zero matches', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file, `${f.rows.slice(0, 2).map(JSON.stringify).join('\n')}\n\n${JSON.stringify(f.rows[2])}\n`, 'utf8');
  const index = await f.build();
  const session = index.sessions[0];
  const locator = createHistorySourceLocator({ index, scope: 'blank-line-test',
    materialize: (owner) => materializeSessionForIndex(index, owner),
    makeEvidenceRef: (owner, layer, event) => `${owner.id}:${layer}:${event.id || event.rawId}` });
  const blank = await locator.resolveLocator({ sourcePath: session.sourceFile,
    locator: { type: 'jsonl-line', line: 3 } });
  assert.deepEqual(blank.matches, []);
  const following = await locator.resolveLocator({ sourceRef: blank.sourceRef,
    locator: { type: 'jsonl-line', line: 4 } });
  assert.equal(following.matches.length, 1);
});

test('append preserves accepted source reference but does not admit new lines until reindex', async (t) => {
  const f = await fixture(t);
  const first = await f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-line', line: 2 } });
  await fs.appendFile(f.file, `${JSON.stringify(f.rows[2])}\n`, 'utf8');
  const oldLine = await f.locator.resolveLocator({ sourceRef: first.sourceRef,
    locator: { type: 'jsonl-line', line: 2 } });
  assert.equal(oldLine.sourceRef, first.sourceRef);
  await assert.rejects(f.locator.resolveLocator({ sourceRef: first.sourceRef,
    locator: { type: 'jsonl-line', line: 5 } }), { code: 'INVALID_LOCATOR' });
  const updated = await f.build();
  const locator = createHistorySourceLocator({ index: updated, scope: `${f.repoRoot}:codex:${f.home}`,
    materialize: (owner) => materializeSessionForIndex(updated, owner), makeEvidenceRef: () => 'ref' });
  await assert.rejects(locator.resolveLocator({ sourceRef: first.sourceRef,
    locator: { type: 'jsonl-line', line: 2 } }), { code: 'STALE_REFERENCE' });
});

test('in-place change invalidates the original index before returning links', async (t) => {
  const f = await fixture(t);
  const first = await f.locator.resolveLocator({ sourcePath: f.sourcePath,
    locator: { type: 'jsonl-line', line: 2 } });
  const changed = structuredClone(f.rows);
  changed[1].payload.message = 'HELLO';
  await fs.writeFile(f.file, `${changed.map(JSON.stringify).join('\n')}\n\n`, 'utf8');
  await assert.rejects(f.locator.resolveLocator({ sourceRef: first.sourceRef,
    locator: { type: 'jsonl-line', line: 2 } }), { code: 'STALE_REFERENCE' });
});

test('indexed non-Codex and compressed paths are explicit unsupported sources', async () => {
  const sessionsRoot = path.join(os.tmpdir(), 'unsupported-source-root');
  const index = { sessions: [
    { sourceKind: 'claude-code', sourceFile: 'claude.jsonl' },
    { sourceKind: 'codex', sourceFile: 'codex.jsonl.zst' },
  ], sessionsRoot, materializationDependencies: new Map() };
  const locator = createHistorySourceLocator({ index, scope: 'unsupported-test',
    materialize: async () => { throw new Error('must not materialize'); }, makeEvidenceRef: () => 'ref' });
  for (const sourcePath of ['claude.jsonl', 'codex.jsonl.zst',
    path.join(sessionsRoot, 'codex.jsonl.zst')]) {
    await assert.rejects(locator.resolveLocator({ sourcePath,
      locator: { type: 'jsonl-line', line: 1 } }), { code: 'UNSUPPORTED_SOURCE' });
  }
});
