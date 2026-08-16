'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const {
  materializeSessionForIndex,
  validateIndexOwnership,
} = require('../src/source-adapters');

const FIXTURE_HOME = path.join(__dirname, 'fixtures', 'codex-home');
const FIXTURE_REPO = 'G:\\vibe\\term-agent';
const FORBIDDEN_RETAINED_FIELDS = new Set([
  'rawEvents',
  'logicalEvents',
  'analysis',
  'presentationIndexes',
  '_logicalEvents',
  '_canonicalRawDigests',
  '_reviewMarkers',
  'parsed',
]);

function assertNoReachableCompleteEventGraph(index) {
  const seen = new WeakSet();
  const stack = [index];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const field of FORBIDDEN_RETAINED_FIELDS) {
      assert.equal(
        Object.hasOwn(value, field),
        false,
        `strict Index retained forbidden field ${field}`,
      );
    }
    assert.equal(
      Object.hasOwn(value, 'rawId'),
      false,
      'strict Index retained a reachable Raw Event',
    );
    assert.equal(
      Object.hasOwn(value, 'rawRefs') && Object.hasOwn(value, 'layer'),
      false,
      'strict Index retained a reachable Logical Event',
    );
    if (value instanceof Map) {
      for (const [key, nested] of value) stack.push(key, nested);
    } else if (value instanceof Set) {
      for (const nested of value) stack.push(nested);
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) stack.push(descriptor.value);
    }
  }
}

async function makeSingleSessionFixture(t, options = {}) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-strict-codex-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionRoot = path.join(codexHome, 'sessions', '2026', '08', '16');
  const id = options.id || '16161616-1616-4616-8616-161616161616';
  const file = path.join(sessionRoot, `rollout-2026-08-16T10-00-00-${id}.jsonl`);
  const records = typeof options.records === 'function' ? options.records({ id, repoRoot }) : [
    {
      timestamp: '2026-08-16T10:00:00.000Z',
      type: 'session_meta',
      payload: { id, cwd: repoRoot },
    },
    {
      timestamp: '2026-08-16T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: options.message || 'hello strict lifecycle' },
    },
    {
      timestamp: '2026-08-16T10:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'materialized answer' },
    },
  ];
  const originalText = `${records.map(JSON.stringify).join('\n')}\n`;
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  await fsp.writeFile(file, originalText, 'utf8');
  if (options.title) {
    await fsp.writeFile(path.join(codexHome, 'session_index.jsonl'), `${JSON.stringify({
      id,
      thread_name: options.title,
      updated_at: '2026-08-16T10:03:00.000Z',
    })}\n`, 'utf8');
  }
  const index = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
  return {
    codexHome,
    file,
    id,
    index,
    originalText,
    repoRoot,
  };
}

test('strict Codex fork discovery retains only compact scalar relationship facts between passes', async (t) => {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-strict-fork-heavy-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const sessionRoot = path.join(codexHome, 'sessions', '2026', '08', '16');
  const parentId = 'aaaaaaaa-1616-4616-8616-161616161616';
  const childId = 'bbbbbbbb-1616-4616-8616-161616161616';
  const parentRecords = [{
    timestamp: '2026-08-16T10:00:00.000Z',
    type: 'session_meta',
    payload: { id: parentId, cwd: repoRoot },
  }];
  for (let index = 0; index < 2_000; index += 1) {
    parentRecords.push({
      timestamp: `2026-08-16T10:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      type: 'event_msg',
      payload: {
        type: index % 2 ? 'agent_message' : 'user_message',
        message: `fork-heavy row ${index}`,
      },
    });
  }
  const childRecords = [{
    timestamp: '2026-08-16T11:00:00.000Z',
    type: 'session_meta',
    payload: { id: childId, cwd: repoRoot, forked_from_id: parentId },
  }, ...parentRecords, {
    timestamp: '2026-08-16T11:00:01.000Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'owned continuation' },
  }];
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(sessionRoot, `rollout-parent-${parentId}.jsonl`), `${parentRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
    fsp.writeFile(path.join(sessionRoot, `rollout-child-${childId}.jsonl`), `${childRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
  ]);

  let inspected = false;
  const index = await codex.buildSourceBackedIndex({
    repoRoot,
    codexHome,
    beforeRelationshipInferenceForTests: ({ relationshipEvidence }) => {
      inspected = true;
      assert.equal(relationshipEvidence.length, 2);
      assert.ok(relationshipEvidence.reduce((sum, evidence) => sum + evidence._forkRawFacts.length, 0) > 4_000);
      for (const evidence of relationshipEvidence) {
        for (const forbidden of ['rawEvents', 'logicalEvents', '_logicalEvents']) {
          assert.equal(Object.hasOwn(evidence, forbidden), false, `Pass A retained ${forbidden}`);
        }
        assert.ok(evidence._forkRawFacts.every((fact) => (
          Array.isArray(fact) && fact.every((value) => typeof value === 'string')
        )));
        assert.ok(evidence._forkLogicalRanges.every((range) => (
          Array.isArray(range)
          && range.length === 3
          && range.every(Number.isSafeInteger)
        )));
      }
    },
  });
  const child = index.sessionsById.get(childId);
  assert.equal(inspected, true);
  assert.equal(child.forkStorageMode, 'materialized');
  assert.equal(child.counts.messages, 1);
  assert.equal(child.inheritedContext.previewEventCount, 12);
  assert.equal(child.inheritedContext.previewEvents.length, 12);
  assertNoReachableCompleteEventGraph(index);
});

test('strict Codex materialized fork contexts match resident nested and cyclic relationships', async (t) => {
  await t.test('nested materialized forks derive child targets from the projected parent timeline', async (subtest) => {
    const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-strict-nested-fork-'));
    subtest.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
    const repoRoot = path.join(codexHome, 'repo');
    const sessionRoot = path.join(codexHome, 'sessions', '2026', '08', '16');
    const grandparentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const parentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const childId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const grandparentRecords = [
      {
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'session_meta',
        payload: { id: grandparentId, cwd: repoRoot },
      },
      {
        timestamp: '2026-08-16T10:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'grandparent context' },
      },
      {
        timestamp: '2026-08-16T10:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'grandparent answer' },
      },
    ];
    const parentRecords = [
      {
        timestamp: '2026-08-16T11:00:00.000Z',
        type: 'session_meta',
        payload: { id: parentId, cwd: repoRoot, forked_from_id: grandparentId },
      },
      ...structuredClone(grandparentRecords),
      {
        timestamp: '2026-08-16T11:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'parent continuation' },
      },
    ];
    const childRecords = [
      {
        timestamp: '2026-08-16T12:00:00.000Z',
        type: 'session_meta',
        payload: { id: childId, cwd: repoRoot, forked_from_id: parentId },
      },
      ...structuredClone(parentRecords),
      {
        timestamp: '2026-08-16T12:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'child continuation' },
      },
    ];
    await fsp.mkdir(repoRoot, { recursive: true });
    await fsp.mkdir(sessionRoot, { recursive: true });
    await Promise.all([
      fsp.writeFile(path.join(sessionRoot, `rollout-grandparent-${grandparentId}.jsonl`), `${grandparentRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
      fsp.writeFile(path.join(sessionRoot, `rollout-parent-${parentId}.jsonl`), `${parentRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
      fsp.writeFile(path.join(sessionRoot, `rollout-child-${childId}.jsonl`), `${childRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
    ]);

    const resident = await codex.buildIndex({ repoRoot, codexHome });
    const strict = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
    for (const id of [grandparentId, parentId, childId]) {
      const expected = resident.sessionsById.get(id);
      const indexed = strict.sessionsById.get(id);
      assert.equal(indexed.forkStorageMode, expected.forkStorageMode);
      assert.deepEqual(indexed.inheritedContext, expected.inheritedContext);
      const materialized = await materializeSessionForIndex(strict, indexed);
      assert.deepEqual(materialized.rawEvents, expected.rawEvents);
      assert.deepEqual(materialized.logicalEvents, expected.logicalEvents);
      assert.deepEqual(materialized.analysis, expected.analysis);
      assert.deepEqual(materialized.presentationIndexes, expected.presentationIndexes);
    }
    assert.equal(strict.sessionsById.get(childId).inheritedContext.forkPointTarget.timelineIndex, 0);
  });

  await t.test('cyclic materialized prefixes preserve resident inherited context', async (subtest) => {
    const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-strict-cycle-fork-'));
    subtest.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
    const repoRoot = path.join(codexHome, 'repo');
    const sessionRoot = path.join(codexHome, 'sessions', '2026', '08', '16');
    const firstId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const secondId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const firstMeta = {
      timestamp: '2026-08-16T13:00:00.000Z',
      type: 'session_meta',
      payload: { id: firstId, cwd: repoRoot, forked_from_id: secondId },
    };
    const secondMeta = {
      timestamp: '2026-08-16T13:00:01.000Z',
      type: 'session_meta',
      payload: { id: secondId, cwd: repoRoot, forked_from_id: firstId },
    };
    const firstRecords = [
      firstMeta,
      structuredClone(secondMeta),
      {
        timestamp: '2026-08-16T13:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'first cycle continuation' },
      },
    ];
    const secondRecords = [
      secondMeta,
      structuredClone(firstMeta),
      {
        timestamp: '2026-08-16T13:00:03.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'second cycle continuation' },
      },
    ];
    await fsp.mkdir(repoRoot, { recursive: true });
    await fsp.mkdir(sessionRoot, { recursive: true });
    await Promise.all([
      fsp.writeFile(path.join(sessionRoot, `rollout-first-${firstId}.jsonl`), `${firstRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
      fsp.writeFile(path.join(sessionRoot, `rollout-second-${secondId}.jsonl`), `${secondRecords.map(JSON.stringify).join('\n')}\n`, 'utf8'),
    ]);

    const resident = await codex.buildIndex({ repoRoot, codexHome });
    const strict = await codex.buildSourceBackedIndex({ repoRoot, codexHome });
    for (const id of [firstId, secondId]) {
      const expected = resident.sessionsById.get(id);
      const indexed = strict.sessionsById.get(id);
      assert.equal(indexed.forkStorageMode, 'materialized');
      assert.deepEqual(indexed.inheritedContext, expected.inheritedContext);
      const materialized = await materializeSessionForIndex(strict, indexed);
      assert.deepEqual(materialized.rawEvents, expected.rawEvents);
      assert.deepEqual(materialized.logicalEvents, expected.logicalEvents);
      assert.deepEqual(materialized.analysis, expected.analysis);
      assert.deepEqual(materialized.presentationIndexes, expected.presentationIndexes);
    }
  });
});

test('strict Codex materialization carries bounded shell context into command detail', async (t) => {
  const fixture = await makeSingleSessionFixture(t, {
    records: ({ id, repoRoot }) => [
      {
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'session_meta',
        payload: { id, cwd: repoRoot },
      },
      {
        timestamp: '2026-08-16T10:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `<environment_context>\n  <cwd>${repoRoot}</cwd>\n  <shell>C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe</shell>\n</environment_context>`,
          }],
        },
      },
      {
        timestamp: '2026-08-16T10:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: 'call-shell-context',
          arguments: JSON.stringify({ command: 'pip3 install tox; python3 -m pytest', workdir: repoRoot }),
        },
      },
    ],
  });
  const indexedSession = fixture.index.sessionsById.get(fixture.id);
  const materialized = await materializeSessionForIndex(fixture.index, indexedSession);
  const command = materialized.logicalEvents.find((event) => event.kind === 'command');
  const detail = await codex.buildHydratedEventDetail(fixture.index, materialized, command.id, 'main');
  assert.equal(materialized._shell, 'powershell');
  assert.equal(detail.timelineSections[0].language, 'powershell');
  assert.doesNotThrow(() => codex.validateCodexMaterializedPrivateState({ indexedSession, session: materialized }));
  assert.throws(
    () => codex.validateCodexMaterializedPrivateState({
      indexedSession,
      session: { ...materialized, _shell: 42 },
    }),
    /shell must be a string/,
  );
  assert.throws(
    () => codex.validateCodexMaterializedPrivateState({
      indexedSession,
      session: { ...materialized, _shell: 'x'.repeat(4_097) },
    }),
    /at most 4096 UTF-8 bytes/,
  );
});

test('Codex parser bounds normalized shell context at exact UTF-8 boundaries', async (t) => {
  const buildShellFixture = (shell) => makeSingleSessionFixture(t, {
    records: ({ id, repoRoot }) => [
      {
        timestamp: '2026-08-16T10:00:00.000Z',
        type: 'session_meta',
        payload: { id, cwd: repoRoot },
      },
      {
        timestamp: '2026-08-16T10:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `<environment_context>\n  <cwd>${repoRoot}</cwd>\n  <shell>${shell}</shell>\n</environment_context>`,
          }],
        },
      },
    ],
  });
  for (const [label, shell, expected] of [
    ['exact ASCII limit', 'x'.repeat(4_096), 'x'.repeat(4_096)],
    ['one ASCII byte over', 'x'.repeat(4_097), ''],
    ['multibyte below limit', '界'.repeat(1_365), '界'.repeat(1_365)],
    ['multibyte over limit', '界'.repeat(1_366), ''],
  ]) {
    await t.test(label, async () => {
      const fixture = await buildShellFixture(shell);
      const indexedSession = fixture.index.sessionsById.get(fixture.id);
      const materialized = await materializeSessionForIndex(fixture.index, indexedSession);
      assert.equal(materialized._shell, expected);
      assert.doesNotThrow(() => codex.validateCodexMaterializedPrivateState({
        indexedSession,
        session: materialized,
      }));
    });
  }
});

test('strict Codex Index retains no complete event graph and reconstructs exact current Sessions', async () => {
  const options = { repoRoot: FIXTURE_REPO, codexHome: FIXTURE_HOME };
  const resident = await codex.buildIndex(options);
  const transientSamples = [];
  const index = await codex.buildSourceBackedIndex({
    ...options,
    onTransientMemorySample: (sample) => transientSamples.push(sample),
  });

  assert.equal(validateIndexOwnership(index), 'codex');
  assert.equal(
    transientSamples.filter((sample) => sample.phase === 'post_finalize').length,
    index.sessions.length,
  );
  assert.ok(
    transientSamples.filter((sample) => sample.phase === 'pre_raw_compaction').length
      >= index.sessions.length,
  );
  assertNoReachableCompleteEventGraph(index);
  for (const indexedSession of index.sessions) {
    assert.equal(Object.hasOwn(indexedSession, 'rawEvents'), false);
    assert.equal(Object.hasOwn(indexedSession, 'logicalEvents'), false);
    assert.equal(Object.hasOwn(indexedSession, 'analysis'), false);
    assert.equal(Object.hasOwn(indexedSession, 'presentationIndexes'), false);

    const first = await materializeSessionForIndex(index, indexedSession);
    const second = await materializeSessionForIndex(index, indexedSession);
    const expected = resident.sessionsById.get(indexedSession.id);
    assert.notEqual(first, second);
    assert.deepEqual(second, first);
    assert.deepEqual(first.rawEvents, expected.rawEvents);
    assert.deepEqual(first.logicalEvents, expected.logicalEvents);
    assert.deepEqual(first.analysis, expected.analysis);
    assert.deepEqual(first.presentationIndexes, expected.presentationIndexes);
  }
});

test('trusted Codex materialization stays bounded away from unrelated Index collections', async () => {
  const index = await codex.buildSourceBackedIndex({
    repoRoot: FIXTURE_REPO,
    codexHome: FIXTURE_HOME,
  });
  const indexedSession = index.sessions[0];
  Object.defineProperty(index, 'sessions', {
    configurable: true,
    get() {
      throw new Error('unrelated Index corpus was inspected');
    },
  });

  const session = await materializeSessionForIndex(index, indexedSession);
  assert.equal(session.id, indexedSession.id);
});

test('Codex accepted-prefix materialization allows append and rejects every stale source class', async (t) => {
  await t.test('append beyond the accepted prefix is ignored', async (subtest) => {
    const fixture = await makeSingleSessionFixture(subtest);
    const indexedSession = fixture.index.sessionsById.get(fixture.id);
    const expected = await materializeSessionForIndex(fixture.index, indexedSession);
    await fsp.appendFile(fixture.file, `${JSON.stringify({
      timestamp: '2026-08-16T10:04:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'newer append' },
    })}\n`, 'utf8');
    assert.deepEqual(await materializeSessionForIndex(fixture.index, indexedSession), expected);
  });

  await t.test('rewrite inside the accepted prefix is stale', async (subtest) => {
    const fixture = await makeSingleSessionFixture(subtest);
    const rewritten = fixture.originalText.replace('hello strict lifecycle', 'jello strict lifecycle');
    assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(fixture.originalText));
    await fsp.writeFile(fixture.file, rewritten, 'utf8');
    await assert.rejects(
      materializeSessionForIndex(fixture.index, fixture.index.sessionsById.get(fixture.id)),
      { code: 'INDEXED_SOURCE_STALE' },
    );
  });

  await t.test('truncate is stale', async (subtest) => {
    const fixture = await makeSingleSessionFixture(subtest);
    await fsp.truncate(fixture.file, Math.floor(Buffer.byteLength(fixture.originalText) / 2));
    await assert.rejects(
      materializeSessionForIndex(fixture.index, fixture.index.sessionsById.get(fixture.id)),
      { code: 'INDEXED_SOURCE_STALE' },
    );
  });

  await t.test('missing source is stale', async (subtest) => {
    const fixture = await makeSingleSessionFixture(subtest);
    await fsp.rename(fixture.file, `${fixture.file}.missing`);
    await assert.rejects(
      materializeSessionForIndex(fixture.index, fixture.index.sessionsById.get(fixture.id)),
      { code: 'INDEXED_SOURCE_STALE' },
    );
  });

  await t.test('same-content source identity replacement is stale', async (subtest) => {
    const fixture = await makeSingleSessionFixture(subtest);
    const replacement = `${fixture.file}.replacement`;
    const displaced = `${fixture.file}.displaced`;
    await fsp.writeFile(replacement, fixture.originalText, 'utf8');
    await fsp.rename(fixture.file, displaced);
    await fsp.rename(replacement, fixture.file);
    await assert.rejects(
      materializeSessionForIndex(fixture.index, fixture.index.sessionsById.get(fixture.id)),
      { code: 'INDEXED_SOURCE_STALE' },
    );
  });
});

test('Codex reindex reuses only strict evidence and old copied metadata stays immutable', async (t) => {
  const fixture = await makeSingleSessionFixture(t, { title: 'Original copied title' });
  const firstSession = fixture.index.sessionsById.get(fixture.id);
  const firstDependency = fixture.index.materializationDependencies.get(
    firstSession.materializationDescriptor.dependencySetId,
  );
  const firstMaterialized = await materializeSessionForIndex(fixture.index, firstSession);
  let unchangedParseVerificationCount = 0;
  const unchanged = await codex.buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: fixture.index,
    beforeSourceSnapshotVerificationForTests: async () => {
      unchangedParseVerificationCount += 1;
    },
  });
  const unchangedSession = unchanged.sessionsById.get(fixture.id);

  assert.equal(unchanged.totals.reusedFileCount, 1);
  assert.equal(unchangedParseVerificationCount, 0);
  assert.equal(unchangedSession, firstSession);
  assert.equal(unchanged.projectQueryStore, fixture.index.projectQueryStore);
  assert.equal(unchanged.legacyRawOwners, fixture.index.legacyRawOwners);
  assert.equal(
    unchanged.materializationDependencies.get(
      unchangedSession.materializationDescriptor.dependencySetId,
    ),
    firstDependency,
  );
  const rebuiltMaterialized = await materializeSessionForIndex(unchanged, unchangedSession);
  assert.notEqual(rebuiltMaterialized, firstMaterialized);
  assert.deepEqual(rebuiltMaterialized, firstMaterialized);

  await fsp.writeFile(path.join(fixture.codexHome, 'session_index.jsonl'), `${JSON.stringify({
    id: fixture.id,
    thread_name: 'Reindexed copied title',
    updated_at: '2026-08-16T10:05:00.000Z',
  })}\n`, 'utf8');
  assert.equal(
    (await materializeSessionForIndex(fixture.index, firstSession)).title,
    'Original copied title',
  );
  const metadataChanged = await codex.buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
    previousIndex: unchanged,
  });
  const changedSession = metadataChanged.sessionsById.get(fixture.id);
  assert.notEqual(changedSession, firstSession);
  assert.equal(changedSession.title, 'Reindexed copied title');
  const changedDependency = metadataChanged.materializationDependencies.get(
    changedSession.materializationDescriptor.dependencySetId,
  );
  assert.notEqual(changedDependency, firstDependency);
  assert.deepEqual(changedDependency.entries[0], firstDependency.entries[0]);
  assert.notDeepEqual(changedDependency.entries[1], firstDependency.entries[1]);
  assert.equal((await materializeSessionForIndex(metadataChanged, changedSession)).title, 'Reindexed copied title');
});

test('Codex materialization observes pre-read and in-flight cancellation without mutating Index', async (t) => {
  const fixture = await makeSingleSessionFixture(t);
  const indexedSession = fixture.index.sessionsById.get(fixture.id);
  const before = JSON.stringify(indexedSession);
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(
    materializeSessionForIndex(fixture.index, indexedSession, { signal: preAborted.signal }),
    { name: 'AbortError' },
  );

  const inFlight = new AbortController();
  const pending = materializeSessionForIndex(fixture.index, indexedSession, {
    signal: inFlight.signal,
  });
  inFlight.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(JSON.stringify(indexedSession), before);
  assert.equal(fixture.index.sessionsById.get(fixture.id), indexedSession);
});
