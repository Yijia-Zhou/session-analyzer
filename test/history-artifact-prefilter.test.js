'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../src/source-adapters');

async function fixture(t, supported) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-artifact-prefilter-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  const directory = path.join(home, 'sessions', '2026', '09', '01');
  await fs.mkdir(repo);
  await fs.mkdir(directory, { recursive: true });
  const id = '11111111-1111-4111-8111-111111111111';
  const file = path.join(directory, `rollout-2026-09-01T00-00-00-${id}.jsonl`);
  const rows = [
    { type: 'session_meta', payload: { id, cwd: repo, originator: 'codex_cli' } },
    supported
      ? { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call',
        // The literal marker exists only in the output, not this JSON string.
        arguments: '{"cmd":"\\u0073ession-analyzer history search --query old"}' } }
      : { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'custom',
        input: 'console.log("session-analyzer PREFILTER_CUSTOM")' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call',
      output: 'session-analyzer PREFILTER_NEEDLE 验证😀' } },
  ].map((row) => ({ timestamp: '2026-09-01T00:00:00.000Z', ...row }));
  const original = rows.map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(file, original);
  const implementation = adapters.materializeSessionForIndex;
  const materializations = t.mock.method(adapters, 'materializeSessionForIndex', function (...args) {
    return implementation.apply(this, args);
  });
  const servicePath = require.resolve('../src/history-service');
  delete require.cache[servicePath];
  const { createHistoryService } = require(servicePath);
  const service = await createHistoryService({ repo, source: 'codex', codexHome: home });
  t.after(() => service.close());
  return { service, file, original, materializations };
}

test('unsupported custom calls stay searchable without artifact materialization; reads still verify sources', async (t) => {
  const { service, file, original, materializations } = await fixture(t, false);
  let reference;
  for (const retrievalArtifacts of ['exclude', 'include', 'only']) {
    const result = await service.execute('search', { query: 'PREFILTER_NEEDLE', layer: 'raw', retrievalArtifacts });
    assert.equal(result.scan.retrievalArtifacts.recognized, 0);
    assert.equal(result.scan.matchedEvents, retrievalArtifacts === 'only' ? 0 : 1);
    reference ||= result.items[0]?.ref;
  }
  const custom = await service.execute('search', { query: 'PREFILTER_CUSTOM', layer: 'raw' });
  assert.equal(custom.scan.matchedEvents, 1);
  assert.equal(materializations.mock.callCount(), 0);
  await fs.appendFile(file, JSON.stringify({ timestamp: '2026-09-02T00:00:00Z', type: 'event_msg',
    payload: { type: 'user_message', message: 'later append' } }) + '\n');
  await service.execute('read', { refs: [reference], parts: ['projection'] });
  await service.execute('context', { refs: [reference] });
  assert.equal(materializations.mock.callCount(), 2, 'independent reads verify the accepted prefix again');
  await fs.writeFile(file, original.replace('PREFILTER_NEEDLE', 'DIFFERENT_NEEDLE'));
  for (const operation of ['read', 'context']) {
    await assert.rejects(service.execute(operation, { refs: [reference] }), { code: 'STALE_REFERENCE' });
  }
  await assert.rejects(service.resolveEvidence({ refs: [reference] }, 'open'), { code: 'STALE_REFERENCE' });
  const rewrittenSearch = await service.execute('search', { query: 'PREFILTER_NEEDLE', layer: 'raw' });
  assert.equal(rewrittenSearch.scan.matchedEvents, 1, 'unclassifiable rewritten sources still expose committed discovery projections');
  await fs.unlink(file);
  for (const operation of ['read', 'context']) {
    await assert.rejects(service.execute(operation, { refs: [reference] }), { code: 'STALE_REFERENCE' });
  }
  await assert.rejects(service.resolveEvidence({ refs: [reference] }, 'open'), { code: 'STALE_REFERENCE' });
  const stillIndexed = await service.execute('search', { query: 'PREFILTER_NEEDLE', layer: 'raw' });
  assert.equal(stillIndexed.scan.matchedEvents, 1, 'search remains a fixed projection discovery operation');
});

test('supported escaped calls retain paired-output policies, grouped counts and strict independent validation', async (t) => {
  const { service, file, original, materializations } = await fixture(t, true);
  for (const retrievalArtifacts of ['exclude', 'include', 'only']) {
    const query = { query: 'PREFILTER_NEEDLE', layer: 'raw', retrievalArtifacts, limit: 1 };
    const single = await service.execute('search', query);
    assert.equal(single.scan.retrievalArtifacts.recognized, 1);
    assert.equal(single.scan.matchedEvents, retrievalArtifacts === 'exclude' ? 0 : 1);
    const groups = [{ id: 'first', ...query }, { id: 'second', ...query }];
    const grouped = await service.execute('search', { groups });
    for (const group of grouped.groups) {
      assert.deepEqual(group.scan, single.scan);
      assert.deepEqual(group.items, single.items);
      assert.equal(group.hasMore, single.hasMore);
    }
  }
  assert.equal(materializations.mock.callCount(), 9, 'each independent search and each group keeps its validation');
  await fs.writeFile(file, original.replace('PREFILTER_NEEDLE', 'DIFFERENT_NEEDLE'));
  await assert.rejects(service.execute('search', { query: 'PREFILTER_NEEDLE', layer: 'raw' }), { code: 'STALE_REFERENCE' });
});
