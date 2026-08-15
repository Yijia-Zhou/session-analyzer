'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildEventDetailForSession,
  conformStructuredLogicalDetail,
  getSourceAdapter,
  materializeSessionForIndex,
  readIndexedRawRecord,
  supportedSourceKinds,
  validateIndexOwnership,
} = require('../src/source-adapters');
const {
  DETAIL_PURPOSES,
  validateLogicalDetailEnvelope,
  validateStructuredLogicalDetailDto,
} = require('../src/shared/logical-detail-contract');
const { CANONICAL_SCHEMA_VERSION } = require('../src/shared/canonical-schema');

const CODEX_FIXTURE_HOME = path.join(__dirname, 'fixtures', 'codex-home');
const CODEX_FIXTURE_REPO = 'G:\\vibe\\term-agent';

function visitSections(sections, visitor) {
  for (const section of sections) {
    visitor(section);
    if (section.type === 'code_mode_tool_projection') {
      visitSections(section.requestSections, visitor);
      visitSections(section.resultSections, visitor);
    }
  }
}

async function buildClaudeFixtureIndex(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-conformance-claude-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  const projectDir = path.join(home, 'projects', '-conformance-fixture');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(projectDir, { recursive: true });
  for (const fixtureName of ['semantic-lifecycle.jsonl', 'detail-responsibility-archetypes.jsonl']) {
    const source = await fsp.readFile(
      path.join(__dirname, 'fixtures', 'claude', fixtureName),
      'utf8',
    );
    await fsp.writeFile(
      path.join(projectDir, fixtureName),
      source.replaceAll('__REPO_ROOT__', repoRoot.replaceAll('\\', '\\\\')),
      'utf8',
    );
  }
  return getSourceAdapter('claude-code').buildIndex({ repoRoot, sourceHome: home });
}

async function buildCodeModeFixtureIndex(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-conformance-code-mode-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  const sessionId = '97979797-9797-4797-8797-979797979797';
  const sessionDir = path.join(home, 'sessions', '2026', '07', '15');
  const source = await fsp.readFile(
    path.join(__dirname, 'fixtures', 'code-mode', 'structured-declared-sequential.jsonl'),
    'utf8',
  );
  const meta = JSON.stringify({
    timestamp: '2026-07-15T00:00:00.000Z',
    type: 'session_meta',
    payload: { id: sessionId, cwd: repoRoot, originator: 'codex_cli' },
  });
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(
    path.join(sessionDir, `rollout-2026-07-15T00-00-00-${sessionId}.jsonl`),
    `${meta}\n${source}`,
    'utf8',
  );
  return getSourceAdapter('codex').buildIndex({ repoRoot, sourceHome: home });
}

async function assertAdapterIndexConforms(index, expectedPurposes) {
  assert.equal(validateIndexOwnership(index), index.sourceKind);
  const purposes = new Set();
  let detailCount = 0;
  let fallbackCount = 0;
  let fallbackReadbackVerified = false;

  for (const indexedSession of index.sessions) {
    const session = await materializeSessionForIndex(index, indexedSession);
    for (const event of session.logicalEvents) {
      const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
      assert.ok(detail, `${index.sourceKind} must hydrate ${event.id}`);
      assert.equal(validateStructuredLogicalDetailDto(detail), detail);
      assert.equal(validateLogicalDetailEnvelope(detail, event), detail);
      assert.deepEqual(detail.rawRefs, event.rawRefs);
      assert.equal(
        detail.timelineSections.some((section) => section.type === 'raw_json'),
        false,
        `${event.id} primary detail must not contain inline fallback JSON`,
      );
      detailCount += 1;
      let detailHasFallback = false;
      visitSections([...detail.timelineSections, ...detail.inspectorSections], (section) => {
        assert.ok(DETAIL_PURPOSES.includes(section.purpose), `${event.id} has purpose ${section.purpose}`);
        purposes.add(section.purpose);
        if (section.purpose === 'fallback') {
          fallbackCount += 1;
          detailHasFallback = true;
        }
        if (section.type === 'raw_json') {
          assert.equal(section.purpose, 'fallback');
          assert.equal(section.expanded, false);
          assert.doesNotMatch(section.title || '', /\braw\b/i);
        }
      });
      if (!fallbackReadbackVerified && detailHasFallback) {
        assert.ok(detail.rawRefs.length > 0, `${event.id} fallback must retain canonical Raw references`);
        for (const rawRef of detail.rawRefs) {
          const fallbackRaw = await readIndexedRawRecord(index, session, rawRef.rawId);
          assert.ok(fallbackRaw, `${event.id} fallback Raw reference ${rawRef.rawId} must remain readable`);
          assert.equal(fallbackRaw.rawId, rawRef.rawId);
          assert.equal(fallbackRaw.sourceKind, index.sourceKind);
        }
        fallbackReadbackVerified = true;
      }
    }

    for (const raw of session.rawEvents.slice(0, 1)) {
      const readback = await readIndexedRawRecord(index, session, raw.rawId);
      assert.ok(readback, `${index.sourceKind} must read back ${raw.rawId}`);
      assert.equal(readback.rawId, raw.rawId);
      assert.equal(readback.sourceKind, index.sourceKind);
    }
  }

  assert.ok(detailCount > 0, `${index.sourceKind} fixture must expose logical details`);
  assert.equal(
    fallbackReadbackVerified,
    fallbackCount > 0,
    `${index.sourceKind} conditional fallback must remain traceable to Raw`,
  );
  assert.deepEqual(
    DETAIL_PURPOSES.filter((purpose) => purposes.has(purpose)),
    expectedPurposes,
  );
}

const RESPONSIBILITY_ARCHETYPES = Object.freeze([
  {
    id: 'readable-user-message',
    label: 'readable user message',
    matchEvent: (event) => event.kind === 'user_message' && Boolean(String(event.preview || '').trim()),
    primaryAll: ['content'],
    supplementalNone: ['content', 'fallback'],
  },
  {
    id: 'readable-assistant-message',
    label: 'readable assistant message',
    matchEvent: (event) => event.kind === 'assistant_message' && Boolean(String(event.preview || '').trim()),
    primaryAll: ['content'],
    supplementalNone: ['content', 'fallback'],
  },
  {
    id: 'completed-command',
    label: 'completed command',
    matchEvent: (event) => event.kind === 'command'
      && ['success', 'failed', 'completed'].includes(event.status),
    primaryAll: ['request', 'result'],
    primaryNone: ['context', 'traceability', 'fallback'],
    supplementalAll: ['request', 'context'],
  },
  {
    id: 'modeled-file-change',
    label: 'modeled file change',
    matchEvent: (event) => event.kind === 'patch'
      && ['success', 'failed', 'completed'].includes(event.status),
    primaryAny: ['request', 'result'],
    supplementalAny: ['request', 'context'],
    allNone: ['fallback'],
  },
  {
    id: 'mcp-operation',
    label: 'MCP operation',
    matchEvent: (event) => event.kind === 'mcp_call',
    primaryAny: ['request', 'result'],
    supplementalAll: ['request'],
    allNone: ['fallback'],
  },
  {
    id: 'completed-web-operation',
    label: 'completed web operation',
    matchEvent: (event) => event.kind === 'web_search'
      && ['success', 'failed', 'completed'].includes(event.status),
    supplementalAll: ['result'],
    allNone: ['fallback'],
  },
  {
    id: 'readable-plan-update',
    label: 'readable plan update',
    matchEvent: (event) => event.kind === 'plan_update' && Boolean(String(event.preview || '').trim()),
    primaryAll: ['content'],
    supplementalNone: ['content', 'fallback'],
  },
]);

const ARCHETYPE_BY_ID = new Map(RESPONSIBILITY_ARCHETYPES.map((archetype) => [archetype.id, archetype]));

function findArchetypeOwners(index, archetype) {
  const owners = [];
  for (const session of index.sessions) {
    for (const event of session.logicalEvents) {
      if (archetype.matchEvent(event)) owners.push({ session, event });
    }
  }
  return owners;
}

function assertPurposeRule(actual, required, mode, message) {
  const expected = Array.isArray(required) ? required : [];
  if (!expected.length) return;
  if (mode === 'all') {
    assert.ok(expected.every((purpose) => actual.has(purpose)), message);
  } else if (mode === 'any') {
    assert.ok(expected.some((purpose) => actual.has(purpose)), message);
  } else {
    assert.ok(expected.every((purpose) => !actual.has(purpose)), message);
  }
}

async function detailForFixtureOwner(fixture, owner) {
  if (fixture.buildDetail) return fixture.buildDetail(owner);
  return buildEventDetailForSession(
    fixture.index,
    owner.session,
    owner.event.id,
    owner.event.layer,
  );
}

function assertResponsibilityArchetype(detail, fixture, archetype, owner) {
  const primaryPurposes = new Set(detail.timelineSections.map((section) => section.purpose));
  const supplementalPurposes = new Set(detail.inspectorSections.map((section) => section.purpose));
  const allPurposes = new Set([...primaryPurposes, ...supplementalPurposes]);
  const context = `${fixture.kind} ${archetype.label} ${owner.event.id}`;

  assertPurposeRule(primaryPurposes, archetype.primaryAll, 'all', `${context} must keep required purposes primary`);
  assertPurposeRule(primaryPurposes, archetype.primaryAny, 'any', `${context} must keep one readable purpose primary`);
  assertPurposeRule(primaryPurposes, archetype.primaryNone, 'none', `${context} must not promote supplemental purposes`);
  assertPurposeRule(supplementalPurposes, archetype.supplementalAll, 'all', `${context} must keep required purposes supplemental`);
  assertPurposeRule(supplementalPurposes, archetype.supplementalAny, 'any', `${context} must keep one inspection purpose supplemental`);
  assertPurposeRule(supplementalPurposes, archetype.supplementalNone, 'none', `${context} must not duplicate primary purposes into supplemental detail`);
  assertPurposeRule(allPurposes, archetype.allNone, 'none', `${context} must not use modeled fallback`);
}

async function assertConditionalResponsibilityArchetypes(fixture) {
  for (const archetype of RESPONSIBILITY_ARCHETYPES) {
    const owners = findArchetypeOwners(fixture.index, archetype);
    for (const owner of owners) {
      const detail = await detailForFixtureOwner(fixture, owner);
      assert.ok(detail, `${fixture.kind} must hydrate ${owner.event.id}`);
      assertResponsibilityArchetype(detail, fixture, archetype, owner);
    }
  }
}

function expectedArchetypeOwner(fixture, archetype, binding) {
  const owners = [];
  for (const session of fixture.index.sessions) {
    for (const event of session.logicalEvents) {
      const owner = { session, event };
      if (binding.eventId ? event.id === binding.eventId : binding.matchOwner?.(owner)) owners.push(owner);
    }
  }
  assert.equal(owners.length, 1, `${fixture.kind} fixture coverage ${archetype.id} must resolve exactly one event`);
  assert.equal(
    archetype.matchEvent(owners[0].event),
    true,
    `${fixture.kind} fixture coverage ${archetype.id} must bind an event in that shared scenario`,
  );
  return owners[0];
}

async function assertExpectedArchetypeCoverage(fixture) {
  // expectedArchetypes describes fixture coverage, not source capabilities.
  for (const [archetypeId, binding] of Object.entries(fixture.expectedArchetypes || {})) {
    const archetype = ARCHETYPE_BY_ID.get(archetypeId);
    assert.ok(archetype, `${fixture.kind} fixture declares unknown archetype ${archetypeId}`);
    const owner = expectedArchetypeOwner(fixture, archetype, binding);
    const detail = await detailForFixtureOwner(fixture, owner);
    assert.ok(detail, `${fixture.kind} fixture coverage must hydrate ${owner.event.id}`);
    assertResponsibilityArchetype(detail, fixture, archetype, owner);

    const evidencePredicate = binding.fullRequestEvidence;
    if (evidencePredicate) {
      assert.equal(
        detail.timelineSections.some(evidencePredicate),
        false,
        `${fixture.kind} ${archetype.label} full request evidence must not be primary`,
      );
      assert.equal(
        detail.inspectorSections.some(evidencePredicate),
        true,
        `${fixture.kind} ${archetype.label} full request evidence must be supplemental`,
      );
    }
  }
}

async function assertResponsibilityFixture(fixture) {
  let materializedFixture = fixture;
  if (!fixture.buildDetail) {
    const sessions = [];
    for (const indexedSession of fixture.index.sessions) {
      sessions.push(await materializeSessionForIndex(fixture.index, indexedSession));
    }
    materializedFixture = {
      ...fixture,
      index: {
        ...fixture.index,
        sessions,
        sessionsById: new Map(sessions.map((session) => [session.id, session])),
      },
    };
  }
  await assertConditionalResponsibilityArchetypes(materializedFixture);
  await assertExpectedArchetypeCoverage(materializedFixture);
}

test('all registered adapters satisfy one source-neutral detail and Raw readback suite', async (t) => {
  assert.deepEqual(supportedSourceKinds(), ['codex', 'claude-code']);
  const fixtures = [
    {
      kind: 'codex',
      index: await getSourceAdapter('codex').buildIndex({
        repoRoot: CODEX_FIXTURE_REPO,
        sourceHome: CODEX_FIXTURE_HOME,
      }),
      expectedArchetypes: {
        'readable-user-message': {
          eventId: '11111111-1111-1111-1111-111111111111:logical:user:7',
        },
        'readable-assistant-message': {
          eventId: '11111111-1111-1111-1111-111111111111:logical:assistant:12',
        },
        'completed-command': {
          eventId: '11111111-1111-1111-1111-111111111111:logical:call:call-shell-1',
          fullRequestEvidence: (section) => section?.value?.timeout_ms === 1000,
        },
        'modeled-file-change': {
          eventId: '11111111-1111-1111-1111-111111111111:logical:call:call-patch-new',
        },
        'mcp-operation': {
          eventId: '11111111-1111-1111-1111-111111111111:logical:call:call-mcp-begin-only',
          fullRequestEvidence: (section) => section?.value?.arguments?.query === 'fixture',
        },
        'completed-web-operation': {
          matchOwner: ({ event }) => event.id.includes(':logical:web_search:')
            && String(event.preview || '').includes('ws-fixture-1'),
        },
        'readable-plan-update': {
          matchOwner: ({ event }) => event.kind === 'plan_update'
            && event.subtype === 'plan_update'
            && event.preview === 'Protocol plan update fixture',
        },
      },
    },
    {
      kind: 'claude-code',
      index: await buildClaudeFixtureIndex(t),
      expectedArchetypes: {
        'readable-user-message': {
          matchOwner: ({ event }) => event.preview === 'CONVERSATION_PRIMARY_SENTINEL',
        },
        'readable-assistant-message': {
          matchOwner: ({ event }) => event.preview === 'ASSISTANT_PRIMARY_SENTINEL',
        },
        'completed-command': {
          matchOwner: ({ event }) => event.kind === 'command'
            && event.subtype === 'Bash'
            && event.preview === 'npm test',
          fullRequestEvidence: (section) => section?.value?.description === 'Run tests',
        },
        'modeled-file-change': {
          matchOwner: ({ event }) => event.id.endsWith(':call-responsibility-patch'),
        },
        'mcp-operation': {
          matchOwner: ({ event }) => event.id.endsWith(':call-responsibility-mcp'),
          fullRequestEvidence: (section) => section?.value?.query === 'MCP_SUPPLEMENTAL_SENTINEL',
        },
        'completed-web-operation': {
          matchOwner: ({ event }) => event.id.endsWith(':call-responsibility-web'),
        },
        'readable-plan-update': {
          matchOwner: ({ event }) => event.kind === 'plan_update'
            && event.preview === '2 tasks · 1 completed · 1 pending',
        },
      },
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.kind, () => assertAdapterIndexConforms(
      fixture.index,
      fixture.kind === 'codex'
        ? ['content', 'request', 'result', 'context', 'fallback']
        : ['content', 'request', 'result', 'context'],
    ));
    await t.test(`${fixture.kind} conditional responsibility scenarios`, () => (
      assertResponsibilityFixture(fixture)
    ));
  }
});

function syntheticResponsibilityFixture({ expectedArchetypes = {}, events = [], details = {} } = {}) {
  return {
    kind: 'synthetic-future-source',
    index: {
      sourceKind: 'synthetic-future-source',
      sessions: [{ id: 'synthetic-session', logicalEvents: events }],
    },
    expectedArchetypes,
    buildDetail: async ({ event }) => details[event.id],
  };
}

test('responsibility conformance separates conditional semantics from fixture coverage', async (t) => {
  const readableUserEvent = {
    id: 'synthetic-user',
    kind: 'user_message',
    layer: 'main',
    preview: 'Synthetic readable user message',
  };
  const readableUserDetail = {
    timelineSections: [{ purpose: 'content', type: 'markdown', text: 'Synthetic readable user message' }],
    inspectorSections: [],
  };
  const sparseFixture = syntheticResponsibilityFixture({
    events: [readableUserEvent],
    details: { [readableUserEvent.id]: readableUserDetail },
    expectedArchetypes: {
      'readable-user-message': { eventId: readableUserEvent.id },
    },
  });

  await t.test('a sparse future-source fixture need not expose MCP or plan updates', () => (
    assertResponsibilityFixture(sparseFixture)
  ));

  await t.test('declared fixture coverage fails when its MCP scenario is absent', async () => {
    const missingCoverage = {
      ...sparseFixture,
      expectedArchetypes: {
        ...sparseFixture.expectedArchetypes,
        'mcp-operation': { eventId: 'missing-mcp' },
      },
    };
    await assert.rejects(
      assertResponsibilityFixture(missingCoverage),
      /fixture coverage mcp-operation must resolve exactly one event/,
    );
  });

  await t.test('an undeclared but present MCP scenario still enforces shared responsibility', async () => {
    const mcpEvent = {
      id: 'synthetic-mcp',
      kind: 'mcp_call',
      layer: 'main',
      preview: 'Synthetic MCP request',
    };
    const invalidMcp = syntheticResponsibilityFixture({
      events: [readableUserEvent, mcpEvent],
      details: {
        [readableUserEvent.id]: readableUserDetail,
        [mcpEvent.id]: {
          timelineSections: [{ purpose: 'context', type: 'notice', message: 'Wrong responsibility' }],
          inspectorSections: [],
        },
      },
      expectedArchetypes: sparseFixture.expectedArchetypes,
    });
    await assert.rejects(
      assertResponsibilityFixture(invalidMcp),
      /must keep one readable purpose primary/,
    );
  });
});

test('Code Mode composites carry outer content and renderer-local request/result/traceability purposes', async (t) => {
  const index = await buildCodeModeFixtureIndex(t);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const event = session.logicalEvents.find((candidate) => candidate.kind === 'code_mode_operation');
  assert.ok(event);
  const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
  const purposes = new Set();
  const composites = [];
  visitSections([...detail.timelineSections, ...detail.inspectorSections], (section) => {
    purposes.add(section.purpose);
    if (section.type === 'code_mode_tool_projection') composites.push(section);
  });

  assert.ok(composites.length >= 2);
  assert.ok(composites.every((section) => section.purpose === 'content'));
  assert.ok(composites.every((section) => section.requestSections.every((child) => child.purpose === 'request')));
  assert.ok(composites.every((section) => section.resultSections.every((child) => child.purpose === 'result')));
  assert.equal(purposes.has('traceability'), true);
});

function eventFixture() {
  return {
    id: 'fixture-event',
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    sourceKind: 'fixture-source',
    kind: 'other_tool_call',
    subtype: 'fixture',
    layer: 'main',
    sourceLocator: { storage: 'fixture', cursor: 'event' },
    rawRefs: [
      { rawId: 'raw-1', sourceKind: 'fixture-source' },
      { rawId: 'raw-2', sourceKind: 'fixture-source' },
    ],
  };
}

function detailFixture(event = eventFixture()) {
  return {
    id: event.id,
    schemaVersion: event.schemaVersion,
    sourceKind: event.sourceKind,
    kind: event.kind,
    subtype: event.subtype,
    layer: event.layer,
    title: 'Fixture',
    sourceLocator: event.sourceLocator,
    meta: {},
    rawRefs: event.rawRefs,
    timelineSections: [{ purpose: 'request', type: 'code', code: 'echo ok' }],
    inspectorSections: [{ purpose: 'result', type: 'terminal', text: 'ok' }],
  };
}

test('shared adapter boundary rejects envelope drift and malformed structured renderer payloads', () => {
  const event = eventFixture();
  const invalidDetails = [
    { mutate(detail) { detail.id = 'other'; }, path: 'detail.id' },
    { mutate(detail) { detail.sourceLocator = { storage: 'other' }; }, path: 'detail.sourceLocator' },
    { mutate(detail) { detail.rawRefs = [...detail.rawRefs].reverse(); }, path: 'detail.rawRefs' },
    { mutate(detail) { delete detail.timelineSections[0].purpose; }, path: 'purpose' },
    { mutate(detail) { detail.timelineSections[0].type = 'unknown_renderer'; }, path: 'type' },
    { mutate(detail) { detail.timelineSections[0].payload = {}; }, path: 'payload' },
  ];

  for (const invalid of invalidDetails) {
    const detail = detailFixture(event);
    invalid.mutate(detail);
    assert.throws(
      () => conformStructuredLogicalDetail(detail, event),
      (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
        && error.message.includes(invalid.path),
    );
  }

  const accessor = detailFixture(event);
  Object.defineProperty(accessor.meta, 'unsafe', { enumerable: true, get() { return 'secret'; } });
  assert.throws(
    () => conformStructuredLogicalDetail(accessor, event),
    (error) => error.code === 'LOGICAL_DETAIL_CONTRACT_VIOLATION'
      && /must be a data property/.test(error.message),
  );
});
