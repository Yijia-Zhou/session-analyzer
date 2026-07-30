'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildEventDetail,
  buildIndex,
  getTimeline,
} = require('../src/codex');
const navigation = require('../src/browser/navigation');
const planFacet = require('../src/shared/plan-facet');

const {
  PLAN_EVENT_CATEGORY,
  isPlanArtifactEvent,
  isPlanEvent,
  isPlanUpdateEvent,
  planCategoryForEvent,
  planFacetForEvent,
} = planFacet;

const admitted = [
  {
    name: 'proposed plan artifact',
    event: { kind: 'proposed_plan', subtype: 'proposed_plan', toolName: '' },
    category: PLAN_EVENT_CATEGORY.ARTIFACT,
  },
  {
    name: 'direct update_plan',
    event: { kind: 'other_tool_call', subtype: 'update_plan', toolName: 'update_plan' },
    category: PLAN_EVENT_CATEGORY.UPDATE,
  },
  {
    name: 'observed nested update_plan',
    event: {
      kind: 'other_tool_call',
      subtype: 'update_plan',
      toolName: 'update_plan',
      presentationContext: {
        relation: 'enclosed_by_code_mode_operation',
        codeModeParentId: 'parent-operation',
      },
    },
    category: PLAN_EVENT_CATEGORY.UPDATE,
  },
  {
    name: 'protocol plan_update',
    event: { kind: 'plan_update', subtype: 'plan_update', toolName: '' },
    category: PLAN_EVENT_CATEGORY.UPDATE,
  },
  {
    name: 'protocol plan_delta',
    event: { kind: 'plan_update', subtype: 'plan_delta', toolName: '' },
    category: PLAN_EVENT_CATEGORY.UPDATE,
  },
];

test('Plan facet admits exact normalized combinations with immutable semantic categories', () => {
  assert.ok(Object.isFrozen(PLAN_EVENT_CATEGORY));
  const artifactFacet = planFacetForEvent(admitted[0].event);
  const updateFacet = planFacetForEvent(admitted[1].event);
  assert.ok(Object.isFrozen(artifactFacet));
  assert.ok(Object.isFrozen(updateFacet));

  for (const entry of admitted) {
    const facet = planFacetForEvent({ ...entry.event, label: 'Localized display label' });
    assert.deepEqual(facet, { category: entry.category }, entry.name);
    assert.equal(planCategoryForEvent(entry.event), entry.category, entry.name);
    assert.equal(isPlanEvent(entry.event), true, entry.name);
    assert.equal(isPlanArtifactEvent(entry.event), entry.category === PLAN_EVENT_CATEGORY.ARTIFACT, entry.name);
    assert.equal(isPlanUpdateEvent(entry.event), entry.category === PLAN_EVENT_CATEGORY.UPDATE, entry.name);
  }

  assert.strictEqual(planFacetForEvent(admitted[0].event), artifactFacet);
  for (const entry of admitted.slice(1)) {
    assert.strictEqual(planFacetForEvent(entry.event), updateFacet, entry.name);
  }
});

test('Plan facet rejects incomplete, label-only, conflicting, and presentation-only lookalikes', () => {
  const rejected = [
    null,
    [],
    {},
    { label: 'update_plan' },
    { kind: 'proposed_plan' },
    { kind: 'proposed_plan', subtype: 'proposed_plan', toolName: 'update_plan' },
    { kind: 'other_tool_call', subtype: 'update_plan' },
    { kind: 'other_tool_call', toolName: 'update_plan' },
    { kind: 'other_tool_call', subtype: 'plan_delta', toolName: 'update_plan' },
    { kind: 'plan_update' },
    { kind: 'plan_update', subtype: 'plan_update', toolName: 'update_plan' },
    { kind: 'plan_update', subtype: 'future_plan_shape', toolName: '' },
    {
      kind: 'code_mode_operation',
      subtype: 'exec',
      toolName: 'exec',
      presentationFacts: {
        codeModeDeclaredRequests: {
          toolNames: ['update_plan'],
          requestEvidence: 'declared_source',
        },
      },
    },
  ];

  for (const event of rejected) {
    assert.equal(planFacetForEvent(event), null);
    assert.equal(planCategoryForEvent(event), '');
    assert.equal(isPlanEvent(event), false);
    assert.equal(isPlanArtifactEvent(event), false);
    assert.equal(isPlanUpdateEvent(event), false);
  }
});

async function makeCodexHome(t, prefix) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  return codexHome;
}

async function writeSession(codexHome, repoRoot, id, records) {
  const dir = path.join(codexHome, 'sessions', '2026', '07', '31');
  await fsp.mkdir(dir, { recursive: true });
  const sessionRecords = [
    { type: 'session_meta', timestamp: '2026-07-31T00:00:00.000Z', payload: { id, cwd: repoRoot } },
    ...records,
  ];
  await fsp.writeFile(
    path.join(dir, `rollout-${id}.jsonl`),
    `${sessionRecords.map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
}

async function readCodeModeFixture(fileName) {
  const fixturePath = path.join(__dirname, 'fixtures', 'code-mode', fileName);
  const text = await fsp.readFile(fixturePath, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test('isolated and mirrored proposed-plan Raw Record forms converge on one Plan Artifact', async (t) => {
  const codexHome = await makeCodexHome(t, 'session-analyzer-plan-artifacts-');
  const repoRoot = path.join(codexHome, 'repo');
  const cases = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      records: [
        {
          type: 'event_msg',
          timestamp: '2026-07-31T00:00:01.000Z',
          payload: { type: 'item_completed', item: { type: 'Plan', id: 'plan-item', text: '# Item plan\nInspect item form.' } },
        },
      ],
      rawRefCount: 1,
      detailText: /Inspect item form/,
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      records: [
        {
          type: 'response_item',
          timestamp: '2026-07-31T00:00:01.000Z',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '<proposed_plan>\n# Message plan\nInspect message form.\n</proposed_plan>' }] },
        },
      ],
      rawRefCount: 1,
      detailText: /Inspect message form/,
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      records: [
        {
          type: 'event_msg',
          timestamp: '2026-07-31T00:00:01.000Z',
          payload: { type: 'item_completed', item: { type: 'Plan', id: 'plan-mirror', text: '# Mirrored plan\nInspect mirrored form.' } },
        },
        {
          type: 'response_item',
          timestamp: '2026-07-31T00:00:02.000Z',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '<proposed_plan>\n# Mirrored plan\nInspect mirrored form.\n</proposed_plan>' }] },
        },
      ],
      rawRefCount: 2,
      detailText: /Inspect mirrored form/,
    },
  ];

  for (const entry of cases) await writeSession(codexHome, repoRoot, entry.id, entry.records);
  const index = await buildIndex({ repoRoot, codexHome });

  for (const entry of cases) {
    const session = index.sessionsById.get(entry.id);
    const artifacts = session.logicalEvents.filter((event) => isPlanArtifactEvent(event));
    assert.equal(artifacts.length, 1, entry.id);
    assert.equal(artifacts[0].rawRefs.length, entry.rawRefCount, entry.id);
    assert.equal(session.counts.planArtifacts, 1, entry.id);
    assert.equal(session.counts.planEvents, 1, entry.id);
    const detail = buildEventDetail(session, artifacts[0].id, 'main');
    assert.equal(detail.timelineSections[0].type, 'markdown', entry.id);
    assert.match(detail.timelineSections[0].html, entry.detailText, entry.id);
  }
});

test('Code Mode declarations and projections add no Plan membership or count', async (t) => {
  const codexHome = await makeCodexHome(t, 'session-analyzer-plan-code-mode-');
  const repoRoot = path.join(codexHome, 'repo');
  const id = '20000000-0000-4000-8000-000000000001';
  await writeSession(codexHome, repoRoot, id, [
    {
      type: 'response_item',
      timestamp: '2026-07-31T00:00:01.000Z',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'exec-declared-only',
        turn_id: 'turn-plan',
        input: 'const plan = await tools.update_plan({ plan: [] }); text(plan);',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-07-31T00:00:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-declared-only',
        turn_id: 'turn-plan',
        output: 'Script completed\n{}',
      },
    },
  ]);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operations = session.logicalEvents.filter((event) => event.kind === 'code_mode_operation');
  const updates = session.logicalEvents.filter((event) => isPlanUpdateEvent(event));
  assert.equal(operations.length, 1);
  assert.equal(updates.length, 0);
  assert.equal(session.counts.planArtifacts, 0);
  assert.equal(session.counts.planEvents, 0);
  assert.deepEqual(operations[0].codeModeOperation.eventRefs, []);

  const timeline = getTimeline(index, id, {
    layer: 'main',
    offset: 0,
    limit: 100,
    locale: 'en',
  });
  const publicOperations = timeline.events.filter((event) => event.kind === 'code_mode_operation');
  assert.equal(publicOperations.every((event) => !isPlanEvent(event)), true);
  assert.deepEqual(publicOperations[0].presentationFacts, {
    codeModeDeclaredRequests: {
      toolNames: ['update_plan'],
      requestEvidence: 'declared_source',
    },
  });
});

test('observed nested update_plan lifecycle keeps child-owned Plan membership end to end', async (t) => {
  const codexHome = await makeCodexHome(t, 'session-analyzer-plan-observed-nested-');
  const repoRoot = path.join(codexHome, 'repo');
  const id = '30000000-0000-4000-8000-000000000001';
  const records = await readCodeModeFixture('observed-update-plan.jsonl');
  await writeSession(codexHome, repoRoot, id, records);

  const index = await buildIndex({ repoRoot, codexHome });
  const session = index.sessionsById.get(id);
  const operation = session.logicalEvents.find((event) => event.kind === 'code_mode_operation');
  const update = session.logicalEvents.find((event) => (
    event.kind === 'other_tool_call'
    && event.subtype === 'update_plan'
    && event.toolName === 'update_plan'
  ));

  assert.ok(operation);
  assert.ok(update);
  assert.deepEqual(operation.codeModeOperation.eventRefs, [update.id]);
  assert.deepEqual(
    update.rawRefs.map((rawRef) => rawRef.sourceEventType),
    ['dynamic_tool_call_begin', 'dynamic_tool_call_end'],
  );
  assert.equal(isPlanEvent(operation), false);
  assert.equal(isPlanUpdateEvent(update), true);
  assert.deepEqual(session.logicalEvents.filter(isPlanEvent).map((event) => event.id), [update.id]);
  assert.equal(session.counts.planArtifacts, 0);
  assert.equal(session.counts.planEvents, 1);

  const timeline = getTimeline(index, id, {
    layer: 'main',
    offset: 0,
    limit: 100,
    locale: 'en',
  });
  const publicOperation = timeline.events.find((event) => event.id === operation.id);
  const publicUpdate = timeline.events.find((event) => event.id === update.id);
  assert.deepEqual(publicOperation.presentationFacts, {
    codeModeDeclaredRequests: {
      toolNames: ['update_plan'],
      requestEvidence: 'declared_source',
    },
  });
  assert.deepEqual(publicUpdate.presentationContext, {
    relation: 'enclosed_by_code_mode_operation',
    codeModeParentId: operation.id,
  });
  assert.equal(isPlanEvent(publicOperation), false);
  assert.deepEqual(
    navigation.navigationCategoriesForEvent(publicUpdate, timeline.events).map((category) => category.id),
    ['update_plan', 'plans'],
  );
  assert.equal(
    navigation.navigationCategoriesForEvent(publicOperation, timeline.events)
      .some((category) => ['update_plan', 'plans'].includes(category.id)),
    false,
  );
});
