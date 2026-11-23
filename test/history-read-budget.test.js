'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHistoryService } = require('../src/history-service');

async function fixture(t, repoName = 'repo') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'read-budget-'));
  const repo = path.join(home, repoName);
  const sessions = path.join(home, 'sessions');
  await fs.mkdir(repo);
  await fs.mkdir(sessions);
  const text = 'quote"\\\n\t验证😀'.repeat(650) + 'MID_HIT' + '尾"\\\t😀'.repeat(800) + 'END';
  const rows = [
    { type: 'session_meta', payload: { id: 'read-budget-session', cwd: repo } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Initial question' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call', arguments: JSON.stringify({ cmd: 'TOOL_HIT ' + 'request 验证😀\\"'.repeat(1200) }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call', output: 'result 验证😀\\"'.repeat(1200) + 'END' } },
  ];
  const file = path.join(sessions, 'rollout-read-budget.jsonl');
  await fs.writeFile(file, rows.map((row, n) => JSON.stringify({ timestamp: `2026-09-01T00:00:0${n}Z`, ...row })).join('\n') + '\n');
  const service = await createHistoryService({ repo, codexHome: home, source: 'codex' });
  t.after(async () => { service.close(); await fs.rm(home, { recursive: true, force: true }); });
  const status = await service.execute('status');
  const find = async (query) => (await service.execute('search', { query, presentation: 'full' })).items[0].ref;
  return { service, text, contextRef: status.contextRef, hit: await find('MID_HIT'), tool: await find('TOOL_HIT') };
}

test('auto is opt-in, follows stored hits, and explicit selectors keep their own coordinates', async (t) => {
  const { service, text, hit, contextRef } = await fixture(t);
  const read = async (input) => (await service.execute('read', { refs: [hit], contextRef, ...input })).items[0].parts;
  assert.equal((await read({}))[0].part, 'message');
  const automatic = (await read({ mode: 'auto' }))[0];
  assert.equal(automatic.part, 'projection');
  assert.equal(automatic.hitOffset, text.indexOf('MID_HIT'));
  assert.equal(automatic.offset, automatic.hitOffset - 500);
  assert.equal(automatic.endOffset, automatic.hitOffset + 1500);
  assert.equal(automatic.text, text.slice(automatic.offset, automatic.endOffset));
  const ordinary = hit.split('.').slice(0, 7).join('.');
  assert.equal((await read({ refs: [ordinary], mode: 'auto' }))[0].part, 'message');
  assert.equal((await read({ mode: 'auto', parts: ['message'], offset: 2, length: 11 }))[0].offset, 2);
  assert.equal((await read({ mode: 'auto', offset: 0, length: 10 }))[0].part, 'message');
  const backwards = (await read({ parts: ['projection'], endOffset: 90, length: 17 }))[0];
  assert.equal(backwards.text, text.slice(73, 90));
  for (const input of [{ mode: 'unknown' }, { offset: 0, endOffset: 1 },
    { mode: 'content', aroundHit: { before: 1, after: 1 } },
    { aroundHit: { before: 1, after: 1 }, endOffset: 10 }]) {
    await assert.rejects(read(input), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(read({ refs: [ordinary + '.999999'], mode: 'auto' }), { code: 'INVALID_REFERENCE' });
});

test('oversized around-hit text keeps the hit and exact adjoining continuations through final JSON budgets', async (t) => {
  const { service, text, hit, contextRef } = await fixture(t);
  for (const presentation of ['full', 'compact']) {
    const maxBytes = 4096;
    const first = await service.execute('read', { refs: [hit], contextRef, presentation, maxBytes,
      aroundHit: { before: 40000, after: 40000 } });
    assert.ok(Buffer.byteLength(JSON.stringify(first)) <= maxBytes);
    assert.equal(first.hasMore, false);
    assert.equal(first.contentTruncated, true);
    const anchor = first.items[0].parts[0];
    assert.ok(anchor.offset <= anchor.hitOffset && anchor.endOffset > anchor.hitOffset);
    assert.equal(anchor.text, text.slice(anchor.offset, anchor.endOffset));
    const chunks = [anchor];
    for (const direction of ['previous', 'next']) {
      let part = anchor;
      let calls = 0;
      while (part[direction]) {
        assert.ok(++calls < 100, 'continuation makes bounded progress');
        const response = await service.execute('read', JSON.parse(JSON.stringify(part[direction])));
        assert.ok(Buffer.byteLength(JSON.stringify(response)) <= maxBytes);
        assert.equal(response.hasMore, false);
        const next = response.items[0].parts[0];
        if (direction === 'previous') assert.equal(next.endOffset, part.offset);
        else assert.equal(next.offset, part.endOffset);
        assert.ok(next.endOffset > next.offset);
        assert.equal(next.text, text.slice(next.offset, next.endOffset));
        chunks.push(next);
        part = next;
      }
    }
    chunks.sort((a, b) => a.offset - b.offset);
    assert.equal(chunks[0].offset, 0);
    assert.equal(chunks.at(-1).endOffset, text.length);
    for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i - 1].endOffset, chunks[i].offset);
    assert.equal(chunks.map((part) => part.text).join(''), text);
  }
});

test('multi-part budget omissions are explicitly deferred and every part remains readable', async (t) => {
  const { service, tool } = await fixture(t, 'long-project-path-'.repeat(10));
  const parts = ['request', 'result', 'projection', 'raw', 'message'];
  const response = await service.execute('read', { refs: [tool], parts, offset: 500, length: 100000,
    textFormat: 'text', maxBytes: 4096, presentation: 'full' });
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 4096);
  assert.deepEqual(response.items[0].parts.map((part) => part.part), parts);
  assert.equal(response.items[0].parts.find((part) => part.part === 'message').available, false);
  assert.ok(response.items[0].parts.some((part) => part.deferred));
  for (const part of response.items[0].parts.filter((part) => !['message', 'raw'].includes(part.part))) {
    assert.equal(part.available, true);
    if (!part.deferred) { assert.ok(part.text.length > 0); continue; }
    assert.equal(part.reason, 'output_budget');
    const retry = await service.execute('read', part.next);
    assert.ok(Buffer.byteLength(JSON.stringify(retry)) <= 4096);
    assert.equal(retry.items[0].parts[0].part, part.part);
    assert.equal(retry.items[0].parts[0].offset, 500);
    assert.ok(retry.items[0].parts[0].text.length > 0);
    assert.equal(retry.items[0].parts[0].deferred, undefined);
  }
});

test('Raw link positions use rawOffset while Raw text and top-level pages have submit-ready continuations', async (t) => {
  const { service, tool, hit, contextRef } = await fixture(t);
  const first = await service.execute('read', { refs: [tool], parts: ['raw'], limit: 1, contextRef });
  const item = first.items[0];
  assert.equal(item.rawRefsNext.rawOffset, 1);
  const second = await service.execute('read', item.rawRefsNext);
  assert.equal(second.items[0].rawRefsOffset, 1);
  assert.notEqual(second.items[0].rawRefs[0], item.rawRefs[0]);
  await assert.rejects(service.execute('read', { refs: [tool], parts: ['raw'], offset: 1 }), { code: 'INVALID_ARGUMENT' });
  const raw = item.rawRefs[0];
  const rawText = await service.execute('read', { refs: [raw], contextRef, parts: ['raw'], offset: 4, length: 3 });
  assert.equal(rawText.items[0].parts[0].offset, 4);
  await assert.rejects(service.execute('read', { refs: [raw], contextRef, parts: ['raw'], rawOffset: 1 }), { code: 'INVALID_ARGUMENT' });
  const page = await service.execute('read', { refs: [hit, tool], contextRef, mode: 'auto', limit: 1 });
  assert.equal(page.hasMore, true);
  const next = await service.execute('read', page.next);
  assert.equal(next.items[0].evidenceRef, tool);
  assert.equal(next.hasMore, false);
});

test('group continuations preserve their group identity and can be submitted unchanged', async (t) => {
  const { service } = await fixture(t);
  const first = await service.execute('search', { groups: [{ id: 'quoted', query: '验证', limit: 1 }] });
  assert.equal(first.groups[0].hasMore, true);
  const next = await service.execute('search', JSON.parse(JSON.stringify(first.groups[0].next)));
  assert.equal(next.groups[0].queryIdentity, first.groups[0].queryIdentity);
  assert.notEqual(next.groups[0].items[0].ref, first.groups[0].items[0].ref);
});

test('a complete final page is admitted when only a provisional continuation would exceed budget', async (t) => {
  const { service } = await fixture(t);
  const page = await service.execute('search', { query: 'Initial question', exclude: ['x'.repeat(3500)], maxBytes: 4096 });
  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, false);
  assert.equal(page.next, null);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 4096);
  const grouped = await service.execute('search', { groups: [{ id: 'large-input', query: 'Initial question', exclude: ['x'.repeat(3500)] }], maxBytes: 4096 });
  assert.equal(grouped.groups[0].items.length, 1);
  assert.equal(grouped.groups[0].next, null);
  assert.ok(Buffer.byteLength(JSON.stringify(grouped)) <= 4096);
});
