'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildIndex, fileSuggestions, filterSessions, getTimeline } = require('../src/codex');
const {
  canonicalRawRecord,
  canonicalRawRecordDigest,
  inferCodexMaterializedForks,
  inferEarlierBranches,
} = require('../src/codex-forks');

function imagePayload(encoding, fill) {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.alloc(48, fill),
  ]);
  const base64 = bytes.toString('base64');
  return encoding === 'data_url' ? `data:image/png;base64,${base64}` : base64;
}

async function makeForkFixture(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-fork-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const parentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  const parentFile = path.join(sessionDir, `rollout-2026-08-09T10-00-00-${parentId}.jsonl`);
  const childFile = path.join(sessionDir, `rollout-2026-08-09T10-05-00-${childId}.jsonl`);
  const parentRecords = [
    {
      timestamp: '2026-08-09T10:00:00.000Z',
      type: 'session_meta',
      payload: { id: parentId, cwd: repoRoot, optional: null, nested: { keep: true, drop: null } },
    },
    {
      timestamp: '2026-08-09T10:00:01.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inherited parent task' }] },
    },
    {
      timestamp: '2026-08-09T10:00:01.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Inherited parent task', images: [], local_images: [], text_elements: [] },
    },
    {
      timestamp: '2026-08-09T10:00:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Inherited parent answer' }] },
    },
    {
      timestamp: '2026-08-09T10:00:02.100Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Inherited parent answer' },
    },
    {
      timestamp: '2026-08-09T10:00:03.000Z',
      type: 'event_msg',
      payload: { type: 'turn_context', marker: 'inherited-protocol-only' },
    },
    {
      timestamp: '2026-08-09T10:00:04.000Z',
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        call_id: 'inherited-patch',
        status: 'completed',
        changes: { 'inherited-only.txt': { type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new' } },
      },
    },
  ];
  if (options.imageEncoding) {
    parentRecords.push({
      timestamp: '2026-08-09T10:00:05.000Z',
      type: 'event_msg',
      payload: {
        type: 'image_generation_end',
        result: imagePayload(options.imageEncoding, 0x11),
      },
    });
  }
  const replayedParentRecords = parentRecords.map((record, index) => {
    const copy = structuredClone(record);
    copy.timestamp = `2026-08-09T09:5${index}:00.000Z`;
    if (index === 0) {
      delete copy.payload.optional;
      delete copy.payload.nested.drop;
    }
    return copy;
  });
  if (options.differentImage) {
    replayedParentRecords.at(-1).payload.result = imagePayload(options.imageEncoding, 0x22);
  }
  const childRecords = [
    {
      timestamp: '2026-08-09T10:05:00.000Z',
      type: 'session_meta',
      payload: { id: childId, forked_from_id: parentId, cwd: repoRoot, thread_source: 'user' },
    },
    ...replayedParentRecords,
    {
      timestamp: '2026-08-09T10:05:01.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Own continuation task' }] },
    },
    {
      timestamp: '2026-08-09T10:05:01.100Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Own continuation task', images: [], local_images: [], text_elements: [] },
    },
    {
      timestamp: '2026-08-09T10:05:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Own continuation answer' }] },
    },
  ];
  await fsp.writeFile(parentFile, `${parentRecords.map(JSON.stringify).join('\n')}\n`, 'utf8');
  if (!options.omitChild) {
    await fsp.writeFile(childFile, `${childRecords.map(JSON.stringify).join('\n')}\n`, 'utf8');
  }
  return { codexHome, repoRoot, parentId, childId, parentFile, childFile, parentRecords, childRecords };
}

async function makeParsedAncestryFixture(t, mode) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-codex-ancestry-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '09');
  const parentId = mode === 'leading-configured'
    ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const childId = mode === 'leading-configured'
    ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    : 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  const parentFile = path.join(sessionDir, `rollout-2026-08-09T10-00-00-${parentId}.jsonl`);
  const childFile = path.join(sessionDir, `rollout-2026-08-09T10-05-00-${childId}.jsonl`);
  const parentRecords = [
    {
      timestamp: '2026-08-09T10:00:00.000Z',
      type: 'session_meta',
      payload: { id: parentId, cwd: repoRoot },
    },
    {
      timestamp: '2026-08-09T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Parent prompt' },
    },
  ];
  const childRecords = mode === 'leading-configured'
    ? [
      {
        timestamp: '2026-08-09T10:05:00.000Z',
        type: 'event_msg',
        payload: { type: 'session_configured', forked_from_id: parentId, cwd: repoRoot },
      },
      {
        timestamp: '2026-08-09T10:05:00.100Z',
        type: 'session_meta',
        payload: { id: childId, cwd: repoRoot },
      },
      {
        timestamp: '2026-08-09T10:05:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Copied parent prompt' },
      },
      {
        timestamp: '2026-08-09T10:05:02.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Own child continuation' },
      },
    ]
    : [
      {
        timestamp: '2026-08-09T10:05:00.000Z',
        type: 'event_msg',
        payload: { type: 'warning', message: 'Leading record before primary metadata' },
      },
      {
        timestamp: '2026-08-09T10:05:00.100Z',
        type: 'session_meta',
        payload: { id: childId, forked_from_id: parentId, cwd: repoRoot },
      },
      {
        timestamp: '2026-08-09T10:05:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Copied parent prompt' },
      },
      {
        timestamp: '2026-08-09T10:05:02.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Own child continuation' },
      },
    ];
  await fsp.writeFile(parentFile, `${parentRecords.map(JSON.stringify).join('\n')}\n`, 'utf8');
  await fsp.writeFile(childFile, `${childRecords.map(JSON.stringify).join('\n')}\n`, 'utf8');
  return { codexHome, repoRoot, parentId, childId };
}

test('canonical fork records ignore replay timestamps and recursively remove object nulls', () => {
  const a = {
    timestamp: '2026-08-09T10:00:00.000Z',
    type: 'event_msg',
    payload: { z: 2, a: { keep: 1, omit: null }, list: [null, { omit: null, keep: 3 }] },
  };
  const b = {
    payload: { list: [null, { keep: 3 }], a: { keep: 1 }, z: 2 },
    type: 'event_msg',
    timestamp: '2020-01-01T00:00:00.000Z',
  };
  assert.equal(canonicalRawRecord(a), canonicalRawRecord(b));
  assert.equal(canonicalRawRecordDigest(a), canonicalRawRecordDigest(b));
  assert.notEqual(
    canonicalRawRecordDigest({ ...b, payload: { ...b.payload, list: [{ keep: 3 }, null] } }),
    canonicalRawRecordDigest(a),
    'array order and null array entries remain significant',
  );
});

test('canonical fork records preserve own __proto__ data fields', () => {
  const parentValue = JSON.parse('{"timestamp":"2026-08-09T10:00:00.000Z","type":"event_msg","payload":{"stable":true,"__proto__":{"marker":"parent"}}}');
  const childValue = JSON.parse('{"timestamp":"2026-08-09T10:00:00.000Z","type":"event_msg","payload":{"stable":true,"__proto__":{"marker":"child"}}}');

  assert.notEqual(canonicalRawRecord(parentValue), canonicalRawRecord(childValue));
  assert.notEqual(canonicalRawRecordDigest(parentValue), canonicalRawRecordDigest(childValue));
  assert.match(canonicalRawRecord(parentValue), /"__proto__":\{"marker":"parent"\}/);
});

test('materialized fork inference fails closed when a copied prefix differs only in __proto__', () => {
  const parentId = 'parent-proto';
  const childId = 'child-proto';
  const raw = (sessionId, index, record) => ({
    rawId: `${sessionId}:raw:${index + 1}`,
    recordType: record.type,
    parsed: record,
    timestamp: record.timestamp,
    _canonicalRawDigest: canonicalRawRecordDigest(record),
  });
  const parentRecords = [
    JSON.parse(`{"timestamp":"2026-08-09T10:00:00.000Z","type":"session_meta","payload":{"id":"${parentId}"}}`),
    JSON.parse('{"timestamp":"2026-08-09T10:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"copied","__proto__":{"marker":"parent"}}}'),
  ];
  const childRecords = [
    JSON.parse(`{"timestamp":"2026-08-09T10:05:00.000Z","type":"session_meta","payload":{"id":"${childId}","forked_from_id":"${parentId}"}}`),
    structuredClone(parentRecords[0]),
    JSON.parse('{"timestamp":"2026-08-09T10:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"copied","__proto__":{"marker":"child"}}}'),
    { timestamp: '2026-08-09T10:05:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'own child activity' } },
  ];
  const parent = {
    id: parentId,
    rawEvents: parentRecords.map((record, index) => raw(parentId, index, record)),
    logicalEvents: [{ id: `${parentId}:logical:copied`, layer: 'main', rawRefs: [{ rawId: `${parentId}:raw:2` }] }],
  };
  const child = {
    id: childId,
    rawEvents: childRecords.map((record, index) => raw(childId, index, record)),
    logicalEvents: [
      { id: `${childId}:logical:changed`, layer: 'main', rawRefs: [{ rawId: `${childId}:raw:3` }] },
      { id: `${childId}:logical:own`, layer: 'main', rawRefs: [{ rawId: `${childId}:raw:4` }] },
    ],
  };

  assert.equal(inferCodexMaterializedForks([parent, child]), 0);
  assert.equal(child.forkStorageMode, '');
  assert.deepEqual(child.logicalEvents.map((event) => event.id), [
    `${childId}:logical:changed`,
    `${childId}:logical:own`,
  ], 'failed materialization keeps child activity visible');
});

test('materialized fork digests use image bytes before externalization', async (t) => {
  for (const imageEncoding of ['data_url', 'bare_base64']) {
    const sameImage = await makeForkFixture(t, { imageEncoding });
    const sameIndex = await buildIndex({ repoRoot: sameImage.repoRoot, codexHome: sameImage.codexHome });
    const sameParent = sameIndex.sessionsById.get(sameImage.parentId);
    const sameChild = sameIndex.sessionsById.get(sameImage.childId);
    const sameParentImage = sameParent.rawEvents.find((raw) => raw.payloadType === 'image_generation_end');
    const sameChildImage = sameChild.rawEvents.find((raw) => raw.payloadType === 'image_generation_end');
    assert.equal(Object.hasOwn(sameParentImage, 'parsed'), false);
    assert.equal(Object.hasOwn(sameChildImage, 'parsed'), false);
    assert.equal(sameParentImage.embeddedImages.length, 1);
    assert.equal(sameChildImage.embeddedImages.length, 1);
    assert.equal(sameChild.forkStorageMode, 'materialized', imageEncoding);

    const differentImage = await makeForkFixture(t, { imageEncoding, differentImage: true });
    const differentIndex = await buildIndex({ repoRoot: differentImage.repoRoot, codexHome: differentImage.codexHome });
    const differentParent = differentIndex.sessionsById.get(differentImage.parentId);
    const differentChild = differentIndex.sessionsById.get(differentImage.childId);
    const differentParentImage = differentParent.rawEvents.find((raw) => raw.payloadType === 'image_generation_end');
    const differentChildImage = differentChild.rawEvents.find((raw) => raw.payloadType === 'image_generation_end');
    const differentParentDigest = differentParent._canonicalRawDigests[differentParent.rawEvents.indexOf(differentParentImage)];
    const differentChildDigest = differentChild._canonicalRawDigests[differentChild.rawEvents.indexOf(differentChildImage)];
    assert.notEqual(differentChildDigest, differentParentDigest, imageEncoding);
    assert.equal(differentChild.forkStorageMode, '', imageEncoding);
    assert.equal(differentChild.forkedFromSessionId, differentImage.parentId, imageEncoding);
    assert.equal(differentChild.title, 'Own continuation task', imageEncoding);
  }
});

test('ordinary fork ancestry survives failed materialization on first parse and reindex', async (t) => {
  for (const mode of ['leading-configured', 'non-first-session-meta']) {
    const fixture = await makeParsedAncestryFixture(t, mode);
    const first = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
    const child = first.sessionsById.get(fixture.childId);
    assert.equal(child.forkStorageMode, '', mode);
    assert.equal(child.forkedFromSessionId, fixture.parentId, mode);
    assert.equal(child.title, 'Own child continuation', mode);
    assert.equal(child._parsedAncestry.forkedFromSessionId, fixture.parentId, mode);

    const reindexed = await buildIndex({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
      previousIndex: first,
    });
    const reindexedChild = reindexed.sessionsById.get(fixture.childId);
    assert.equal(reindexedChild.forkStorageMode, '', mode);
    assert.equal(reindexedChild.forkedFromSessionId, fixture.parentId, mode);
    assert.equal(reindexedChild.title, 'Own child continuation', mode);
  }
});

test('reindex reparses newly eligible materialized fork files once and then reuses their digests', async (t) => {
  const fixture = await makeForkFixture(t, { omitChild: true });
  const parentOnly = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const parentWithoutFork = parentOnly.sessionsById.get(fixture.parentId);
  assert.equal(parentWithoutFork._canonicalRawDigests, undefined);
  assert.ok(parentWithoutFork.rawEvents.every((raw) => raw._canonicalRawDigest === undefined));

  await fsp.writeFile(fixture.childFile, `${fixture.childRecords.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const newlyEligible = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: parentOnly,
  });
  const reparsedParent = newlyEligible.sessionsById.get(fixture.parentId);
  const parsedChild = newlyEligible.sessionsById.get(fixture.childId);
  assert.equal(newlyEligible.totals.reusedFileCount, 0);
  assert.equal(parsedChild.forkStorageMode, 'materialized');
  assert.equal(reparsedParent._canonicalRawDigests.length, reparsedParent.rawEvents.length);
  assert.equal(parsedChild._canonicalRawDigests.length, parsedChild.rawEvents.length);
  assert.ok(reparsedParent._canonicalRawDigests.every(Boolean));
  assert.ok(parsedChild._canonicalRawDigests.every(Boolean));
  assert.ok(reparsedParent.rawEvents.every((raw) => raw._canonicalRawDigest === undefined));
  assert.ok(parsedChild.rawEvents.every((raw) => raw._canonicalRawDigest === undefined));

  const reused = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: newlyEligible,
  });
  assert.equal(reused.totals.reusedFileCount, 2);
  assert.equal(reused.sessionsById.get(fixture.childId).forkStorageMode, 'materialized');
});

test('materialized fork reindex invalidates a stat-equal rewritten child fingerprint', async (t) => {
  const fixture = await makeForkFixture(t);
  const fixedTime = new Date('2026-08-09T12:00:00.000Z');
  await fsp.utimes(fixture.parentFile, fixedTime, fixedTime);
  await fsp.utimes(fixture.childFile, fixedTime, fixedTime);
  const first = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const oldParent = first.sessionsById.get(fixture.parentId);
  const oldChild = first.sessionsById.get(fixture.childId);
  assert.equal(oldChild.forkStorageMode, 'materialized');
  const original = await fsp.readFile(fixture.childFile, 'utf8');
  const rewritten = original.replace('Inherited parent task', 'Inherited parent mask');
  assert.equal(rewritten.length, original.length);
  await fsp.writeFile(fixture.childFile, rewritten, 'utf8');
  await fsp.utimes(fixture.childFile, fixedTime, fixedTime);
  const rewrittenStat = await fsp.stat(fixture.childFile);
  assert.equal(rewrittenStat.size, oldChild.bytes);
  assert.equal(rewrittenStat.mtime.toISOString(), oldChild.sourceUpdatedAt);

  const second = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
  });
  const newParent = second.sessionsById.get(fixture.parentId);
  const newChild = second.sessionsById.get(fixture.childId);
  assert.equal(second.totals.reusedFileCount, 1);
  assert.equal(newParent.rawEvents, oldParent.rawEvents);
  assert.notEqual(newChild.rawEvents, oldChild.rawEvents);
  assert.notEqual(newChild.sourceFingerprint, oldChild.sourceFingerprint);
  assert.equal(newChild.forkStorageMode, '');
  assert.equal(newChild.forkedFromSessionId, fixture.parentId);
});

test('materialized Codex forks expose only continuation ownership while Raw stays physical', async (t) => {
  const fixture = await makeForkFixture(t);
  const index = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const parent = index.sessionsById.get(fixture.parentId);
  const child = index.sessionsById.get(fixture.childId);

  assert.equal(child.forkStorageMode, 'materialized');
  assert.equal(child.forkedAt, '2026-08-09T10:05:00.000Z');
  assert.equal(child.forkEvidence.matchedParentRawCount, fixture.parentRecords.length);
  assert.equal(child.rawEvents.length, fixture.parentRecords.length + 4);
  assert.equal(child.title, 'Own continuation task');
  assert.equal(child.counts.messages, 2);
  assert.equal(child.counts.userMessages, 1);
  assert.equal(child.counts.assistantMessages, 1);
  assert.equal(child.counts.patches, 0);
  assert.equal(child.analysis.patchedFiles.some((item) => item.file.includes('inherited-only.txt')), false);
  assert.equal(child.logicalEvents.some((event) => event.searchText.includes('Inherited parent task')), false);
  assert.equal(child.inheritedContext.rawRecordCount, fixture.parentRecords.length);
  assert.equal(child.inheritedContext.mainEventCount, parent.logicalEvents.filter((event) => event.layer === 'main').length);
  assert.equal(child.inheritedContext.forkPointTarget.layer, 'main');
  assert.equal(parent.supersededBySessionId, child.id);
  assert.equal(parent.supersededReason, 'inactive_after_fork');

  assert.equal(filterSessions(index, { q: 'Inherited parent task', layer: 'main' }).sessions.some((item) => item.id === child.id), false);
  assert.equal(filterSessions(index, { q: 'inherited-protocol-only', layer: 'protocol' }).sessions.some((item) => item.id === child.id), false);
  assert.equal(filterSessions(index, { q: 'Inherited parent task', layer: 'raw' }).sessions.some((item) => item.id === child.id), true);
  assert.equal(fileSuggestions(index, { sessionId: child.id, layer: 'main' }).some((item) => item.file.includes('inherited-only.txt')), false);
  const raw = getTimeline(index, child.id, { q: '', offset: 0, limit: 100, layer: 'raw' });
  assert.deepEqual(
    raw.events.map((event) => event.forkSegment),
    ['fork_metadata', ...fixture.parentRecords.map(() => 'inherited_context'), 'continuation', 'continuation', 'continuation'],
  );
  assert.ok(raw.events.slice(1, 1 + fixture.parentRecords.length).every((event) => event.inheritedFromSessionId === parent.id));
  assert.equal(index.totals.eventCount, index.sessions.reduce((sum, session) => sum + session.logicalEvents.length, 0));

  await fsp.writeFile(path.join(fixture.codexHome, 'session_index.jsonl'), `${JSON.stringify({
    id: child.id,
    thread_name: 'Explicit materialized fork title',
    updated_at: '2026-08-09T10:12:00.000Z',
  })}\n`, 'utf8');
  const reindexed = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: index,
  });
  assert.equal(reindexed.sessionsById.get(child.id).title, 'Explicit materialized fork title');
});

test('materialized fork inference fails closed for interrupted prefixes and cross-boundary logical refs', () => {
  const parentId = 'parent';
  const childId = 'child';
  const raw = (sessionId, index, record) => ({
    rawId: `${sessionId}:raw:${index + 1}`,
    recordType: record.type,
    parsed: record,
    timestamp: record.timestamp,
    _canonicalRawDigest: canonicalRawRecordDigest(record),
  });
  const parentRecords = [
    { timestamp: '2026-08-09T10:00:00.000Z', type: 'session_meta', payload: { id: parentId } },
    { timestamp: '2026-08-09T10:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'parent' } },
  ];
  const childRecords = [
    { timestamp: '2026-08-09T10:05:00.000Z', type: 'session_meta', payload: { id: childId, forked_from_id: parentId } },
    structuredClone(parentRecords[0]),
    { timestamp: '2026-08-09T10:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'changed' } },
  ];
  const parent = { id: parentId, rawEvents: parentRecords.map((record, index) => raw(parentId, index, record)), logicalEvents: [] };
  const interrupted = { id: childId, rawEvents: childRecords.map((record, index) => raw(childId, index, record)), logicalEvents: [] };
  assert.equal(inferCodexMaterializedForks([interrupted]), 0, 'missing parent fails closed');
  const duplicateParent = { ...parent, rawEvents: parent.rawEvents.map((event) => ({ ...event })) };
  assert.equal(inferCodexMaterializedForks([parent, duplicateParent, interrupted]), 0, 'duplicate parent identity fails closed');
  assert.equal(inferCodexMaterializedForks([parent, interrupted]), 0);
  assert.equal(interrupted.forkStorageMode, '');

  const wrongMetadataRecords = [structuredClone(childRecords[0]), structuredClone(parentRecords[0])];
  wrongMetadataRecords[1].payload.id = 'wrong-parent';
  const wrongMetadata = {
    id: childId,
    rawEvents: wrongMetadataRecords.map((record, index) => raw(childId, index, record)),
    logicalEvents: [],
  };
  assert.equal(inferCodexMaterializedForks([parent, wrongMetadata]), 0, 'embedded parent metadata mismatch fails closed');

  const completeChildRecords = [
    childRecords[0],
    ...parentRecords,
    { timestamp: '2026-08-09T10:05:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'continuation' } },
  ];
  const crossing = {
    id: childId,
    rawEvents: completeChildRecords.map((record, index) => raw(childId, index, record)),
  };
  crossing.logicalEvents = [{
    id: `${childId}:logical:crossing`,
    layer: 'main',
    rawRefs: [{ rawId: crossing.rawEvents[2].rawId }, { rawId: crossing.rawEvents[3].rawId }],
  }];
  assert.equal(inferCodexMaterializedForks([parent, crossing]), 0);
  assert.equal(crossing.logicalEvents.length, 1, 'fail-closed keeps the complete projection public');
});

test('materialized fork accepts a structurally distinct continuation after an earlier fork point', () => {
  const parentId = 'earlier-point-parent';
  const childId = 'earlier-point-child';
  const makeRaw = (sessionId, record, index) => ({
    rawId: `${sessionId}:raw:${index + 1}`,
    recordType: record.type,
    parsed: record,
    timestamp: record.timestamp,
    _canonicalRawDigest: canonicalRawRecordDigest(record),
  });
  const parentRecords = [
    { timestamp: '2026-08-09T10:00:00.000Z', type: 'session_meta', payload: { id: parentId } },
    { timestamp: '2026-08-09T10:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'shared history' } },
    { timestamp: '2026-08-09T10:00:02.000Z', type: 'event_msg', payload: { type: 'task_complete' } },
    { timestamp: '2026-08-09T10:04:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'discarded-turn' } },
    { timestamp: '2026-08-09T10:04:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'discarded branch prompt' } },
    { timestamp: '2026-08-09T10:04:02.000Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'discarded-turn' } },
  ];
  const replayedPrefix = parentRecords.slice(0, 3).map((record) => ({
    ...structuredClone(record),
    timestamp: '2026-08-09T10:05:00.000Z',
  }));
  const childRecords = [
    { timestamp: '2026-08-09T10:05:00.000Z', type: 'session_meta', payload: { id: childId, forked_from_id: parentId } },
    ...replayedPrefix,
    { timestamp: '2026-08-09T10:05:00.100Z', type: 'event_msg', payload: { type: 'thread_settings_applied', settings: { model: 'test' } } },
    { timestamp: '2026-08-09T10:05:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'owned continuation' } },
  ];
  const parent = {
    id: parentId,
    rawEvents: parentRecords.map((record, index) => makeRaw(parentId, record, index)),
    logicalEvents: [
      { id: `${parentId}:shared`, layer: 'main', rawRefs: [{ rawId: `${parentId}:raw:2` }], preview: 'shared history' },
      { id: `${parentId}:discarded`, layer: 'main', rawRefs: [{ rawId: `${parentId}:raw:5` }], preview: 'discarded branch prompt' },
    ],
  };
  const child = {
    id: childId,
    rawEvents: childRecords.map((record, index) => makeRaw(childId, record, index)),
    logicalEvents: [
      { id: `${childId}:shared`, layer: 'main', rawRefs: [{ rawId: `${childId}:raw:3` }], preview: 'shared history' },
      { id: `${childId}:settings`, layer: 'protocol', rawRefs: [{ rawId: `${childId}:raw:5` }] },
      { id: `${childId}:owned`, layer: 'main', rawRefs: [{ rawId: `${childId}:raw:6` }], preview: 'owned continuation' },
    ],
  };

  assert.equal(inferCodexMaterializedForks([parent, child]), 1);
  assert.equal(child.forkStorageMode, 'materialized');
  assert.equal(child.forkEvidence.matchedParentRawCount, 3);
  assert.deepEqual(child.logicalEvents.map((event) => event.id), [`${childId}:settings`, `${childId}:owned`]);
  inferEarlierBranches([parent, child]);
  assert.equal(parent.supersededBySessionId, childId);
});

test('materialized fork prefix matching stays practical for large copied histories', () => {
  const parentId = 'large-parent';
  const childId = 'large-child';
  const parentRecords = [
    { timestamp: '2026-08-09T09:00:00.000Z', type: 'session_meta', payload: { id: parentId } },
    ...Array.from({ length: 3000 }, (_, index) => ({
      timestamp: new Date(Date.parse('2026-08-09T09:00:01.000Z') + index * 1000).toISOString(),
      type: 'turn_context',
      payload: { turn_id: `turn-${index}`, values: [index, { stable: true, omitted: null }] },
    })),
  ];
  const makeRaw = (sessionId, record, index) => ({
    rawId: `${sessionId}:raw:${index + 1}`,
    recordType: record.type,
    parsed: record,
    timestamp: record.timestamp,
    _canonicalRawDigest: canonicalRawRecordDigest(record),
  });
  const parent = {
    id: parentId,
    rawEvents: parentRecords.map((record, index) => makeRaw(parentId, record, index)),
    logicalEvents: [],
  };
  const childRecords = [
    { timestamp: '2026-08-09T10:00:00.000Z', type: 'session_meta', payload: { id: childId, forked_from_id: parentId } },
    ...parentRecords,
  ];
  const child = {
    id: childId,
    rawEvents: childRecords.map((record, index) => makeRaw(childId, record, index)),
    logicalEvents: [],
  };
  assert.equal(inferCodexMaterializedForks([parent, child]), 1);
  assert.equal(child.forkEvidence.matchedParentRawCount, parentRecords.length);
});

test('earlier-branch inference folds inactive chains but keeps active and shared parents parallel', () => {
  const session = (id, options = {}) => ({
    id,
    parentSessionId: '',
    primarySessionMetaKind: '',
    forkedFromSessionId: options.forkedFrom || '',
    forkStorageMode: options.storage || '',
    forkedAt: options.forkedAt || '',
    rawEvents: (options.rawTimestamps || []).map((timestamp, index) => ({ rawId: `${id}:raw:${index}`, timestamp })),
    logicalEvents: options.main === false ? [] : [{ id: `${id}:main`, layer: 'main' }],
  });

  const a = session('a', { rawTimestamps: ['2026-08-09T10:00:00.000Z'] });
  const b = session('b', {
    forkedFrom: 'a', storage: 'materialized', forkedAt: '2026-08-09T10:05:00.000Z',
    rawTimestamps: ['2026-08-09T10:05:00.000Z'],
  });
  const c = session('c', {
    forkedFrom: 'b', storage: 'materialized', forkedAt: '2026-08-09T10:10:00.000Z',
    rawTimestamps: ['2026-08-09T10:10:00.000Z'],
  });
  inferEarlierBranches([a, b, c]);
  assert.equal(a.supersededBySessionId, 'b');
  assert.equal(b.supersededBySessionId, 'c');

  const activeParent = session('active', { rawTimestamps: ['2026-08-09T10:06:00.000Z'] });
  const activeChild = session('active-child', {
    forkedFrom: 'active', storage: 'materialized', forkedAt: '2026-08-09T10:05:00.000Z',
    rawTimestamps: ['2026-08-09T10:05:00.000Z'],
  });
  inferEarlierBranches([activeParent, activeChild]);
  assert.equal(activeParent.supersededBySessionId, '');

  const sharedParent = session('shared', { rawTimestamps: ['2026-08-09T10:00:00.000Z'] });
  const first = session('first', {
    forkedFrom: 'shared', storage: 'materialized', forkedAt: '2026-08-09T10:05:00.000Z',
    rawTimestamps: ['2026-08-09T10:05:00.000Z'],
  });
  const second = session('second', {
    forkedFrom: 'shared', storage: 'materialized', forkedAt: '2026-08-09T10:06:00.000Z',
    rawTimestamps: ['2026-08-09T10:06:00.000Z'],
  });
  inferEarlierBranches([sharedParent, first, second]);
  assert.equal(sharedParent.supersededBySessionId, '');
});

test('reindex reuses an unchanged child but retracts earlier-branch folding after parent activity', async (t) => {
  const fixture = await makeForkFixture(t);
  const first = await buildIndex({ repoRoot: fixture.repoRoot, codexHome: fixture.codexHome });
  const firstChild = first.sessionsById.get(fixture.childId);
  assert.equal(first.sessionsById.get(fixture.parentId).supersededBySessionId, fixture.childId);

  await fsp.appendFile(fixture.parentFile, `${JSON.stringify({
    timestamp: '2026-08-09T10:06:00.000Z',
    type: 'event_msg',
    payload: { type: 'warning', message: 'parent continued after fork' },
  })}\n`, 'utf8');
  const second = await buildIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: first,
  });
  const secondChild = second.sessionsById.get(fixture.childId);
  assert.equal(secondChild.rawEvents, firstChild.rawEvents);
  assert.equal(secondChild._logicalEvents, firstChild._logicalEvents);
  assert.equal(secondChild._canonicalRawDigests, firstChild._canonicalRawDigests);
  assert.equal(secondChild.forkStorageMode, 'materialized');
  assert.equal(secondChild.inheritedContext.rawRecordCount, fixture.parentRecords.length);
  assert.equal(second.sessionsById.get(fixture.parentId).supersededBySessionId, '');
  assert.equal(second.totals.reusedFileCount, 1);
});
