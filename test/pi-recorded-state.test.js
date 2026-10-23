'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recordedUsage, recordedConfiguration, branchUsageSummary, recordedStateSections } = require('../src/pi-recorded-state');

test('usage preserves zero, rejects coercion and keeps subsets separate', () => {
  const receipt = recordedUsage({ type: 'usage', kind: 'future_kind', usage: { input: 0, output: 9, reasoning: 3,
    cacheWrite: 7, cacheWrite1h: 2, cacheRead: '0', totalTokens: -1, cost: { total: 0, input: '4' } } });
  assert.equal(receipt.kind, 'future_kind');
  assert.deepEqual(receipt.values, { input: 0, output: 9, cacheWrite: 7, cacheWrite1h: 2, reasoning: 3 });
  assert.deepEqual(receipt.invalid, ['cacheRead', 'totalTokens']);
  assert.deepEqual(receipt.cost, { total: 0 });
  assert.equal(recordedUsage({ type: 'message', message: { role: 'user', usage: { input: 5 } } }), null);
  assert.deepEqual(recordedUsage({ type: 'compaction', usage: null }).missing,
    ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens']);
});

test('selected branch accounting separates sources and reports field coverage', () => {
  const rows = [
    { type: 'message', message: { role: 'assistant', usage: { input: 10, output: 0 } } },
    { type: 'message', message: { role: 'assistant', usage: { input: 3 } } },
    { type: 'message', message: { role: 'toolResult', usage: { input: 4 } } },
    { type: 'compaction', usage: { input: 8 } }, { type: 'branch_summary', usage: { input: 6 } },
    { type: 'usage', kind: 'unknown', usage: { input: 2 } },
  ];
  const summary = branchUsageSummary(rows);
  assert.deepEqual(summary.assistant.fields.output, { recordedSum: 0, recordedCount: 1, missingCount: 1, invalidCount: 0 });
  assert.equal(summary.assistant.fields.input.recordedSum, 13);
  assert.equal(summary.tool_nested_model_work.fields.input.recordedSum, 4);
  assert.equal(summary.compaction.fields.input.recordedSum, 8);
  assert.equal(summary.branch_summary.fields.input.recordedSum, 6);
  assert.equal(branchUsageSummary(rows.slice(0, 1)).assistant.fields.input.recordedSum, 10);
});

test('selection snapshots distinguish selection and physical assistant evidence without prompt copies', () => {
  const rows = [
    { line: 1, parsed: { type: 'model_change', provider: 'p', modelId: 'selected' } },
    { line: 2, parsed: { type: 'thinking_level_change', thinkingLevel: 'high' } },
    { line: 3, parsed: { type: 'message', message: { role: 'assistant', provider: 'q', model: 'actual', responseModel: 'provider-concrete' } } },
  ];
  const snapshots = recordedConfiguration(rows);
  assert.equal(snapshots.get(1).assistantModel, null);
  assert.equal(snapshots.get(3).selectedModel.modelId, 'selected');
  assert.equal(snapshots.get(3).assistantModel.modelId, 'actual');
  assert.equal(snapshots.get(3).assistantModel.responseModel, 'provider-concrete');
  assert.equal(snapshots.get(3).thinkingLevel, 'high');
  assert.equal(recordedConfiguration(rows.slice(0, 1)).get(1).thinkingLevel, null);
});

test('system patches, checkpoint and context edit explain effects without flattening structured values', () => {
  const sections = recordedStateSections({ type: 'message', message: { role: 'system', content: '',
    sections: { removed: null, updated: 'new', malformed: { value: 'preserve' } }, toolsRemoved: [{ name: 'write' }] } });
  assert.deepEqual(sections[0].value.sections.malformed, { value: 'preserve' });
  assert.match(sections[1].text, /null removes/);
  assert.match(sections[1].text, /wire request/);
  const checkpoint = recordedStateSections({ type: 'compaction', systemMessage: { role: 'system', sections: { a: 'b' } } });
  assert.ok(checkpoint.some((section) => section.title === 'Recorded complete system checkpoint'));
  assert.match(recordedStateSections({ type: 'context_edit', replacement: null })[0].text, /omits the target/);
  let deep = {}; const root = deep;
  for (let index = 0; index < 100; index++) { deep.next = {}; deep = deep.next; }
  assert.doesNotThrow(() => recordedStateSections({ type: 'compaction', systemMessage: root }));
});

test('recorded state survives index/materialization and branch detail without sibling usage', async (t) => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const { buildPiIndex, piAdapter } = require('../src/pi');
  const { materializeSessionForIndex, buildEventDetailForSession } = require('../src/source-adapters');
  const { disposeProjectQueryStore, projectQueryProjectionDigestAsync } = require('../src/project-query-store');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-state-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'sessions', 'synthetic'), { recursive: true });
  const rows = [
    { type: 'session', id: 'state', version: 3, cwd: home },
    { type: 'model_change', id: 'm', parentId: null, provider: 'p', modelId: 'selected' },
    { type: 'message', id: 's', parentId: 'm', message: { role: 'system', content: '', sections: { a: 'prompt' }, toolsAdded: [] } },
    { type: 'message', id: 'a', parentId: 's', message: { role: 'assistant', provider: 'p', model: 'physical', content: [{ type: 'text', text: 'answer' }], usage: { input: 5, output: 0 } } },
    { type: 'compaction', id: 'c', parentId: 'a', summary: 'summary', firstKeptEntryId: 'a', systemMessage: { role: 'system', content: '', sections: { a: 'prompt' } }, usage: { input: 2 } },
    { type: 'usage', id: 'left', parentId: 'c', kind: 'future_operation', usage: { input: 7 } },
    { type: 'usage', id: 'right', parentId: 'c', kind: 'future_operation', usage: { input: 900 } },
  ];
  await fs.writeFile(path.join(home, 'sessions', 'synthetic', 'state.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  const index = await buildPiIndex({ repoRoot: home, sourceHome: home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  const stored = index.sessions.find((session) => session.sourceDerivedId === 'left');
  const session = await materializeSessionForIndex(index, stored);
  assert.equal(await projectQueryProjectionDigestAsync(session, piAdapter.query.projectQueryPresentation), stored.queryProjectionDigest);
  const branch = session.logicalEvents.find((event) => event.subtype === 'pi_branch');
  const detail = await buildEventDetailForSession(index, session, branch.id, branch.layer);
  const summary = detail.inspectorSections.find((section) => section.title?.includes('partial sums')).value;
  assert.equal(summary.usage.fields.input.recordedSum, 7);
  assert.equal(summary.assistant.fields.input.recordedSum, 5);
  assert.equal(summary.compaction.fields.input.recordedSum, 2);
  for (const event of session.logicalEvents) {
    const result = await buildEventDetailForSession(index, session, event.id, event.layer);
    assert.ok(result);
    if (event.subtype === 'pi_system') assert.match(JSON.stringify(result), /Named prompt sections are patched/);
    if (event.kind === 'compaction') assert.match(JSON.stringify(result), /Recorded complete system checkpoint/);
    if (event.kind === 'assistant_message') {
      const selection = result.inspectorSections.find((section) => section.title?.includes('last assistant model')).value;
      assert.equal(selection.selectedModel.modelId, 'selected');
      assert.equal(selection.assistantModel.modelId, 'physical');
    }
  }
});

test('malformed later selections invalidate earlier selection evidence independently', () => {
  const rows = [
    { id: 'a', type: 'model_change', provider: 'p', modelId: 'known' },
    { id: 'b', type: 'thinking_level_change', thinkingLevel: 'high' },
    { id: 'c', type: 'model_change', provider: {}, modelId: 'bad' },
    { id: 'd', type: 'thinking_level_change', thinkingLevel: ['high'] },
    { id: 'e', type: 'model_change', provider: 'p', modelId: 'restored' },
  ];
  const snapshots = recordedConfiguration(rows);
  assert.equal(snapshots.get('c').selectedModel, null);
  assert.equal(snapshots.get('c').selectedModelStatus, 'invalid_record');
  assert.equal(snapshots.get('c').thinkingLevel, 'high');
  assert.equal(snapshots.get('d').thinkingLevel, null);
  assert.equal(snapshots.get('d').thinkingLevelStatus, 'invalid_record');
  assert.equal(snapshots.get('e').selectedModel.modelId, 'restored');
  assert.equal(snapshots.get('e').selectedModelStatus, 'recorded');
});

test('branch coverage discloses missing receipts and distinguishes unknown sums, zero and overflow', () => {
  const summary = branchUsageSummary([
    { type: 'message', message: { role: 'assistant' } },
    { type: 'message', message: { role: 'assistant', usage: { input: 0 } } },
    { type: 'message', message: { role: 'toolResult' } },
    { type: 'compaction' },
    { type: 'usage', usage: { input: Number.MAX_VALUE } },
    { type: 'usage', usage: { input: Number.MAX_VALUE } },
    { type: 'usage', usage: { input: 1 } },
  ]);
  assert.equal(summary.assistant.eligibleRecords, 2);
  assert.equal(summary.assistant.missingUsageRecords, 1);
  assert.equal(summary.assistant.receipts, 1);
  assert.equal(summary.assistant.fields.input.recordedSum, 0);
  assert.equal(summary.assistant.fields.output.recordedSum, null);
  assert.equal(summary.assistant.fields.output.missingCount, 1);
  assert.equal(summary.tool_nested_model_work.missingUsageRecords, 1);
  assert.equal(summary.compaction.missingUsageRecords, 1);
  assert.deepEqual(summary.tool_nested_model_work.fields, {});
  assert.equal(summary.usage.fields.input.recordedSum, null);
  assert.equal(summary.usage.fields.input.overflow, true);
  assert.equal(summary.usage.fields.input.recordedCount, 3);
});
