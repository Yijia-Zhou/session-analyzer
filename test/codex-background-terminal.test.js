'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const { backgroundTerminalRequest, backgroundTerminalCall } = require('../src/codex-background-terminal');
const { backgroundTerminalLabel } = require('../src/shared/background-terminal-presentation');
const { buildTrajectoryPresentation } = require('../src/browser/trajectory-presentation');
const { getSourceAdapter, materializeSessionForIndex } = require('../src/source-adapters');
const { validateCanonicalMaterializedSessionShape } = require('../src/canonical-contract');
const { displayStateFromRules, normalizeRules } = require('../src/shared/folding');

const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');

test('native continuation survives hydration, pagination and search without transferring ownership', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-continuation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const source = await fs.readFile(path.join(__dirname, 'fixtures/background-terminal/continuation.jsonl'), 'utf8');
  const rows = source.trim().split('\n').map(JSON.parse);
  rows[0].payload.cwd = repoRoot;
  const id = rows[0].payload.id;
  const dir = path.join(root, 'sessions', '2026', '09', '11');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-${id}.jsonl`);
  await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const options = { repoRoot, sourceHome: root };
  const index = await getSourceAdapter('codex').buildIndex(options);
  const indexed = index.sessionsById.get(id);
  const session = await materializeSessionForIndex(index, indexed);
  const eventsBefore = JSON.stringify(session.logicalEvents);
  const eventFor = (call) => session.logicalEvents.find((event) => event.id.endsWith(`:${call}`));
  const e = eventFor('e1'); const w = eventFor('w1');
  assert.equal(e.kind, 'other_tool_call');
  assert.equal(session.presentationIndexes.backgroundTerminalContinuations.get(w.id).originEventId, e.id);
  assert.equal(session.rawEvents.some((raw) => Object.hasOwn(raw, 'parsed')), false);
  const page = codex.getTimeline(index, session, { layer: 'main', offset: 1, limit: 1, q: 'npm test' });
  assert.equal(page.events[0].id, w.id);
  assert.equal(page.events[0].hasSearchHit, false);
  assert.equal(page.searchEventCount, 1); // Only the originating exec owns the command text.
  assert.equal(page.events[0].presentationFacts.backgroundTerminal.commandPreview, 'npm test');
  assert.equal(backgroundTerminalLabel(page.events[0].presentationFacts.backgroundTerminal, 'en'), 'Background terminal poll request · npm test');
  const detail = await codex.buildHydratedEventDetail(index, session, w.id, 'main', { locale: 'zh-CN' });
  assert.doesNotThrow(() => validateStructuredLogicalDetailDto(detail));
  assert.equal(detail.title, '后台终端轮询请求 · npm test');
  assert.deepEqual(detail.rawRefs, w.rawRefs);
  const originSection = detail.inspectorSections.find((section) => section.type === 'event_refs');
  assert.deepEqual(originSection.items.map((item) => item.id), [e.id]);
  const exitDetail = await codex.buildHydratedEventDetail(index, session, eventFor('w2').id, 'main');
  assert.equal(exitDetail.title, 'Background terminal input request · npm test');
  assert.deepEqual(exitDetail.rawRefs, eventFor('w2').rawRefs);
  assert.equal(JSON.stringify(session.logicalEvents), eventsBefore);
  const { _shell, ...canonicalSession } = session;
  const links = session.presentationIndexes.backgroundTerminalContinuations;
  links.set(w.id, { originEventId: 'foreign' });
  assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  links.set(w.id, { originEventId: e.id });
  const origin = session.presentationIndexes.backgroundTerminalOrigins.get(e.id);
  origin.chars = 'secret';
  assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  delete origin.chars;
  assert.doesNotThrow(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'));

  await t.test('contract rejects orphan origins and dangling continuations in both directions', () => {
    const origins = session.presentationIndexes.backgroundTerminalOrigins;
    const savedLinks = [...links];
    links.clear();
    assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), {
      code: 'MATERIALIZATION_CONTRACT_VIOLATION',
      message: /must be referenced by a terminal continuation/,
    });
    origins.clear();
    assert.doesNotThrow(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'));
    for (const [id, relation] of savedLinks) links.set(id, relation);
    assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), {
      code: 'MATERIALIZATION_CONTRACT_VIOLATION',
      message: /must reference an owned matching terminal origin/,
    });
    origins.set(e.id, origin);
    assert.doesNotThrow(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'));
    links.delete(w.id);
    assert.doesNotThrow(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'));
    links.set(w.id, savedLinks.find(([id]) => id === w.id)[1]);
    const requests = session.presentationIndexes.backgroundTerminalRequests;
    const savedRequest = requests.get(w.id);
    for (const invalid of [null, undefined]) {
      requests.set(w.id, invalid);
      assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), {
        code: 'MATERIALIZATION_CONTRACT_VIOLATION',
      });
    }
    requests.set(w.id, savedRequest);
  });

  for (const badLine of ['{broken', '', 'null']) {
    await fs.writeFile(file, rows.slice(0, 3).map(JSON.stringify).join('\n') + '\n' + badLine + '\n' + rows.slice(3).map(JSON.stringify).join('\n') + '\n');
    const changedIndex = await getSourceAdapter('codex').buildIndex(options);
    const changed = await materializeSessionForIndex(changedIndex, changedIndex.sessionsById.get(id));
    assert.equal(changed.presentationIndexes.backgroundTerminalContinuations.size, 0, `gap ${badLine}`);
    assert.ok(changed.presentationIndexes.backgroundTerminalRequests.size > 0);
  }
});

test('terminal request semantics preserve empty versus all nonempty strings and validate i32 IDs', () => {
  for (const args of [{}, { chars: '' }]) assert.deepEqual(backgroundTerminalRequest(JSON.stringify(args)), { action: 'poll' });
  for (const chars of [' ', '\n', '\r\n', '\t', '\x03', '\x1b[31m', '中文', 'q']) {
    assert.deepEqual(backgroundTerminalRequest(JSON.stringify({ session_id: 123, chars })), { action: 'input', processId: 123 });
  }
  for (const chars of [null, 0, false, [], {}]) assert.equal(backgroundTerminalRequest(JSON.stringify({ chars })), null);
  for (const text of ['{', 'null', '[]', '42', '""']) assert.equal(backgroundTerminalRequest(text), null);
  for (const session_id of ['123', null, 1.5, 2147483648, -2147483649]) {
    assert.deepEqual(backgroundTerminalRequest(JSON.stringify({ session_id })), { action: 'poll' });
  }
  for (const session_id of [-2147483648, 0, 2147483647]) {
    assert.equal(backgroundTerminalRequest(JSON.stringify({ session_id })).processId, session_id);
  }
});

test('terminal classification rejects ambiguous requests and other sources', () => {
  const raw = { recordType: 'response_item', payloadType: 'function_call', toolName: 'write_stdin', callId: 'w', output: '{}' };
  const event = { sourceKind: 'codex', toolName: 'write_stdin' };
  assert.equal(backgroundTerminalCall([raw, { ...raw }], event), null);
  assert.equal(backgroundTerminalCall([raw], { ...event, sourceKind: 'claude' }), null);
  assert.equal(backgroundTerminalCall([{ ...raw, payloadType: 'custom_tool_call' }], event), null);
});

test('compact materialization and hydration add presentation only, without origin or stdin index copies', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-presentation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const id = 'ab123456-1234-4234-8234-123456789abc';
  const repoRoot = path.join(root, 'repo');
  const dir = path.join(root, 'sessions', '2026', '09', '11');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-${id}.jsonl`);
  const fixture = await fs.readFile(path.join(__dirname, 'fixtures/background-terminal/requests.jsonl'), 'utf8');
  await fs.writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: repoRoot } }) + '\n' + fixture);
  const index = await getSourceAdapter('codex').buildIndex({ repoRoot, sourceHome: root });
  const indexed = index.sessionsById.get(id);
  assert.ok(indexed);
  const session = await materializeSessionForIndex(index, indexed);
  const before = JSON.stringify({ events: session.logicalEvents, analysis: session.analysis, counts: session.counts });
  const facts = session.presentationIndexes.backgroundTerminalRequests;
  const eventFor = (callId) => session.logicalEvents.find((event) => event.id.endsWith(`:${callId}`));
  assert.equal(session.logicalEvents.filter((event) => event.toolName === 'write_stdin').length, 6);
  assert.equal(facts.size, 5);
  assert.equal(eventFor('origin').kind, 'other_tool_call');
  for (const event of session.logicalEvents.filter((event) => event.layer === 'main')) assert.equal(event.kind, 'other_tool_call');
  assert.deepEqual(facts.get(eventFor('omitted').id), { action: 'poll', processId: 123 });
  assert.deepEqual(facts.get(eventFor('bad-id').id), { action: 'poll' });
  assert.equal(facts.has(eventFor('invalid').id), false);
  for (const fact of facts.values()) assert.ok(Object.keys(fact).every((key) => ['action', 'processId'].includes(key)));
  const input = eventFor('input');
  const detail = await codex.buildHydratedEventDetail(index, session, input.id, 'main', { locale: 'zh-CN' });
  assert.equal(detail.title, '后台终端输入请求');
  assert.deepEqual(detail.rawRefs, input.rawRefs);
  const inputSection = detail.timelineSections.find((section) => section.title === '请求输入（JSON 字符串）');
  assert.equal(inputSection.code, JSON.stringify('q \n\x03\x1b[31m中文'));
  assert.ok(JSON.stringify(detail).includes('synthetic rejection'));
  assert.ok(detail.inspectorSections.some((section) => section.title === '请求'));
  const pendingDetail = await codex.buildHydratedEventDetail(index, session, eventFor('pending').id, 'main');
  assert.equal(pendingDetail.title, 'Background terminal input request');
  const filters = { layer: 'main', offset: 0, limit: 100, locale: 'en', q: '中文' };
  const withFacts = codex.getTimeline(index, session, filters);
  session.presentationIndexes.backgroundTerminalRequests = new Map();
  const withoutFacts = codex.getTimeline(index, session, filters);
  assert.equal(withFacts.searchMatchCount, withoutFacts.searchMatchCount);
  assert.equal(withFacts.searchEventCount, withoutFacts.searchEventCount);
  assert.deepEqual(withFacts.events.map(({ presentationFacts, ...event }) => event), withoutFacts.events.map(({ presentationFacts, ...event }) => event));
  session.presentationIndexes.backgroundTerminalRequests = facts;
  const dto = withFacts.events.find((event) => event.id === input.id);
  const { _shell, ...canonicalSession } = session;
  const rules = normalizeRules({});
  assert.equal(displayStateFromRules(dto, rules), displayStateFromRules({ ...dto, presentationFacts: undefined }, rules));
  for (const badFact of [
    { action: 'input_succeeded' }, { action: 'input', chars: 'secret' },
    { action: 'input', originEventId: eventFor('origin').id }, { action: 'poll', processId: '123' },
  ]) {
    facts.set(input.id, badFact);
    assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  }
  facts.set(input.id, { action: 'input', processId: 123 });
  facts.set(eventFor('origin').id, { action: 'poll' });
  assert.throws(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'), { code: 'MATERIALIZATION_CONTRACT_VIOLATION' });
  facts.delete(eventFor('origin').id);
  assert.doesNotThrow(() => validateCanonicalMaterializedSessionShape(indexed, canonicalSession, 'codex'));
  const trajectory = buildTrajectoryPresentation([dto], { locale: 'zh-CN' });
  assert.equal(trajectory.projectedEvents[0].preview, '后台终端输入请求');
  assert.equal(trajectory.projectedEvents[0].type, '后台终端输入请求');
  assert.equal(JSON.stringify({ events: session.logicalEvents, analysis: session.analysis, counts: session.counts }), before);
  assert.equal(backgroundTerminalLabel({ action: 'poll' }, 'en'), 'Background terminal poll request');
  await fs.writeFile(file, '{}\n');
  await assert.rejects(codex.buildHydratedEventDetail(index, session, input.id, 'main'));
});
