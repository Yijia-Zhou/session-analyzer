'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_CONTRACT,
  validateCanonicalLogicalEventShape,
  validateCanonicalRawEventShape,
  validateCanonicalSessionShape,
} = require('../src/canonical-contract');
const { createSessionQuery } = require('../src/session-query');
const {
  buildEventDetailForSession,
  queryForIndex,
  readImagePreviewForSession,
  validateIndexOwnership,
} = require('../src/source-adapters');

function makeCanonicalIndex(sourceKind, options = {}) {
  const raw = {
    rawId: `${sourceKind}:raw:1`,
    sourceKind,
    timestamp: '2026-08-14T00:00:00.000Z',
    ...(options.rawLocator ? { sourceLocator: options.rawLocator } : {}),
  };
  const event = {
    id: `${sourceKind}:event:1`,
    sourceKind,
    kind: 'synthetic_event',
    layer: 'main',
    timestamp: raw.timestamp,
    rawRefs: [{ rawId: raw.rawId }],
    ...(options.eventLocator ? { sourceLocator: options.eventLocator } : {}),
  };
  const session = {
    id: `${sourceKind}:session:1`,
    sourceKind,
    rawEvents: [raw],
    logicalEvents: [event],
    counts: { messages: 0, toolCalls: 0, failedCommands: 0 },
    cwdSet: [],
  };
  return {
    sourceKind,
    repoRoot: '/synthetic/repository',
    sessions: [session],
    sessionsById: new Map([[session.id, session]]),
  };
}

test('Codex and Claude canonical synthetic indexes satisfy the same shared contract', () => {
  assert.deepEqual(CANONICAL_CONTRACT.index, ['sourceKind', 'repoRoot', 'sessions', 'sessionsById']);
  assert.deepEqual(CANONICAL_CONTRACT.session.slice(0, 4), ['id', 'sourceKind', 'rawEvents', 'logicalEvents']);
  assert.deepEqual(CANONICAL_CONTRACT.logicalEvent, [
    'id', 'sourceKind', 'kind', 'layer', 'timestamp', 'rawRefs',
  ]);

  for (const [sourceKind, locator] of [
    ['codex', { type: 'jsonl_line', file: 'codex.jsonl', line: 1 }],
    ['claude-code', { type: 'jsonl_line', file: 'claude.jsonl', line: 1 }],
  ]) {
    const index = makeCanonicalIndex(sourceKind, { rawLocator: locator, eventLocator: locator });
    assert.equal(validateIndexOwnership(index), sourceKind);
    const session = index.sessions[0];
    assert.equal(validateCanonicalSessionShape(session, sourceKind), sourceKind);
    assert.equal(validateCanonicalRawEventShape(session.rawEvents[0], sourceKind), sourceKind);
    assert.equal(validateCanonicalLogicalEventShape(session.logicalEvents[0], sourceKind), sourceKind);
  }
});

test('source-specific locator fields remain optional and opaque to the shared contract', () => {
  const index = makeCanonicalIndex('claude-code');
  assert.equal(validateIndexOwnership(index), 'claude-code');
  assert.equal(Object.hasOwn(index.sessions[0].rawEvents[0], 'sourceLocator'), false);
  assert.equal(Object.hasOwn(index.sessions[0].logicalEvents[0], 'sourceLocator'), false);
});

test('canonical index ownership rejects non-canonical sourceKind before query use', () => {
  const index = makeCanonicalIndex('codex');
  index.sourceKind = 'CODEX';

  assert.throws(
    () => validateIndexOwnership(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.throws(
    () => queryForIndex(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('canonical dispatch rejects whitespace-padded ownership without normalizing it', async () => {
  const index = makeCanonicalIndex('codex');
  index.sourceKind = ' codex ';

  assert.throws(
    () => queryForIndex(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const sessionIndex = makeCanonicalIndex('claude-code');
  sessionIndex.sessions[0].sourceKind = ' claude-code ';
  await assert.rejects(
    buildEventDetailForSession(
      sessionIndex,
      sessionIndex.sessions[0],
      sessionIndex.sessions[0].logicalEvents[0].id,
      'main',
    ),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('missing canonical index and session fields fail clearly', () => {
  const index = makeCanonicalIndex('codex');
  assert.throws(
    () => validateIndexOwnership({ ...index, repoRoot: '' }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const session = index.sessions[0];
  const missingEvents = { ...session };
  delete missingEvents.logicalEvents;
  const brokenIndex = {
    ...index,
    sessions: [missingEvents],
    sessionsById: new Map([[missingEvents.id, missingEvents]]),
  };
  assert.throws(
    () => validateIndexOwnership(brokenIndex),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('missing event ownership fails at shared query consumption instead of defaulting to Codex', () => {
  const index = makeCanonicalIndex('claude-code');
  delete index.sessions[0].logicalEvents[0].sourceKind;
  const query = createSessionQuery();

  assert.throws(
    () => query.getTimeline(index, index.sessions[0].id, {
      layer: 'main',
      offset: 0,
      limit: 10,
      q: '',
      locale: 'en',
    }),
    { code: 'MISSING_SOURCE_OWNERSHIP' },
  );
});

test('raw timeline and raw event lookup enforce index to session to raw ownership', () => {
  const index = makeCanonicalIndex('claude-code');
  index.sessions[0].rawEvents[0].sourceKind = 'codex';
  const query = createSessionQuery();

  assert.throws(
    () => query.getTimeline(index, index.sessions[0].id, {
      layer: 'raw',
      offset: 0,
      limit: 10,
      q: '',
      locale: 'en',
    }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
  assert.throws(
    () => query.getEvent(index, index.sessions[0].id, index.sessions[0].rawEvents[0].rawId, {
      layer: 'raw',
      locale: 'en',
    }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('logical timeline consumption enforces index to session to event ownership', () => {
  const index = makeCanonicalIndex('claude-code');
  index.sessions[0].logicalEvents[0].sourceKind = 'codex';
  const query = createSessionQuery();

  assert.throws(
    () => query.getTimeline(index, index.sessions[0].id, {
      layer: 'main',
      offset: 0,
      limit: 10,
      q: '',
      locale: 'en',
    }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('file suggestions reject a session owned by another source', () => {
  const index = makeCanonicalIndex('claude-code');
  index.sessions[0].sourceKind = 'codex';
  const query = createSessionQuery();

  assert.throws(
    () => query.fileSuggestions(index, { layer: 'main' }),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('canonical event ownership mismatches fail clearly', () => {
  const index = makeCanonicalIndex('codex');
  const event = index.sessions[0].logicalEvents[0];
  const raw = index.sessions[0].rawEvents[0];

  assert.throws(
    () => validateCanonicalLogicalEventShape(event, 'claude-code'),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
  assert.throws(
    () => validateCanonicalRawEventShape(raw, 'claude-code'),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('canonical logical and raw events require exact sourceKind spelling', () => {
  for (const [sourceKind, invalidSourceKind] of [
    ['codex', 'CODEX'],
    ['claude-code', 'Claude-Code'],
  ]) {
    const index = makeCanonicalIndex(sourceKind);
    const event = { ...index.sessions[0].logicalEvents[0], sourceKind: invalidSourceKind };
    const raw = { ...index.sessions[0].rawEvents[0], sourceKind: invalidSourceKind };

    assert.throws(
      () => validateCanonicalLogicalEventShape(event, sourceKind),
      { code: 'CANONICAL_CONTRACT_VIOLATION' },
    );
    assert.throws(
      () => validateCanonicalRawEventShape(raw, sourceKind),
      { code: 'CANONICAL_CONTRACT_VIOLATION' },
    );
  }

  for (const sourceKind of ['codex', 'claude-code']) {
    const index = makeCanonicalIndex(sourceKind);
    assert.equal(
      validateCanonicalLogicalEventShape(index.sessions[0].logicalEvents[0], sourceKind),
      sourceKind,
    );
    assert.equal(
      validateCanonicalRawEventShape(index.sessions[0].rawEvents[0], sourceKind),
      sourceKind,
    );
  }
});

test('canonical logical and raw events reject surrounding sourceKind whitespace', () => {
  for (const [sourceKind, invalidSourceKinds] of [
    ['codex', [' codex', 'codex ']],
    ['claude-code', [' claude-code ']],
  ]) {
    const index = makeCanonicalIndex(sourceKind);
    for (const invalidSourceKind of invalidSourceKinds) {
      const event = { ...index.sessions[0].logicalEvents[0], sourceKind: invalidSourceKind };
      const raw = { ...index.sessions[0].rawEvents[0], sourceKind: invalidSourceKind };

      assert.throws(
        () => validateCanonicalLogicalEventShape(event, sourceKind),
        { code: 'CANONICAL_CONTRACT_VIOLATION' },
      );
      assert.throws(
        () => validateCanonicalRawEventShape(raw, sourceKind),
        { code: 'CANONICAL_CONTRACT_VIOLATION' },
      );
    }
  }
});

test('accessor-backed sessions are not canonical-valid without explicit opt-in', () => {
  const index = makeCanonicalIndex('codex');
  Object.defineProperty(index, 'sessions', {
    configurable: true,
    get() {
      throw new Error('sessions getter must not be invoked');
    },
  });

  assert.throws(
    () => validateIndexOwnership(index),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
  assert.equal(
    validateIndexOwnership(index, { allowUninspectableSessions: true }),
    'codex',
  );
});

test('detail dispatch validates logical and raw ownership before adapter rendering', async () => {
  const logicalIndex = makeCanonicalIndex('claude-code');
  const logicalSession = logicalIndex.sessions[0];
  logicalSession.logicalEvents[0].sourceKind = 'codex';
  await assert.rejects(
    buildEventDetailForSession(
      logicalIndex,
      logicalSession,
      logicalSession.logicalEvents[0].id,
      'main',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const rawIndex = makeCanonicalIndex('claude-code');
  const rawSession = rawIndex.sessions[0];
  rawSession.rawEvents[0].sourceKind = 'codex';
  await assert.rejects(
    buildEventDetailForSession(
      rawIndex,
      rawSession,
      rawSession.rawEvents[0].rawId,
      'raw',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );
});

test('logical detail validates every referenced Raw Event before adapter rendering', async () => {
  const crossOwnedIndex = makeCanonicalIndex('claude-code');
  const crossOwnedSession = crossOwnedIndex.sessions[0];
  const foreignRaw = {
    ...makeCanonicalIndex('codex').sessions[0].rawEvents[0],
    rawId: 'codex:raw:foreign',
  };
  crossOwnedSession.rawEvents.push(foreignRaw);
  crossOwnedSession.logicalEvents[0].rawRefs.push({ rawId: foreignRaw.rawId });

  await assert.rejects(
    buildEventDetailForSession(
      crossOwnedIndex,
      crossOwnedSession,
      crossOwnedSession.logicalEvents[0].id,
      'main',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const missingRawIndex = makeCanonicalIndex('claude-code');
  const missingRawSession = missingRawIndex.sessions[0];
  missingRawSession.logicalEvents[0].rawRefs.push({ rawId: 'claude-code:raw:missing' });
  await assert.rejects(
    buildEventDetailForSession(
      missingRawIndex,
      missingRawSession,
      missingRawSession.logicalEvents[0].id,
      'main',
    ),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  const multiRawIndex = makeCanonicalIndex('claude-code');
  const multiRawSession = multiRawIndex.sessions[0];
  const secondRaw = {
    ...multiRawSession.rawEvents[0],
    rawId: 'claude-code:raw:2',
  };
  multiRawSession.rawEvents.push(secondRaw);
  multiRawSession.logicalEvents[0].rawRefs.push({ rawId: secondRaw.rawId });
  const detail = await buildEventDetailForSession(
    multiRawIndex,
    multiRawSession,
    multiRawSession.logicalEvents[0].id,
    'main',
  );
  assert.deepEqual(
    detail.rawRefs.map((reference) => reference.rawId),
    ['claude-code:raw:1', 'claude-code:raw:2'],
  );
});

test('image preview dispatch validates logical and raw ownership before adapter access', async () => {
  const logicalIndex = makeCanonicalIndex('codex');
  const logicalSession = logicalIndex.sessions[0];
  logicalSession.logicalEvents[0].sourceKind = 'claude-code';
  await assert.rejects(
    readImagePreviewForSession(
      logicalIndex,
      logicalSession,
      logicalSession.logicalEvents[0].id,
      'image-1-0',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const rawIndex = makeCanonicalIndex('codex');
  const rawSession = rawIndex.sessions[0];
  rawSession.rawEvents[0].sourceKind = 'claude-code';
  await assert.rejects(
    readImagePreviewForSession(
      rawIndex,
      rawSession,
      rawSession.logicalEvents[0].id,
      'image-1-0',
    ),
    { code: 'SOURCE_OWNERSHIP_MISMATCH' },
  );

  const missingRawIndex = makeCanonicalIndex('codex');
  const missingRawSession = missingRawIndex.sessions[0];
  missingRawSession.logicalEvents[0].rawRefs.push({ rawId: 'codex:raw:missing' });
  await assert.rejects(
    readImagePreviewForSession(
      missingRawIndex,
      missingRawSession,
      missingRawSession.logicalEvents[0].id,
      'image-1-0',
    ),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});

test('sessions and sessionsById must contain the same canonical Session set', () => {
  const index = makeCanonicalIndex('codex');
  const extra = makeCanonicalIndex('codex').sessions[0];
  extra.id = 'codex:session:extra';
  assert.throws(
    () => validateIndexOwnership({
      ...index,
      sessionsById: new Map([...index.sessionsById, [extra.id, extra]]),
    }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );

  assert.throws(
    () => validateIndexOwnership({ ...index, sessionsById: new Map() }),
    { code: 'CANONICAL_CONTRACT_VIOLATION' },
  );
});
