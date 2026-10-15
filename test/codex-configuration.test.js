'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { createConfigurationBuilder, extractConfigurationFact, validConfigurationFact,
  recordedConfigurationSection, configurationEvidenceReferences } = require('../src/codex-configuration');

const event = (type, fields = {}) => ({ type: 'event_msg', payload: { type, ...fields } });
const context = (turn_id, fields = {}) => ({ type: 'turn_context', payload: { turn_id, model: 'model-a', effort: 'low', ...fields } });
const update = (effort, marker = true) => ({ type: 'response_item', payload: { type: 'configuration_update', reasoning: { effort } }, metadata: { harness_authored_configuration: marker } });
const settings = (fields = {}, thread_id = 'session') => event('thread_settings_applied', { thread_id, thread_settings: { model: 'thread-model', reasoning_effort: 'medium', ...fields } });
const message = (message) => event('user_message', { message });

function synthetic(rows, groups = []) {
  const rawEvents = rows.map((parsed, position) => ({ rawId: `raw-${position}`, sessionId: 'session', sourceKind: 'codex',
    recordType: parsed.type, payloadType: parsed.payload.type || '', turnId: parsed.payload.turn_id || '',
    messageText: parsed.payload.message || '', parsed, configurationFact: extractConfigurationFact(parsed),
    source: { file: 'rollout.jsonl', line: position + 1 } }));
  const logicalEvents = rawEvents.map(raw => ({ id: raw.rawId, layer: 'protocol', rawRefs: [{ rawId: raw.rawId }] }));
  for (const [id, refs] of groups) logicalEvents.push({ id, layer: 'main', rawRefs: refs.map(i => ({ rawId: `raw-${i}` })) });
  const session = { id: 'session', rawEvents, logicalEvents };
  const build = () => { const builder = createConfigurationBuilder(); builder.addSession(session); return { sourceKind: 'codex', codexConfiguration: builder.finish() }; };
  return { session, build, get: id => recordedConfigurationSection(build(), 'session', id) };
}

test('recorded contexts, defaults and trusted instructions remain separate ordered evidence tracks', () => {
  const fixture = synthetic([settings(), event('task_started', { turn_id: 't' }), context('t'), message('before'),
    update('high'), message('after'), context('t'), message('repeat'), event('task_complete', { turn_id: 't' })],
  [['group', [3, 5, 7]], ['partial', [3, 99]]]);
  assert.equal(fixture.get('raw-1').observations.length, 1, 'thread defaults do not create a turn snapshot');
  const before = fixture.get('raw-3');
  assert.deepEqual(before.observations.map(x => x.kind), ['thread_settings', 'turn_context']);
  assert.equal(before.status, 'recorded');
  assert.equal(before.observations[1].endReason, 'next_snapshot');
  const after = fixture.get('raw-7');
  assert.deepEqual(after.observations.map(x => x.kind), ['thread_settings', 'effort_update', 'turn_context']);
  assert.equal(after.observations.find(x => x.kind === 'effort_update').effort.value, 'high');
  assert.equal(after.observations.find(x => x.kind === 'turn_context').effort.value, 'low');
  assert.equal(after.status, 'recorded');
  assert.equal(fixture.get('group').status, 'mixed');
  assert.equal(fixture.get('group').observations.filter(x => x.kind === 'turn_context').length, 2);
  assert.equal(fixture.get('partial').status, 'mixed');
});

test('field states, strict outer trust and closed bounded facts do not invent defaults', () => {
  for (const [value, state] of [[undefined, 'missing'], [null, 'null'], [42, 'invalid'], ['custom', 'value'], ['x'.repeat(513), 'invalid']]) {
    const row = context('t', { effort: value });
    if (value === undefined) delete row.payload.effort;
    const fact = extractConfigurationFact(row);
    assert.equal(fact.effort.state, state);
    assert.ok(validConfigurationFact(fact));
    assert.equal(validConfigurationFact({ ...fact, payload: {} }), false);
  }
  for (const marker of [false, 'true', null]) assert.equal(extractConfigurationFact(update('high', marker)), null);
  const spoof = update('high'); delete spoof.metadata; spoof.payload.metadata = { harness_authored_configuration: true };
  assert.equal(extractConfigurationFact(spoof), null);
  const nested = extractConfigurationFact(context('t', { collaboration_mode: { settings: { model: 'other', reasoning_effort: null } } }));
  assert.deepEqual(nested.collaboration, { model: { state: 'value', value: 'other' }, effort: { state: 'null' } });
});

test('compaction, lifecycle restarts and ownership gaps close evidence without snapshot-end completion', () => {
  const f = synthetic([event('task_started', { turn_id: 't' }), context('t'), update('high'),
    event('error', { message: 'compaction failed' }), message('still active'),
    event('context_compacted'), message('no carry'), context('t'), update('xhigh'),
    event('turn_aborted', { turn_id: 't' }), event('task_started', { turn_id: 't' }), message('resumed'),
    context('t', { effort: null }), update('custom'), message('tail')]);
  assert.equal(f.get('raw-4').observations.find(x => x.kind === 'effort_update').endReason, 'compaction');
  assert.equal(f.get('raw-6'), null);
  assert.equal(f.get('raw-11'), null);
  assert.equal(f.get('raw-8').observations.find(x => x.kind === 'effort_update').endReason, 'turn_boundary');
  assert.equal(f.get('raw-14').observations.every(x => x.endReason === 'snapshot_end' && !x.end), true);
  const gap = synthetic([event('task_started', { turn_id: 't' }), context('t'), context('other'), update('high')]);
  assert.equal(gap.get('raw-1').observations[0].endReason, 'ownership_gap');
  assert.equal(gap.get('raw-3'), null);
});

test('unowned, inherited, duplicate and missing identity records cannot seed guessed configuration', () => {
  const f = synthetic([settings({}, 'wrong'), context(undefined), update('high'), event('task_started', { turn_id: 't' }), context('t'), message('own')]);
  assert.equal(f.get('raw-0'), null); assert.equal(f.get('raw-1'), null); assert.equal(f.get('raw-2'), null);
  f.session.rawEvents[4].subagentInherited = true;
  assert.equal(f.get('raw-5'), null);
  const interrupted = synthetic([event('task_started', { turn_id: 't' }), context('t'), message('inherited'), update('high')]);
  interrupted.session.rawEvents[2].subagentInherited = true;
  assert.equal(interrupted.get('raw-3'), null, 'inherited discontinuity cannot reopen a prior owner');
  const duplicate = synthetic([event('task_started', { turn_id: 't' }), context('t'), context('t', { model: 'conflicting' }), message('after')]);
  duplicate.session.rawEvents[2].source.line = duplicate.session.rawEvents[1].source.line;
  assert.equal(duplicate.get('raw-3'), null, 'duplicate physical evidence does not choose a winner');
});

test('grouped details retain multiple observations with an explicit bound and no arbitrary payloads', () => {
  const rows = [event('task_started', { turn_id: 't' })];
  for (let i = 0; i < 12; i++) rows.push(context('t', { model: `model-${i}`, secret: 'must-not-retain' }));
  const f = synthetic(rows, [['group', Array.from({ length: 12 }, (_, i) => i + 1)]]);
  const section = f.get('group');
  assert.equal(section.observations.length, 8);
  assert.equal(section.truncated, true);
  assert.equal(section.status, 'mixed');
  assert.doesNotMatch(JSON.stringify(f.build().codexConfiguration), /must-not-retain|"parsed"|"payload"/);
});

async function fixture(t, rows, compressed = false) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'recorded-configuration-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fs.mkdir(repoRoot); await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', `rollout-session.jsonl${compressed ? '.zst' : ''}`);
  const text = [{ type: 'session_meta', payload: { id: 'session', cwd: repoRoot, cli_version: '0.162.1' } }, ...rows]
    .map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ...row })).join('\n') + '\n';
  await fs.writeFile(file, compressed ? require('node:zlib').zstdCompressSync(Buffer.from(text)) : text);
  return { codexHome: home, repoRoot };
}

test('configuration is equivalent across resident, compact, source-backed, cold/warm and Zstd paths', async t => {
  for (const compressed of [false, true]) {
    const options = await fixture(t, [settings(), event('task_started', { turn_id: 't' }), context('t'),
      message('before'), update('high'), message('after'), context('t', { effort: null }), message('last')], compressed);
    let baseline;
    for (const build of [codex.__testOnly.buildUncompactedIndexForDetailTests, codex.buildIndex, codex.buildSourceBackedIndex]) {
      const index = await build(options);
      let session = index.sessionsById.get('session');
      if (session.materializationDescriptor) session = await materializeSessionForIndex(index, session);
      const detailEvent = session.logicalEvents.find(e => e.layer === 'main' && e.rawRefs.some(ref => ref.line === 7));
      assert.ok(detailEvent);
      const result = recordedConfigurationSection(index, session.id, detailEvent.id);
      assert.ok(result);
      assert.ok(Object.isFrozen(index.codexConfiguration));
      if (baseline) assert.deepEqual(result, baseline); else baseline = result;
      const warm = await build({ ...options, previousIndex: index });
      assert.deepEqual(recordedConfigurationSection(warm, session.id, detailEvent.id), result);
      assert.equal(warm.totals.eventCount, index.totals.eventCount);
      const old = { ...index }; delete old.codexConfiguration;
      const refreshed = await build({ ...options, previousIndex: old });
      assert.deepEqual(recordedConfigurationSection(refreshed, session.id, detailEvent.id), result);
    }
  }
});

test('relevant evidence verification detects trust, context and lifecycle rewrites without full-prefix hydration', async t => {
  for (const [before, after] of [
    ['"harness_authored_configuration":false', '"harness_authored_configuration":true '],
    ['"model":"model-a"', '"model":"model-b"'],
    ['"type":"task_started","turn_id":"t"', '"type":"task_started","turn_id":"x"'],
  ]) {
    const options = await fixture(t, [event('task_started', { turn_id: 't' }), context('t'), update('high', false),
      message('anchor'), event('agent_message', { message: 'unrelated'.repeat(20000) })]);
    const index = await codex.buildSourceBackedIndex(options);
    const session = await materializeSessionForIndex(index, index.sessionsById.get('session'));
    const anchor = session.logicalEvents.find(e => e.layer === 'main' && e.rawRefs.some(ref => ref.line === 5));
    const refs = configurationEvidenceReferences(index, session.id, anchor.id);
    assert.ok(refs.some(ref => ref.line === 4), 'untrusted candidate remains private verification evidence');
    const lines = [];
    await codex.verifyCodexConfigurationEvidence(index, session, refs, { onSourceLine: (_file, line) => lines.push(line) });
    assert.equal(Math.max(...lines), 4, 'normal verification stops at the last requested evidence');
    const file = path.join(options.codexHome, 'sessions', 'rollout-session.jsonl');
    const original = await fs.readFile(file, 'utf8');
    const changed = original.replace(before, after);
    assert.notEqual(changed, original); assert.equal(Buffer.byteLength(changed), Buffer.byteLength(original));
    await fs.writeFile(file, changed);
    await assert.rejects(codex.verifyCodexConfigurationEvidence(index, session, refs), { code: 'INDEXED_SOURCE_STALE' });
  }
});

test('warm append extends observations while accepted-source append and deletion retain snapshot semantics', async t => {
  const options = await fixture(t, [event('task_started', { turn_id: 't' }), context('t'), message('anchor')]);
  const file = path.join(options.codexHome, 'sessions', 'rollout-session.jsonl');
  const index = await codex.buildSourceBackedIndex(options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get('session'));
  const anchor = session.logicalEvents.find(e => e.layer === 'main');
  const refs = configurationEvidenceReferences(index, session.id, anchor.id);
  assert.equal(recordedConfigurationSection(index, session.id, anchor.id).observations[0].endReason, 'snapshot_end');
  await fs.appendFile(file, JSON.stringify(context('t', { model: 'model-b' })) + '\n');
  await codex.verifyCodexConfigurationEvidence(index, session, refs);
  const warm = await codex.buildSourceBackedIndex({ ...options, previousIndex: index });
  assert.equal(recordedConfigurationSection(warm, session.id, anchor.id).observations[0].endReason, 'next_snapshot');
  assert.equal(recordedConfigurationSection(index, session.id, anchor.id).observations[0].endReason, 'snapshot_end');
  await fs.unlink(file);
  await assert.rejects(codex.verifyCodexConfigurationEvidence(index, session, refs), { code: 'INDEXED_SOURCE_STALE' });
});

test('selected revert history excludes removed, alternate and inherited settings in plain and Zstd paths', async t => {
  const options = await fixture(t, []);
  await fs.unlink(path.join(options.codexHome, 'sessions', 'rollout-session.jsonl'));
  const owner = 'aaaaaaaa-0162-4162-9162-aaaaaaaaaaaa';
  const head = 'bbbbbbbb-0162-4162-9162-bbbbbbbbbbbb';
  const alternate = 'cccccccc-0162-4162-9162-cccccccccccc';
  const child = 'dddddddd-0162-4162-9162-dddddddddddd';
  const name = (rollout, session = owner) => `rollout-2026-10-14T10-00-00-${session}${rollout === session ? '' : '_' + rollout}.jsonl`;
  const meta = (id, history_base) => ({ type: 'session_meta', payload: { id, cwd: options.repoRoot, history_mode: 'paginated', ...(history_base ? { history_base } : {}) } });
  const encode = (rows, first = 0) => rows.map((row, i) => JSON.stringify({ timestamp: new Date(1790000000000 + i * 1000).toISOString(), ordinal: first + i, ...row })).join('\n') + '\n';
  const prefix = encode([meta(owner), event('task_started', { turn_id: 't' }), context('t'), message('kept')]);
  const base = { thread_id: owner, end_ordinal_exclusive: 4, end_byte_offset: Buffer.byteLength(prefix) };
  const artifacts = {
    [name(owner)]: prefix + encode([context('t', { model: 'removed' }), message('removed-tail')], 4),
    [name(head)]: encode([meta(owner, base), context('t', { model: 'selected' }), message('current')], 4),
    [name(alternate)]: encode([meta(owner, base), context('t', { model: 'alternate' }), message('alternate-tail')], 4),
    [name(child, child)]: encode([meta(child, base), event('task_started', { turn_id: 'child' }), message('no inherited settings'), context('child', { model: 'child-owned' }), message('child-current')], 4),
  };
  for (const compressed of [false, true]) {
    for (const [file, contents] of Object.entries(artifacts)) {
      await fs.writeFile(path.join(options.codexHome, 'sessions', file + (compressed ? '.zst' : '')),
        compressed ? require('node:zlib').zstdCompressSync(Buffer.from(contents)) : contents);
      if (compressed) await fs.unlink(path.join(options.codexHome, 'sessions', file));
    }
    for (const build of [codex.buildIndex, codex.buildSourceBackedIndex]) {
      const index = await build({ ...options, currentRolloutPathsForTests: new Map([[owner,
        path.join(options.codexHome, 'sessions', name(head) + (compressed ? '.zst' : ''))]]) });
      assert.equal(index.sessions.length, 2, JSON.stringify(index.sourceDiagnostics));
      const facts = index.codexConfiguration.sessions[owner];
      assert.deepEqual(facts.observations.map(item => item.model.value), ['model-a', 'selected']);
      assert.equal(facts.observations[0].endReason, 'next_snapshot');
      assert.ok(facts.observations[1].rawRefs.every(ref => ref.file.includes(head)));
      assert.deepEqual(index.codexConfiguration.sessions[child].observations.map(item => item.model.value), ['child-owned']);
      const session = index.sessionsById.get(owner).materializationDescriptor
        ? await materializeSessionForIndex(index, index.sessionsById.get(owner)) : index.sessionsById.get(owner);
      const kept = session.logicalEvents.find(e => e.layer === 'main' && e.rawRefs.some(ref => ref.file.includes(owner) && ref.line === 4));
      const references = configurationEvidenceReferences(index, owner, kept.id);
      assert.ok(references.some(ref => ref.file.includes(head)), 'span endpoint retains the physical replacement evidence');
      await codex.verifyCodexConfigurationEvidence(index, session, references);
      for (const q of ['removed-tail', 'alternate-tail']) assert.equal(codex.query.getTimeline(index, session, { layer: 'main', q }).searchEventCount, 0);
    }
  }
});

test('completed typed compaction closes tracks while unconfirmed or failed work does not', () => {
  const f = synthetic([event('task_started', { turn_id: 't' }), context('t'), update('high'),
    event('item_completed', { turn_id: 't', thread_id: 'foreign', item: { id: 'compaction', type: 'ContextCompaction' } }),
    message('still'), event('item_completed', { turn_id: 't', thread_id: 'session', item: { id: 'compaction', type: 'ContextCompaction' } }), message('after')]);
  assert.equal(f.get('raw-4').observations.length, 2);
  assert.equal(f.get('raw-4').observations[0].endReason, 'compaction');
  assert.equal(f.get('raw-6'), null);
});

test('verification retains only checked IDs and never parses large configuration candidate payloads', async t => {
  const marker = 'verification-payload-sentinel';
  const output = marker + 'x'.repeat(128 * 1024);
  for (const compressed of [false, true]) {
    const items = Array.from({ length: 12 }, (_, i) => event('item_completed', {
      thread_id: 'session', turn_id: 't', item: { type: 'CommandExecution', id: `command-${i}`,
        command: ['echo', 'synthetic'], status: 'completed', aggregated_output: output },
    }));
    const options = await fixture(t, [event('task_started', { turn_id: 't' }), context('t'), ...items, message('anchor')], compressed);
    const index = await codex.buildSourceBackedIndex(options);
    const session = await materializeSessionForIndex(index, index.sessionsById.get('session'));
    const anchor = session.logicalEvents.find(e => e.layer === 'main' && e.rawRefs.some(ref => ref.line === 16));
    const refs = configurationEvidenceReferences(index, session.id, anchor.id);
    assert.equal(refs.filter(ref => ref.sourceEventType === 'item_completed').length, items.length);
    const ids = new Set(refs.map(ref => ref.rawId));
    const raws = session.rawEvents.filter(raw => ids.has(raw.rawId));
    const originalParse = JSON.parse;
    let payloadParses = 0;
    const spy = t.mock.method(JSON, 'parse', function (text, ...args) {
      if (typeof text === 'string' && text.includes(marker)) payloadParses++;
      return originalParse.call(this, text, ...args);
    });
    try {
      const verified = await codex.readIndexedCodexSourceRows(index, session, raws, { verifyOnly: true });
      assert.ok(verified instanceof Set);
      assert.deepEqual(verified, ids, 'only checked identity strings survive the scan');
      await codex.verifyCodexConfigurationEvidence(index, session, refs);
      await codex.verifyCodexTurnLineageSnapshot(index, session, refs);
      assert.equal(payloadParses, 0, 'verification must not parse large source bodies');
      const hydrated = await codex.readIndexedCodexSourceRows(index, session, raws);
      assert.ok(hydrated instanceof Map);
      assert.equal(payloadParses, items.length, 'normal hydration retains its parsed row contract');
      assert.ok([...hydrated.values()].some(row => row.parsed?.payload?.item?.aggregated_output === output));
    } finally { spy.mock.restore(); }
    const stale = raws.map((raw, i) => i === raws.length - 1 ? { ...raw, sourceLineDigest: 'wrong-digest' } : raw);
    await assert.rejects(codex.readIndexedCodexSourceRows(index, session, stale, { verifyOnly: true }), { code: 'INDEXED_SOURCE_STALE' });
  }
});

test('non-lifecycle explicit turn ownership participates in cached configuration verification', async t => {
  const assistant = { type: 'response_item', payload: { type: 'message', turn_id: 't', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] } };
  const options = await fixture(t, [event('task_started', { turn_id: 't' }), context('t'), assistant, message('anchor')]);
  const index = await codex.buildSourceBackedIndex(options);
  const session = await materializeSessionForIndex(index, index.sessionsById.get('session'));
  const anchor = session.logicalEvents.find(e => e.layer === 'main' && e.rawRefs.some(ref => ref.line === 5));
  const refs = configurationEvidenceReferences(index, session.id, anchor.id);
  assert.ok(refs.some(ref => ref.line === 4 && ref.sourceEventType === 'message'));
  await codex.verifyCodexConfigurationEvidence(index, session, refs);
  const file = path.join(options.codexHome, 'sessions', 'rollout-session.jsonl');
  const original = await fs.readFile(file, 'utf8');
  const changed = original.replace('"type":"message","turn_id":"t"', '"type":"message","turn_id":"x"');
  assert.notEqual(changed, original); assert.equal(Buffer.byteLength(changed), Buffer.byteLength(original));
  await fs.writeFile(file, changed);
  await assert.rejects(codex.verifyCodexConfigurationEvidence(index, session, refs), { code: 'INDEXED_SOURCE_STALE' });
  const rebuilt = await codex.buildSourceBackedIndex(options);
  assert.equal(recordedConfigurationSection(rebuilt, session.id, anchor.id), null, 'changed ownership really invalidates the former span');
});
