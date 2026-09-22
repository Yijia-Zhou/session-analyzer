'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildDeepSeekIndex } = require('../src/deepseek-harness');
const {
  buildEventDetailForSession,
  materializeSessionForIndex,
  validateIndexOwnershipForCommit,
} = require('../src/source-adapters');
const { validateStructuredLogicalDetailDto } = require('../src/shared/logical-detail-contract');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'deepseek-harness-phase2b', 'sessions');
const CODE_REPO = '/synthetic/deepseek-phase2b-code';
const WORKFLOW_REPO = '/synthetic/deepseek-phase2b-workflow';

async function buildFor(repoRoot) {
  const index = await buildDeepSeekIndex({ sourceHome: FIXTURE_ROOT, repoRoot });
  await validateIndexOwnershipForCommit(index);
  const materialized = await materializeSessionForIndex(index, index.sessions[0]);
  return { index, materialized };
}

test('DeepSeek Code Mode detail links exact Main nested members and direct owners', async () => {
  const { index, materialized } = await buildFor(CODE_REPO);
  const outer = materialized.logicalEvents.find((event) => (
    event.kind === 'code_mode_operation'
    && event.codeModeOperation?.outerCallId === 'outer-nested'
  ));
  const dispatches = outer.codeModeOperation.dispatches;
  const outerDetail = await buildEventDetailForSession(index, materialized, outer.id, 'main');
  validateStructuredLogicalDetailDto(outerDetail);
  const members = outerDetail.inspectorSections.find((section) => section.title === 'Observed nested activity');
  assert.deepEqual(members.items.map((item) => item.layer), ['main', 'main']);
  assert.deepEqual(members.items.map((item) => item.id), outer.codeModeOperation.eventRefs);
  assert.ok(members.items.every((item) => item.id !== dispatches[0].parentEventId));

  const childDetail = await buildEventDetailForSession(
    index,
    materialized,
    dispatches[0].eventId,
    'main',
  );
  const childOwner = childDetail.inspectorSections.find((section) => section.title === 'Owning Code Mode activity');
  assert.deepEqual(childOwner.items.map((item) => ({ id: item.id, layer: item.layer })), [
    { id: outer.id, layer: 'main' },
  ]);

  const grandchildDetail = await buildEventDetailForSession(
    index,
    materialized,
    dispatches[1].eventId,
    'main',
  );
  const grandchildOwner = grandchildDetail.inspectorSections.find((section) => section.title === 'Owning Code Mode activity');
  assert.deepEqual(grandchildOwner.items.map((item) => ({ id: item.id, layer: item.layer })), [
    { id: dispatches[0].eventId, layer: 'main' },
  ]);
});

test('DeepSeek workflow detail exposes lifecycle Raw members and exact grouped-run owners', async () => {
  const { index, materialized } = await buildFor(WORKFLOW_REPO);
  const workflow = materialized.logicalEvents.find((event) => (
    event.layer === 'protocol' && event.subtype === 'tool-workflow/run' && event.status === 'success'
  ));
  const detail = await buildEventDetailForSession(index, materialized, workflow.id, 'protocol');
  validateStructuredLogicalDetailDto(detail);
  const members = detail.inspectorSections.find((section) => section.title === 'Workflow member evidence');
  assert.deepEqual(members.items.map((item) => item.layer), ['raw', 'raw']);
  const localized = await buildEventDetailForSession(index, materialized, workflow.id, 'protocol', { locale: 'zh-CN' });
  const localizedMembers = localized.inspectorSections.find((section) => section.title === '工作流成员证据');
  assert.match(localizedMembers.items[0].label, /^代理 1：.*（开始）$/);
  assert.deepEqual(localizedMembers.items.map(({ id, layer, kind, status }) => ({ id, layer, kind, status })),
    members.items.map(({ id, layer, kind, status }) => ({ id, layer, kind, status })));
  assert.deepEqual(
    members.items.map((item) => materialized.rawEvents.find((raw) => raw.rawId === item.id)?.payloadType),
    ['tool-workflow/agent-start', 'tool-workflow/agent-end'],
  );

  for (const item of members.items) {
    const rawDetail = await buildEventDetailForSession(index, materialized, item.id, 'raw');
    const owner = rawDetail.inspectorSections.find((section) => section.title === 'Owning workflow run');
    assert.deepEqual(owner.items.map((ownerItem) => ({ id: ownerItem.id, layer: ownerItem.layer })), [
      { id: workflow.id, layer: 'protocol' },
    ]);
  }
});
