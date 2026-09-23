'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createHistoryService } = require('../src/history-service');
const { requireSourceAdapter } = require('../src/source-adapters');

async function corpus(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-service-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  const directory = path.join(home, 'sessions', '2026', '09', '01');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(directory, { recursive: true });
  const sourceFile = path.join(directory, 'rollout-2026-09-01T00-00-00-11111111-1111-4111-8111-111111111111.jsonl');
  const rows = [];
  const add = (type, payload) => rows.push({ timestamp: `2026-09-01T00:00:${String(rows.length).padStart(2, '0')}.000Z`, type, payload });
  const message = (role, text) => add('response_item', { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
  const command = (id, cmd, output) => {
    add('response_item', { type: 'function_call', name: 'exec_command', call_id: id, arguments: JSON.stringify({ cmd }) });
    add('response_item', { type: 'function_call_output', call_id: id, output });
  };
  add('session_meta', { id: '11111111-1111-4111-8111-111111111111', cwd: repo, originator: 'codex_cli' });
  message('user', 'Earlier independent topic.');
  message('assistant', 'Earlier response.');
  message('user', 'Preserve exact counts when changing queryNeedle. 用户要求保留精确计数。');
  message('assistant', 'I propose splitting existence checking from complete counts.');
  command('inspect', 'cat src/query.js', 'function queryNeedle() { return count; }');
  command('prepare', 'node prepare.js', 'Preparation complete.');
  command('hit', 'node test-queryNeedle.js', Array.from({ length: 12 }, (_, i) => `Unrelated preface ${i}`).join('\n') + '\nline one\nline two\nNEEDLE   MATCH\nline four\nProcess exited with code 1');
  command('gap', 'node hidden-test.js', 'INTERNAL_GAP_EVIDENCE: validation failed.');
  command('gap2', 'node retry.js', 'Still investigating.');
  message('assistant', 'Progress update only; no final acceptance.');
  message('user', 'Reject that optimization. Keep the original count semantics.');
  message('assistant', 'Understood. The proposal was rejected.');
  message('user', 'Next independent topic.');
  message('assistant', `LONG_UNICODE ${'验证😀'.repeat(2500)}`);
  await fs.writeFile(sourceFile, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const options = { repo, source: 'codex', codexHome: home };
  const service = await createHistoryService(options);
  t.after(() => service.close());
  return { service, options, sourceFile, home, repo };
}

test('history search uses literal OR, exclusions, stable filters, complete coverage and query-bound cursors', async (t) => {
  const { service } = await corpus(t);
  const status = await service.execute('status');
  assert.equal(status.coverage.sessionCount, 1);
  assert.equal(status.coverage.source, 'codex');
  assert.equal(status.scan.complete, true);
  const found = await service.execute('search', { queries: ['needle match', 'queryNeedle'], retrievalArtifacts: 'include', limit: 1 });
  assert.ok(found.scan.matchedEvents >= 3);
  assert.equal(found.items.length, 1);
  assert.equal(found.hasMore, true);
  assert.ok(found.nextCursor);
  const next = await service.execute('search', { queries: ['needle match', 'queryNeedle'], retrievalArtifacts: 'include', limit: 1, cursor: found.nextCursor });
  assert.notEqual(next.items[0].ref, found.items[0].ref);
  await assert.rejects(service.execute('search', { queries: ['different'], retrievalArtifacts: 'include', cursor: found.nextCursor }), { code: 'INVALID_CURSOR' });
  const excluded = await service.execute('search', { queries: ['queryNeedle'], exclude: ['Preserve exact'], retrievalArtifacts: 'include' });
  assert.ok(excluded.items.length > 0);
  assert.ok(excluded.items.every((item) => item.kind !== 'user_message'));
  const user = await service.execute('search', { queries: ['queryNeedle'], kind: 'user_message' });
  assert.equal(user.items.length, 1);
  assert.equal((await service.execute('search', { queries: ['needle match'], status: 'does-not-exist' })).items.length, 0);
  assert.equal((await service.execute('search', { queries: ['needle match'], file: 'rollout-2026-09-01' })).items.length, 1);
  assert.equal((await service.execute('search', { queries: ['needle match'], file: 'unrelated-source' })).items.length, 0);
  assert.equal((await service.execute('search', { queries: ['status:failed'] })).items.length, 0);
  assert.equal((await service.execute('search', { queries: ['queryNeedle'], from: '2027-01-01' })).items.length, 0);
  const multiline = await service.execute('search', { queries: ['line two needle match'] });
  assert.equal(multiline.items.length, 1);
  assert.match(multiline.items[0].excerpt.text, /NEEDLE   MATCH/);
  assert.ok(multiline.items[0].excerpt.startLine > 1);
  const window = (await service.execute('context', { refs: [multiline.items[0].ref] })).items[0];
  assert.match(window.events.find((event) => event.anchor).excerpt.text, /NEEDLE   MATCH/);
  await assert.rejects(service.execute('search', { query: 'one', queries: ['two'] }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(service.execute('read', { refs: [user.items[0].ref], kind: 'user_message' }), { code: 'INVALID_ARGUMENT' });
  const invalidSignature = found.nextCursor.split('.').slice(0, 2).join('.') + '.' + '界'.repeat(43);
  await assert.rejects(service.execute('search', { cursor: invalidSignature }), { code: 'INVALID_CURSOR' });
});

test('Unicode-normalized hits preserve original projection offsets through context and read', async (t) => {
  const { options, sourceFile } = await corpus(t);
  const message = ' \t\n' + Array.from({ length: 12 }, (_, n) => `preface ${n}`).join('\n') + '\n😀 İSTANBUL\t\n  ΟΣ  ';
  await fs.appendFile(sourceFile, JSON.stringify({ timestamp: '2026-09-03T00:00:00Z', type: 'event_msg',
    payload: { type: 'user_message', message } }) + '\n');
  const service = await createHistoryService(options);
  t.after(() => service.close());
  for (const [query, expected] of [['i', 'İSTANBUL'], ['i\u0307stanbul', 'İSTANBUL'], ['i\u0307stanbul ος', 'İSTANBUL'], ['ος', 'ΟΣ']]) {
    const search = await service.execute('search', { queries: [query], kind: 'user_message' });
    const hit = search.items.find((item) => item.excerpt.text.includes(expected));
    assert.ok(hit, query);
    const full = (await service.execute('read', { refs: [hit.ref], parts: ['projection'], length: 10000 })).items[0].parts[0].text;
    assert.equal(hit.excerpt.hitOffset, full.indexOf(expected), query);
    const window = (await service.execute('context', { refs: [hit.ref] })).items[0];
    assert.equal(window.events.find((item) => item.anchor).excerpt.hitOffset, hit.excerpt.hitOffset);
    const focused = await service.execute('read', { refs: [hit.ref], parts: ['projection'], offset: hit.excerpt.hitOffset, length: expected.length });
    assert.equal(focused.items[0].parts[0].text, expected);
  }
});

test('unrelated stale source does not block matching evidence under any artifact policy', async (t) => {
  const { options, sourceFile, repo } = await corpus(t);
  const unrelated = path.join(path.dirname(sourceFile), 'rollout-2026-09-02T00-00-00-22222222-2222-4222-8222-222222222222.jsonl');
  await fs.writeFile(unrelated, [
    { timestamp: '2026-09-02T00:00:00Z', type: 'session_meta', payload: { id: '22222222-2222-4222-8222-222222222222', cwd: repo } },
    { timestamp: '2026-09-02T00:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Unrelated session-analyzer documentation' } },
  ].map(JSON.stringify).join('\n') + '\n');
  const service = await createHistoryService(options);
  t.after(() => service.close());
  const before = await service.execute('search', { queries: ['queryNeedle'] });
  await fs.unlink(unrelated);
  for (const retrievalArtifacts of ['exclude', 'include', 'only']) {
    const after = await service.execute('search', { queries: ['queryNeedle'], retrievalArtifacts });
    assert.equal(after.scan.complete, true);
    assert.equal(after.scan.scannedEvents, before.scan.scannedEvents);
    assert.equal(after.scan.matchedEvents, retrievalArtifacts === 'only' ? 0 : before.scan.matchedEvents);
    assert.equal(after.scan.retrievalArtifacts.recognized, 0);
  }
});

test('batched pagination validates only requested items, leaving later refs for their own page', async (t) => {
  const { service } = await corpus(t);
  const found = await service.execute('search', { queries: ['Earlier independent'] });
  const refs = [found.items[0].ref, 'invalid-later-ref'];
  for (const operation of ['context', 'read']) {
    const first = await service.execute(operation, { refs, limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true);
    await assert.rejects(service.execute(operation, { refs, limit: 1, cursor: first.nextCursor }), { code: 'INVALID_REFERENCE' });
  }
});

test('compact evidence remains durable and legacy evidence remains readable', async (t) => {
  const { service, options } = await corpus(t);
  const hit = (await service.execute('search', { queries: ['Earlier independent'] })).items[0];
  assert.ok(hit.ref.length < 130);
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
  const index = await requireSourceAdapter('codex').buildIndex({ repoRoot: options.repo, sourceHome: options.codexHome });
  const session = index.sessionsById.get(hit.sessionId);
  const old = 'er1.' + Buffer.from(JSON.stringify({
    p: hash([index.repoRoot, 'codex', path.resolve(options.codexHome)]), s: session.id,
    v: hash([session.materializationDescriptor.sourceSnapshotId, session.queryProjectionDigest]), l: 'main', e: hit.eventId,
  })).toString('base64url');
  const read = await service.execute('read', { refs: [old], parts: ['message'] });
  assert.match(read.items[0].parts[0].text, /Earlier independent/);
  const restarted = await createHistoryService(options);
  t.after(() => restarted.close());
  assert.equal((await restarted.execute('read', { refs: [hit.ref] })).items[0].ref, hit.ref);
});

test('backward navigation with a smaller limit does not skip unread events', async (t) => {
  const { service } = await corpus(t);
  const all = (await service.execute('search', { layer: 'raw', limit: 100, maxBytes: 100000 })).items;
  const last = (await service.execute('context', { refs: [all.at(-1).ref], limit: 8 })).items[0];
  const firstVisible = all.findIndex((event) => event.eventId === last.events[0].eventId);
  const visited = [];
  let previous = last.previous;
  while (previous) {
    const page = (await service.execute('context', { refs: [previous], limit: 1 })).items[0];
    visited.push(page.events[0].eventId);
    previous = page.previous;
  }
  assert.deepEqual(visited, all.slice(0, firstVisible).reverse().map((event) => event.eventId));
});

test('consecutive message and layer-local boundaries are explicit and deduplicated', async (t) => {
  const { options, sourceFile } = await corpus(t);
  for (const message of ['boundaryAlpha', 'boundaryBeta']) {
    await fs.appendFile(sourceFile, JSON.stringify({ timestamp: '2026-09-02T00:00:00Z', type: 'event_msg', payload: { type: 'user_message', message } }) + '\n');
  }
  const service = await createHistoryService(options);
  t.after(() => service.close());
  const hit = (await service.execute('search', { queries: ['boundaryBeta'] })).items[0];
  const window = (await service.execute('context', { refs: [hit.ref] })).items[0];
  assert.equal(window.events.filter((event) => event.anchor).length, 1);
  assert.equal(window.events.length, 2);
  assert.equal(window.boundaries.previousAssistant, 'absent');
  assert.equal(window.boundaries.nextAssistant, 'absent');
  assert.equal(window.boundaries.nextUser, 'absent');
  const raw = (await service.execute('search', { queries: ['boundaryBeta'], layer: 'raw' })).items[0];
  const local = (await service.execute('context', { refs: [raw.ref] })).items[0];
  assert.equal(local.boundaries.mode, 'layer_local');
  assert.equal(local.boundaries.messageAnchors, 'not_available_on_this_layer');
});

test('artifact filtering happens before top K and preserves documentation and mixed commands', async (t) => {
  const { options, sourceFile } = await corpus(t);
  const rows = [];
  const add = (payload) => rows.push({ timestamp: '2026-09-02T00:00:00.000Z', type: 'response_item', payload });
  const command = (call_id, cmd) => {
    add({ type: 'function_call', name: 'exec_command', call_id, arguments: JSON.stringify({ cmd }) });
    add({ type: 'function_call_output', call_id, output: 'ECHO_TARGET in returned evidence.' });
  };
  command('retrieval-1', 'session-analyzer history search --query ECHO_TARGET');
  command('retrieval-2', 'npx --yes session-analyzer history read --ref fake');
  add({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Documentation ECHO_TARGET: session-analyzer history search --query ECHO_TARGET' }] });
  command('mixed-retrieval', 'session-analyzer history search --query ECHO_TARGET && node important-test.js');
  await fs.appendFile(sourceFile, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const service = await createHistoryService(options);
  t.after(() => service.close());
  const excluded = await service.execute('search', { queries: ['ECHO_TARGET'], limit: 1 });
  assert.equal(excluded.items.length, 1);
  assert.match(excluded.items[0].excerpt.text, /Documentation|important-test/);
  assert.equal(excluded.scan.retrievalArtifacts.excluded, 2);
  assert.equal(excluded.scan.matchedEvents, 2);
  const include = await service.execute('search', { queries: ['ECHO_TARGET'], retrievalArtifacts: 'include' });
  assert.equal(include.items.length, 4);
  const only = await service.execute('search', { queries: ['ECHO_TARGET'], retrievalArtifacts: 'only' });
  assert.equal(only.items.length, 2);
  assert.ok(only.items.every((item) => item.retrievalArtifact));
  const raw = await service.execute('search', { queries: ['ECHO_TARGET'], layer: 'raw', retrievalArtifacts: 'only' });
  assert.ok(raw.items.length >= 2);
});

test('context expands unfiltered message boundaries, exposes internal gaps and supports monotone range navigation', async (t) => {
  const { service } = await corpus(t);
  const found = await service.execute('search', { queries: ['needle match'], tool: 'exec_command' });
  assert.equal(found.items.length, 1);
  const result = await service.execute('context', { refs: [found.items[0].ref], maxBytes: 20000 });
  const window = result.items[0];
  assert.deepEqual(window.events.map((event) => event.kind), ['user_message', 'assistant_message', 'other_tool_call', 'assistant_message', 'user_message']);
  assert.match(window.events[0].excerpt.text, /Preserve exact/);
  assert.match(window.events.at(-1).excerpt.text, /Reject that optimization/);
  assert.equal(window.relation, 'adjacent_in_session');
  assert.equal(window.gaps.length, 2);
  const gapItems = [];
  for (const gap of window.gaps) {
    let ref = gap.ref;
    let remaining = gap.count;
    while (remaining > 0) {
      const page = (await service.execute('context', { refs: [ref], limit: 1 })).items[0];
      assert.equal(page.events.length, 1);
      gapItems.push(page.events[0]);
      remaining -= 1;
      if (remaining) { assert.ok(page.next); assert.notEqual(page.next, ref); ref = page.next; }
    }
  }
  assert.ok(gapItems.some((event) => event.excerpt.text.includes('INTERNAL_GAP_EVIDENCE')));
  assert.equal(new Set(gapItems.map((event) => event.ref)).size, gapItems.length);
  for (const navigation of ['previous', 'next']) {
    assert.ok(window[navigation]);
    const page = await service.execute('context', { refs: [window[navigation]] });
    assert.ok(page.items[0].events.length);
  }
  const user = await service.execute('search', { queries: ['Earlier independent topic'], kind: 'user_message' });
  const first = (await service.execute('context', { refs: [user.items[0].ref] })).items[0];
  assert.equal(first.boundaries.previousUser, 'absent');
  assert.equal(new Set(first.events.map((event) => event.ref)).size, first.events.length);
});

test('batch precise read, raw evidence and content continuation retain verifiable content', async (t) => {
  const { service } = await corpus(t);
  const messages = await service.execute('search', { queries: ['queryNeedle', 'needle match'], limit: 8 });
  const refs = messages.items.map((item) => item.ref);
  const read = await service.execute('read', { refs, parts: ['message', 'request', 'result', 'raw'], length: 1000 });
  assert.equal(read.items.length, refs.length);
  assert.ok(read.items.every((item) => item.rawRefs.length));
  const tool = read.items.find((item) => item.parts.some((part) => part.part === 'request' && part.available));
  assert.ok(tool);
  assert.ok(tool.parts.some((part) => part.part === 'result' && part.available));
  const raw = await service.execute('read', { refs: [tool.rawRefs[0]], parts: ['raw'], length: 10000 });
  assert.ok(JSON.parse(raw.items[0].parts[0].text).rawId);
  const long = (await service.execute('search', { queries: ['LONG_UNICODE'] })).items[0];
  let offset = 0;
  let combined = '';
  do {
    const page = await service.execute('read', { refs: [long.ref], parts: ['projection'], offset, length: 101 });
    const part = page.items[0].parts[0];
    combined += part.text;
    offset = part.nextOffset;
  } while (offset !== null);
  const complete = await service.execute('read', { refs: [long.ref], parts: ['projection'], length: 20000, maxBytes: 100000 });
  assert.equal(combined, complete.items[0].parts[0].text);
  assert.match(combined, /验证😀/);
  const paged = await service.execute('read', { refs, parts: ['projection'], limit: 1 });
  assert.equal(paged.hasMore, true);
  const nextPage = await service.execute('read', { refs, parts: ['projection'], limit: 1, cursor: paged.nextCursor });
  assert.equal(nextPage.items[0].ref, refs[1]);
  await assert.rejects(service.execute('read', { refs, parts: ['raw'], cursor: paged.nextCursor }), { code: 'INVALID_CURSOR' });
});

test('duplicate part selectors preserve raw-link continuation and equivalent batch cursors', async (t) => {
  const { service } = await corpus(t);
  const hits = await service.execute('search', { queries: ['node hidden-test.js', 'node retry.js'] });
  const refs = hits.items.map((item) => item.ref);
  assert.equal(refs.length, 2);
  const first = await service.execute('read', { refs: [refs[0]], parts: ['raw', 'raw'], limit: 1 });
  assert.equal(first.items[0].parts.length, 1);
  assert.equal(first.items[0].rawRefsNextOffset, 1);
  const next = await service.execute('read', { refs: [refs[0]], parts: ['raw', 'raw'], limit: 1,
    offset: first.items[0].rawRefsNextOffset });
  assert.equal(next.items[0].rawRefsOffset, 1);
  assert.notEqual(next.items[0].rawRefs[0], first.items[0].rawRefs[0]);
  assert.equal(next.items[0].rawRefsNextOffset, null);
  const batch = await service.execute('read', { refs, parts: ['projection', 'projection'], limit: 1 });
  assert.equal(batch.items[0].parts.length, 1);
  const remainder = await service.execute('read', { refs, parts: ['projection'], limit: 1, cursor: batch.nextCursor });
  assert.equal(remainder.items[0].ref, refs[1]);
  assert.equal(remainder.hasMore, false);
});

test('persistent refs survive restart while contexts and cursors expire; source/scope changes reject', async (t) => {
  const { service, options, sourceFile, home } = await corpus(t);
  const found = await service.execute('search', { queries: ['queryNeedle'], limit: 1 });
  const ref = found.items[0].ref;
  const restarted = await createHistoryService(options);
  t.after(() => restarted.close());
  assert.equal((await restarted.execute('read', { refs: [ref] })).items[0].ref, ref);
  await assert.rejects(restarted.execute('read', { refs: [ref], contextRef: found.contextRef }), { code: 'CONTEXT_EXPIRED' });
  await assert.rejects(restarted.execute('search', { queries: ['queryNeedle'], cursor: found.nextCursor }), { code: 'INVALID_CURSOR' });
  const otherRepo = path.join(home, 'other-repo');
  await fs.mkdir(otherRepo);
  const other = await createHistoryService({ ...options, repo: otherRepo });
  t.after(() => other.close());
  await assert.rejects(other.execute('read', { refs: [ref] }), { code: 'REFERENCE_SCOPE_MISMATCH' });
  await fs.appendFile(sourceFile, JSON.stringify({ timestamp: '2026-09-02T00:00:00.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'New source content.' } }) + '\n');
  const preserved = await service.execute('read', { refs: [ref], parts: ['message'] });
  assert.match(preserved.items[0].parts[0].text, /Preserve exact counts/);
  const changed = await createHistoryService(options);
  t.after(() => changed.close());
  await assert.rejects(changed.execute('read', { refs: [ref] }), { code: 'STALE_REFERENCE' });
  const source = await fs.readFile(sourceFile, 'utf8');
  await fs.writeFile(sourceFile, source.replace('Preserve exact counts', 'Preserve wrong counts'));
  await assert.rejects(service.execute('read', { refs: [ref] }), { code: 'STALE_REFERENCE' });
  await fs.unlink(sourceFile);
  await assert.rejects(restarted.execute('read', { refs: [ref] }), { code: 'STALE_REFERENCE' });
});

test('UTF-8 output budgets are enforced for multibyte text and resume without losing candidates', async (t) => {
  const { service } = await corpus(t);
  const search = await service.execute('search', { maxBytes: 6000, limit: 100 });
  assert.ok(Buffer.byteLength(JSON.stringify(search)) <= 6000);
  assert.equal(search.truncated, true);
  const allRefs = [...search.items.map((item) => item.ref)];
  let cursor = search.nextCursor;
  while (cursor) {
    const page = await service.execute('search', { maxBytes: 6000, limit: 100, cursor });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 6000);
    allRefs.push(...page.items.map((item) => item.ref));
    cursor = page.nextCursor;
  }
  assert.equal(new Set(allRefs).size, allRefs.length);
  assert.equal(allRefs.length, search.scan.matchedEvents);
  const long = (await service.execute('search', { queries: ['LONG_UNICODE'] })).items[0];
  await assert.rejects(service.execute('read', { refs: [long.ref], parts: ['projection'], length: 20000, maxBytes: 4096 }), { code: 'OUTPUT_BUDGET_TOO_SMALL' });
});

test('existing Codex, Claude Code and DeepSeek sources support history search/context/read', async (t) => {
  const { home, repo } = await corpus(t);
  const claudeHome = path.join(home, 'claude');
  const project = path.join(claudeHome, 'projects', '-history-test');
  await fs.mkdir(project, { recursive: true });
  const content = await fs.readFile(path.join(__dirname, 'fixtures', 'claude', 'semantic-lifecycle.jsonl'), 'utf8');
  await fs.writeFile(path.join(project, 'semantic-lifecycle.jsonl'), content.replaceAll('__REPO_ROOT__', repo.replaceAll('\\', '\\\\')));
  for (const options of [
    { source: 'codex', repo: 'G:\\vibe\\term-agent', codexHome: path.join(__dirname, 'fixtures', 'codex-home') },
    { source: 'claude-code', repo, claudeHome },
    { source: 'deepseek-harness', repo: '/home/joejack/dsh_playground/spike/ws/normal', dshHome: path.join(__dirname, 'fixtures', 'deepseek-harness-uncompressed', 'sessions') },
  ]) {
    const service = await createHistoryService(options);
    t.after(() => service.close());
    const found = await service.execute('search', { limit: 1, retrievalArtifacts: 'include' });
    assert.ok(found.coverage.sessionCount > 0, options.source);
    assert.equal(found.items.length, 1, options.source);
    assert.equal((await service.execute('context', { refs: [found.items[0].ref], maxBytes: 100000 })).items.length, 1);
    const read = await service.execute('read', { refs: [found.items[0].ref], parts: ['projection', 'raw'] });
    assert.equal(read.items[0].parts[0].available, true);
    assert.ok(read.items[0].rawRefs.length);
  }
});
