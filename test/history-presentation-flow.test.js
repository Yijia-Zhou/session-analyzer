'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { runHistoryCli } = require('../src/history-cli');
const { MAX_BODY_BYTES, createHistoryServer } = require('../src/history-server');
const { createHistoryService } = require('../src/history-service');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

async function corpus(t, texts) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-presentation-flow-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  const directory = path.join(home, 'sessions', '2026', '09', '01');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(directory, { recursive: true });
  const sourceFile = path.join(directory, 'rollout-2026-09-01T00-00-00-presentation.jsonl');
  const rows = [{ type: 'session_meta', payload: { id: 'presentation-synthetic', cwd: repo } },
    ...texts.map((text, n) => ({ timestamp: `2026-09-01T00:00:${String(n).padStart(2, '0')}Z`,
      type: 'response_item', payload: { type: 'message', role: n % 2 ? 'assistant' : 'user',
        content: [{ type: n % 2 ? 'output_text' : 'input_text', text }] } }))];
  await fs.writeFile(sourceFile, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const options = { repo, source: 'codex', codexHome: home };
  async function create(factory = createHistoryService) {
    const service = await factory(options);
    t.after(() => service.close());
    return service;
  }
  return { create, sourceFile };
}

async function canonical(service, value, contextRef, cache = new Map()) {
  if (typeof value === 'string' && value.startsWith('hr1.')) {
    if (!cache.has(value)) {
      const read = await service.execute('read', { refs: [value], contextRef,
        parts: ['projection'], length: 1, presentation: 'compact', maxBytes: 65536 });
      cache.set(value, read.items[0].evidenceRef);
    }
    return cache.get(value);
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => canonical(service, item, contextRef, cache)));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value)
      .filter(([key]) => !['evidenceRef', 'presentation'].includes(key))
      .map(async ([key, item]) => [key, await canonical(service, item, contextRef, cache)]));
    return Object.fromEntries(entries);
  }
  return value;
}

test('search rejects an unsubmitable continuation at the CLI and HTTP request size boundary', async (t) => {
  const fixture = await corpus(t, ['SIZE_NEEDLE one', 'SIZE_NEEDLE two']);
  const service = await fixture.create();
  const server = createHistoryServer(service);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const post = (input) => fetch(`${endpoint}/api/history/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  async function search(input) {
    let output = '';
    const code = await runHistoryCli(['search', '--endpoint', endpoint, '--input-file', '-'], {
      stdin: Readable.from([Buffer.from(JSON.stringify(input))]), stdout: { write(text) { output += text; } },
    });
    return { code, value: JSON.parse(output) };
  }
  const maxBytes = 2 * MAX_BODY_BYTES;
  const filler = '界'.repeat(4096);
  for (const grouped of [false, true]) {
    const wrap = (query) => grouped ? { groups: [{ id: 'bounded', ...query }], maxBytes: query.maxBytes } : query;
    const page = (v) => grouped ? v.groups[0] : v;
    const nearLimit = (limit) => {
      const exclude = [filler, filler, ''];
      const input = wrap({ queries: ['SIZE_NEEDLE', ...Array(19).fill(filler)], exclude, order: 'session', limit, maxBytes });
      exclude[2] = 'x'.repeat(MAX_BODY_BYTES - 32 - bytes(input));
      assert.ok(exclude[2].length <= 4096);
      assert.equal(bytes(input), MAX_BODY_BYTES - 32);
      return input;
    };
    const all = await search(nearLimit(2));
    assert.equal(all.code, 0);
    assert.equal(page(all.value).items.length, 2);
    assert.equal(page(all.value).next, null, 'a request that needs no continuation can use the remaining input budget');

    const input = nearLimit(1);
    const first = await search(input);
    if (first.code === 0) {
      const next = page(first.value).next;
      const submitted = await search(next);
      t.diagnostic(`grouped=${grouped}: request=${bytes(input)}, response=${bytes(first.value)}, next=${bytes(next)}, retry=${submitted.value.error?.code}`);
    }
    assert.equal(first.code, 1, `grouped=${grouped}: reject the first request that would advertise an oversized continuation`);
    assert.equal(first.value.error.code, 'CONTINUATION_TOO_LARGE');
    assert.match(first.value.error.message, /shorten.+new search.+without (?:a|the) cursor/iu);
    const response = await post(input);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'CONTINUATION_TOO_LARGE');

    const normal = await search(wrap({ query: 'SIZE_NEEDLE', order: 'session', limit: 1, maxBytes: 4096 }));
    assert.equal(normal.code, 0);
    assert.ok(bytes(normal.value) <= 4096);
    const next = page(normal.value).next;
    const continued = await search(next);
    assert.equal(continued.code, 0);
    assert.ok(bytes(continued.value) <= 4096);
    assert.deepEqual([page(normal.value), page(continued.value)].flatMap((p) => p.items.map((item) => item.eventId)),
      page(all.value).items.map((item) => item.eventId));
    assert.equal(page(continued.value).next, null);
  }
});

test('fixed search/read evidence and completed equal-budget pages agree across presentations', async (t) => {
  const texts = Array.from({ length: 18 }, (_, n) => `EVIDENCE_${n} ${'local recorded text '.repeat(11)}尾部😀`);
  const fixture = await corpus(t, texts);
  const service = await fixture.create();
  const status = await service.execute('status');
  assert.equal(status.presentation, 'compact');
  const contextRef = status.contextRef;
  const request = { query: 'EVIDENCE_', limit: 100, maxBytes: 1048576 };
  const full = await service.execute('search', { ...request, presentation: 'full' });
  const compact = await service.execute('search', { ...request, presentation: 'compact' });
  assert.deepEqual(await canonical(service, compact.items, contextRef), full.items);
  for (const index of [0, texts.length - 1]) {
    const range = { parts: ['projection'], offset: 3, length: 80, maxBytes: 65536, contextRef };
    const a = await service.execute('read', { ...range, refs: [full.items[index].ref], presentation: 'full' });
    const b = await service.execute('read', { ...range, refs: [compact.items[index].ref], presentation: 'compact' });
    assert.deepEqual(await canonical(service, b.items, contextRef), await canonical(service, a.items, contextRef));
  }
  const counts = {};
  for (const presentation of ['full', 'compact']) {
    const items = [];
    let cursor;
    counts[presentation] = [];
    do {
      const page = await service.execute('search', { ...request, presentation, contextRef, maxBytes: 4096, ...(cursor ? { cursor } : {}) });
      assert.ok(bytes(page) <= 4096);
      assert.equal(page.hasMore, page.nextCursor !== null);
      assert.ok(page.items.length);
      counts[presentation].push(page.items.length);
      items.push(...await canonical(service, page.items, contextRef));
      cursor = page.nextCursor;
      assert.ok(counts[presentation].length <= texts.length);
    } while (cursor);
    assert.deepEqual(items, full.items, `${presentation} pages restore every event in order`);
    assert.equal(new Set(items.map((item) => item.ref)).size, texts.length);
  }
  assert.notDeepEqual(counts.full, counts.compact, 'equal budgets may produce different legal page boundaries');
  t.diagnostic(`Synthetic 4096-byte page counts: ${JSON.stringify(counts)}`);
});

test('compact complete workflow retains coverage, continuation and durable reopening semantics', async (t) => {
  const text = `WORKFLOW_NEEDLE ${'quoted "text" 中文😀\n'.repeat(30)}END`;
  const fixture = await corpus(t, ['Earlier context.', text, 'Later recorded decision.']);
  const service = await fixture.create();
  const outputs = {};
  let saved;
  let oldHandle;
  let oldContext;
  for (const presentation of ['full', 'compact']) {
    const status = await service.execute('status', { presentation });
    const noContext = await service.execute('search', { query: 'WORKFLOW_NEEDLE', presentation });
    const search = await service.execute('search', { query: 'WORKFLOW_NEEDLE', presentation, contextRef: status.contextRef });
    assert.deepEqual(noContext.coverage, status.coverage);
    assert.deepEqual(noContext.warnings, status.warnings);
    if (presentation === 'compact') {
      assert.equal(search.coverageRef, status.contextRef);
      assert.equal(search.coverage, undefined);
      assert.equal(search.warnings, undefined);
      const recovered = await service.execute('status', { presentation, contextRef: status.contextRef });
      assert.deepEqual(recovered.coverage, status.coverage);
      assert.deepEqual(recovered.warnings, status.warnings);
    }
    const ref = search.items[0].ref;
    const context = await service.execute('context', { refs: [ref], presentation, contextRef: status.contextRef });
    const events = presentation === 'full' ? context.items[0].events
      : context.items[0].eventIndexes.map((at) => context.events[at]);
    assert.ok(events.some((event) => event.excerpt.text.includes('WORKFLOW_NEEDLE')));
    const read = await service.execute('read', { refs: [ref], presentation, contextRef: status.contextRef,
      parts: ['projection'], offset: 0, length: 45 });
    const first = read.items[0].parts[0];
    assert.equal(first.truncated, true);
    assert.equal(read.contentTruncated, true);
    const continuations = [];
    let next = first.next;
    let restored = first.text;
    let offset = first.endOffset;
    while (next) {
      const continuation = await service.execute('read', next);
      const part = continuation.items[0].parts[0];
      assert.equal(part.offset, offset, 'directly submitted continuation meets the preceding range');
      restored += part.text;
      offset = part.endOffset;
      next = part.next;
      continuations.push(continuation);
      assert.ok(continuations.length < 50);
    }
    assert.equal(restored, text);
    assert.equal(continuations.at(-1).hasMore, false);
    const durable = read.items[0].evidenceRef || read.items[0].ref;
    const opened = await service.resolveEvidence({ refs: [durable] });
    assert.equal(opened.targetVerified, true);
    assert.equal(opened.evidenceRef, durable);
    outputs[presentation] = { firstSearch: bytes(noContext), laterSearch: bytes(search),
      wholeFlow: [status, search, context, read, ...continuations, opened].reduce((total, output) => total + bytes(output), 0) };
    if (presentation === 'compact') {
      saved = durable;
      oldHandle = ref;
      oldContext = status.contextRef;
    }
  }
  assert.ok(outputs.compact.firstSearch < outputs.full.firstSearch);
  assert.ok(outputs.compact.laterSearch < outputs.full.laterSearch);
  assert.ok(outputs.compact.wholeFlow < outputs.full.wholeFlow);
  t.diagnostic(`Synthetic serialized payload bytes (status included in wholeFlow): ${JSON.stringify(outputs)}`);
  service.close();
  const restarted = await fixture.create();
  const current = await restarted.execute('status');
  await assert.rejects(restarted.execute('read', { refs: [oldHandle], contextRef: oldContext }), { code: 'CONTEXT_EXPIRED' });
  await assert.rejects(restarted.execute('read', { refs: [oldHandle], contextRef: current.contextRef }), { code: 'INVALID_REFERENCE' });
  const reopened = await restarted.resolveEvidence({ refs: [saved] });
  assert.equal(reopened.targetVerified, true);
  const original = await fs.readFile(fixture.sourceFile, 'utf8');
  await fs.writeFile(fixture.sourceFile, original.replace('WORKFLOW_NEEDLE', 'REWRITTEN_DATA'));
  await assert.rejects(restarted.resolveEvidence({ refs: [saved] }), { code: 'STALE_REFERENCE' });
});

function factoryWithSeededHandles(count, configure) {
  // Keep the real 50,000 limit and production budget path. Seed only the private
  // presentation factory in this test process; no product debug endpoint exists.
  const presentationPath = require.resolve('../src/history-presentation');
  const servicePath = require.resolve('../src/history-service');
  const presentation = require(presentationPath);
  const original = presentation.createHistoryPresentation;
  const cached = require.cache[servicePath];
  presentation.createHistoryPresentation = (contextRef) => {
    const value = original(contextRef);
    value.project({ operation: 'history.search', items: Array.from({ length: count }, (_, n) => ({ ref: `er2.seed-${n}` })) });
    configure?.(value);
    return value;
  };
  delete require.cache[servicePath];
  try { return require(servicePath).createHistoryService; }
  finally {
    presentation.createHistoryPresentation = original;
    require.cache[servicePath] = cached;
  }
}

test('real budget failure near the cap leaves a retry slot and same-snapshot full fallback obeys its budget', async (t) => {
  const giant = Array.from({ length: 7 }, (_, n) => (n === 3 ? 'BUDGET_MIDDLE GROUP_BIG ' : '') + '检'.repeat(360)).join('\n');
  const fixture = await corpus(t, [giant, 'SMALL_UNIQUE accepted after budget failure.', 'OTHER_UNIQUE full fallback.']);
  const service = await fixture.create(factoryWithSeededHandles(49999));
  const status = await service.execute('status');
  const grouped = await service.execute('search', { groups: [{ id: 'large', query: 'GROUP_BIG', maxBytes: 24000 }], maxBytes: 4096 });
  assert.equal(grouped.groups[0].state, 'results_omitted');
  assert.deepEqual(grouped.groups[0].items, []);
  await assert.rejects(service.execute('search', { query: 'BUDGET_MIDDLE', maxBytes: 4096 }), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
  const retry = await service.execute('search', { query: 'SMALL_UNIQUE', maxBytes: 4096 });
  assert.equal(retry.presentation, 'compact', 'discarded budget probe did not consume the last handle');
  assert.match(retry.items[0].ref, /^hr1\./u);
  const fallback = await service.execute('search', { query: 'OTHER_UNIQUE', maxBytes: 4096 });
  assert.equal(fallback.contextRef, status.contextRef);
  assert.equal(fallback.presentation, 'full');
  assert.deepEqual(fallback.presentationFallback, { requested: 'compact', reason: 'HANDLE_LIMIT_REACHED' });
  assert.ok(bytes(fallback) <= 4096);
  assert.match(fallback.items[0].ref, /^er2\./u);
  await assert.rejects(service.execute('search', { query: 'BUDGET_MIDDLE', maxBytes: 4096 }), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
  const enlarged = await service.execute('search', { query: 'BUDGET_MIDDLE', maxBytes: 24000 });
  assert.equal(enlarged.presentation, 'full');
  assert.ok(bytes(enlarged) <= 24000);
  const original = await service.execute('read', { refs: [retry.items[0].ref], contextRef: status.contextRef,
    presentation: 'full', parts: ['projection'] });
  assert.match(original.items[0].parts[0].text, /SMALL_UNIQUE/u);
});

test('grouped publication rechecks the budget after another reader fills the final handle slot', async (t) => {
  const query = 'q'.repeat(2000);
  const fixture = await corpus(t, [query]);
  let queued = false;
  let previewBytes;
  const service = await fixture.create(factoryWithSeededHandles(49999, (presentation) => {
    const preview = presentation.preview;
    presentation.preview = (response, input) => {
      const output = preview(response, input);
      if (response.groups?.[0]?.state === 'complete' && response.scan.executedGroups > 0 && !queued) {
        queued = true;
        previewBytes = bytes(output);
        // Deterministically model a concurrent reader publishing in the await
        // boundary between groupedSearch's final check and execute's finish.
        queueMicrotask(() => presentation.project({ operation: 'history.search',
          items: [{ ref: 'er2.concurrent-reader' }] }));
      }
      return output;
    };
  }));
  const contextRef = (await service.execute('status')).contextRef;
  await assert.rejects(service.execute('search', { contextRef, maxBytes: 4096,
    groups: [{ id: 'group', query, maxBytes: 24000 }] }), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
  assert.equal(queued, true);
  assert.ok(previewBytes <= 4096, 'the compact preview fits before the concurrent publication');
});

test('group admission uses completed results when provisional retry inputs would suppress fitting groups', async (t) => {
  const fixture = await corpus(t, Array.from({ length: 4 }, (_, n) => `HIT ${n} ${'recorded fact '.repeat(8)}`));
  const service = await fixture.create();
  const cases = [
    Array.from({ length: 8 }, (_, n) => ({ id: `g${n}`, query: `absent${'x'.repeat(250)}` })),
    [{ id: 'hit', query: 'HIT', limit: 4, maxBytes: 24000 },
      { id: 'absent', query: 'MISSING', exclude: ['x'.repeat(2500)], maxBytes: 24000 }],
  ];
  for (const presentation of ['full', 'compact']) {
    for (const groups of cases) {
      const complete = await service.execute('search', { groups, presentation, maxBytes: 24000 });
      assert.ok(bytes(complete) <= 6000, 'the actual complete result fits the smaller budget');
      const limited = await service.execute('search', { groups, presentation, maxBytes: 6000 });
      assert.ok(bytes(limited) <= 6000);
      assert.deepEqual(limited.groups, complete.groups,
        'large provisional retry inputs must not hide fitting empty groups or earlier hits');
    }
  }
});
