'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { zstdCompressSync } = require('node:zlib');
const { createHistorySourceObservation } = require('../src/history-source-observation');
const { createHistoryService } = require('../src/history-service');
const { createHistoryServer } = require('../src/history-server');
const { requestHistory, parseHistoryArgs } = require('../src/history-cli');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'history-observe-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'repo');
  const root = path.join(home, 'sessions');
  await fs.mkdir(repo);
  await fs.mkdir(root);
  const message = (text) => JSON.stringify({ timestamp: '2026-10-22T00:00:01Z', type: 'event_msg',
    payload: { type: 'user_message', message: text } }) + '\n';
  async function write(name, id, cwd = repo, text = 'BASE_EVIDENCE', compressed = false) {
    const file = path.join(root, name);
    const data = JSON.stringify({ timestamp: '2026-10-22T00:00:00Z', type: 'session_meta', payload: { id, cwd } })
      + '\n' + message(text);
    await fs.writeFile(file, compressed ? zstdCompressSync(Buffer.from(data)) : data);
    return file;
  }
  async function service(extra = {}) {
    const value = await createHistoryService({ repo, source: 'codex', codexHome: home, ...extra });
    t.after(() => value.close());
    return value;
  }
  return { home, root, repo, write, message, service };
}

async function observer(f, options = {}, index = { sessions: [] }) {
  const value = await createHistorySourceObservation({ sourceHome: f.home, ...options });
  await value.bindIndex(index, { startedAt: '2026-10-22T00:00:00Z', endedAt: '2026-10-22T00:00:01Z' });
  return value;
}

test('explicit observation separates continuous caller growth without changing evidence, cursor or viewer', async (t) => {
  const f = await fixture(t);
  const callerFile = await f.write('caller.jsonl', 'caller');
  await f.write('other.jsonl', 'other');
  const service = await f.service();
  const server = createHistoryServer(service);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const status = await requestHistory(endpoint, 'status', {});
  assert.ok(status.capabilities.operations.includes('observe'));
  const query = { query: 'BASE_EVIDENCE', limit: 1 };
  const first = await requestHistory(endpoint, 'search', query);
  const callerId = (await service.execute('search', { query: 'BASE_EVIDENCE', limit: 8 })).items
    .find((item) => item.sessionId.includes('caller')).sessionId;
  const opened = await requestHistory(endpoint, 'open', { refs: [first.items[0].ref] });
  const baseline = await requestHistory(endpoint, 'observe', { callerSessionId: callerId });
  assert.equal(baseline.observation.counts.metadata_unchanged, 2);
  assert.equal(baseline.observation.partial, false);
  const originalBytes = (await fs.stat(callerFile, { bigint: true })).size.toString();
  for (let n = 0; n < 3; n += 1) {
    await fs.appendFile(callerFile, f.message(`LATER_EVIDENCE ${n}`));
    const result = await requestHistory(endpoint, 'observe', { callerSessionId: callerId,
      presentation: 'compact', contextRef: status.contextRef });
    assert.equal(result.coverageRef, status.contextRef);
    assert.equal(result.observation.caller.indexedSessionMatched, true);
    assert.equal(result.observation.caller.counts.size_increased, 1);
    assert.equal(result.observation.other.counts.metadata_unchanged, 1);
    assert.equal(result.items[0].baseline.metadata.size, originalBytes);
    assert.equal(result.items[0].callerAssociation, 'caller_associated');
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
    assert.equal(JSON.stringify(result).includes('refreshRequired'), false);
    assert.equal((await requestHistory(endpoint, 'search', { query: 'LATER_EVIDENCE' })).items.length, 0);
    assert.equal((await requestHistory(endpoint, 'open', { refs: [first.items[0].ref] })).url, opened.url);
    assert.deepEqual((await requestHistory(endpoint, 'status', {})).coverage, status.coverage);
  }
  const second = await requestHistory(endpoint, 'search', { ...query, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].sessionId, first.items[0].sessionId);
  const read = await requestHistory(endpoint, 'read', { refs: [first.items[0].ref], parts: ['projection'] });
  assert.match(read.items[0].parts[0].text, /BASE_EVIDENCE/u);
  const fresh = await f.service();
  assert.equal((await fresh.execute('search', { query: 'LATER_EVIDENCE' })).items.length, 3);
  await assert.rejects(fresh.execute('search', { ...query, cursor: first.nextCursor }), { code: 'INVALID_CURSOR' });
  assert.equal((await service.execute('search', { query: 'LATER_EVIDENCE' })).items.length, 0);
});

test('a task can retain an old decision cutoff or explicitly verify a later decision without chasing caller appends', async (t) => {
  const f = await fixture(t);
  const caller = await f.write('caller.jsonl', 'caller', f.repo, 'Investigating retry policy');
  const decisions = await f.write('decisions.jsonl', 'decisions', f.repo, 'DECISION: retry policy permits automatic retry.');
  const old = await f.service();
  const query = { query: 'DECISION:', session: 'decisions' };
  const initial = await old.execute('search', query);
  await fs.appendFile(caller, f.message('Searching project history'));
  await fs.appendFile(decisions, f.message('DECISION: replace automatic retry with explicit user retry after failed writes.'));
  const changed = await old.execute('observe', { callerSessionId: 'caller' });
  assert.equal(changed.observation.caller.counts.size_increased, 1);
  assert.equal(changed.observation.other.counts.size_increased, 1);
  assert.equal((await old.execute('search', query)).items.length, 1);
  const oldRead = await old.execute('read', { refs: [initial.items[0].ref], parts: ['projection'] });
  assert.match(oldRead.items[0].parts[0].text, /permits automatic retry/u);

  const fresh = await f.service();
  const freshStatus = await fresh.execute('status');
  const later = await fresh.execute('search', { ...query, query: 'replace automatic retry' });
  assert.equal(later.items.length, 1);
  const latestRead = await fresh.execute('read', { refs: [later.items[0].ref], parts: ['projection'] });
  assert.match(latestRead.items[0].parts[0].text, /explicit user retry after failed writes/u);
  await fs.appendFile(caller, f.message('Read later policy and prepare evidence handoff'));
  const observed = await fresh.execute('observe', { callerSessionId: 'caller' });
  assert.equal(observed.observation.caller.counts.size_increased, 1);
  assert.equal(observed.observation.other.counts.metadata_unchanged, 1);
  assert.deepEqual((await fresh.execute('status')).coverage, freshStatus.coverage);
  assert.equal((await old.execute('search', query)).items.length, 1);
  assert.equal((await fresh.execute('search', query)).items.length, 2);
});

test('a later snapshot filters recorded observe output while retaining ordinary discussion', async (t) => {
  const f = await fixture(t);
  const file = await f.write('one.jsonl', 'one');
  const original = await f.service();
  const report = await original.execute('observe', { callerSessionId: 'one' });
  const rows = [
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'observe-call',
      arguments: JSON.stringify({ cmd: 'session-analyzer history observe --caller-session one' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'observe-call', output: JSON.stringify(report) } },
  ].map((row) => JSON.stringify({ timestamp: '2026-10-22T00:00:02Z', ...row })).join('\n') + '\n';
  await fs.appendFile(file, rows + f.message('Documentation: history observe reports metadata_only, which does not verify content.'));
  assert.equal((await original.execute('search', { query: 'metadata_only' })).items.length, 0);
  const later = await f.service();
  for (const layer of ['main', 'raw']) {
    const query = { query: 'metadata_only', layer };
    const excluded = await later.execute('search', query);
    assert.equal(excluded.items.length, 1, `${layer}: default excludes the generated report`);
    assert.match(excluded.items[0].excerpt.text, /Documentation/u);
    assert.equal(excluded.scan.retrievalArtifacts.excluded, 1);
    const included = await later.execute('search', { ...query, retrievalArtifacts: 'include' });
    assert.equal(included.items.length, 2);
    const only = await later.execute('search', { ...query, retrievalArtifacts: 'only' });
    assert.equal(only.items.length, 1);
    assert.equal(only.items[0].retrievalArtifact, true);
    assert.equal(only.scan.retrievalArtifacts.recognized, 1);
  }
});

test('new caller and unrelated candidates stay unassociated and project membership is not inferred', async (t) => {
  const f = await fixture(t);
  await f.write('existing.jsonl', 'existing');
  const service = await f.service();
  await f.write('new-caller.jsonl', 'new-caller');
  await f.write('outside-project.jsonl', 'foreign', path.join(f.home, 'unrelated'));
  const result = await service.execute('observe', { callerSessionId: 'new-caller' });
  assert.equal(result.observation.counts.new_candidate, 2);
  assert.equal(result.observation.caller.indexedSessionMatched, false);
  assert.equal(result.observation.other.counts.new_candidate, 2);
  assert.equal(result.items.every((item) => item.projectMembership === 'not_checked' && item.callerAssociation === 'unattributed'), true);
  assert.equal((await service.execute('status')).coverage.sessionCount, 1);
});

test('disconnecting an observation does not advance its baseline and a deliberate retry has no cursor', async (t) => {
  const f = await fixture(t);
  const file = await f.write('one.jsonl', 'one');
  const service = await f.service();
  await fs.appendFile(file, f.message('after indexing'));
  const entered = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const finished = Promise.withResolvers();
  let first = true;
  const server = createHistoryServer({ async execute(operation, input) {
    if (first) {
      first = false;
      entered.resolve();
      await gate.promise;
      try { return await service.execute(operation, input); } finally { finished.resolve(); }
    }
    return service.execute(operation, input);
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const request = http.request(endpoint + '/api/history/observe', { method: 'POST',
    headers: { 'content-type': 'application/json' } });
  const closed = new Promise((resolve) => request.once('close', resolve));
  request.on('error', () => {});
  request.end('{}');
  await entered.promise;
  request.destroy();
  gate.resolve();
  await Promise.all([closed, finished.promise]);
  const retried = await requestHistory(endpoint, 'observe', {});
  assert.equal(retried.observation.counts.size_increased, 1);
  assert.equal(retried.nextCursor, null);
  assert.equal((await service.execute('search', { query: 'after indexing' })).items.length, 0);
  const invalid = await fetch(endpoint + '/api/history/observe', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{"cursor":"not-supported"}' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error.message, /without cursor continuation/u);
});

test('physical baselines include both storage siblings and do not use decoded or accepted lengths', async (t) => {
  const f = await fixture(t);
  const plain = await f.write('plain.jsonl', 'plain', f.repo, 'SAME ' + 'x'.repeat(10000));
  await f.write('plain.jsonl.zst', 'plain', f.repo, 'SAME ' + 'x'.repeat(10000), true);
  const compressed = await f.write('compressed.jsonl.zst', 'compressed', f.repo, 'ZIP ' + 'x'.repeat(10000), true);
  await fs.appendFile(plain, '{"incomplete":');
  const service = await f.service();
  const initial = await service.execute('observe');
  assert.equal(initial.observation.counts.metadata_unchanged, 3);
  assert.equal(initial.items.length, 0);
  await fs.appendFile(compressed, Buffer.from('suffix'));
  const changed = await service.execute('observe');
  assert.equal(changed.items[0].physicalPath, compressed);
  assert.equal(changed.items[0].change, 'size_increased');
  assert.equal(changed.items[0].projectMembership, 'indexed_dependency');
  assert.ok(BigInt(changed.items[0].baseline.metadata.size) < 10000n);
  await fs.unlink(plain);
  const deleted = await service.execute('observe');
  assert.equal(deleted.observation.counts.missing, 1);
  assert.equal(deleted.observation.counts.new_candidate, 0);
});

test('metadata checks do not relax strict evidence verification after a rewrite', async (t) => {
  const f = await fixture(t);
  const file = await f.write('evidence.jsonl', 'evidence');
  const service = await f.service();
  const hit = (await service.execute('search', { query: 'BASE_EVIDENCE' })).items[0].ref;
  const before = await fs.stat(file);
  const data = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, data.replace('BASE_EVIDENCE', 'FAKE_EVIDENCE'));
  await fs.utimes(file, before.atime, before.mtime);
  const result = await service.execute('observe');
  assert.equal(result.observation.strength, 'metadata_only');
  assert.match(result.observation.interpretation, /does not verify content/u);
  await assert.rejects(service.execute('read', { refs: [hit] }), { code: 'STALE_REFERENCE' });
});

test('bounded output preserves complete measured counts and has no misleading continuation', async (t) => {
  const f = await fixture(t);
  const file = await f.write('caller.jsonl', 'caller');
  const service = await f.service();
  const callerSessionId = (await service.execute('search', { query: 'BASE_EVIDENCE' })).items[0].sessionId;
  await fs.appendFile(file, f.message('later'));
  for (let n = 0; n < 10; n += 1) await f.write(`new-${n}.jsonl`, `new-${n}`);
  const result = await service.execute('observe', { callerSessionId, limit: 1 });
  assert.equal(result.observation.counts.new_candidate, 10);
  assert.equal(result.observation.caller.counts.size_increased, 1);
  assert.equal(result.observation.itemsOmitted, 10);
  assert.equal(result.observation.other.detailsOmitted, 10);
  assert.equal(result.observation.caller.detailsOmitted, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.hasMore, false);
  const compact = await service.execute('observe', { callerSessionId, maxBytes: 4096,
    presentation: 'compact', contextRef: result.contextRef });
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 4096);
  assert.equal(compact.observation.counts.new_candidate, 10);
  assert.equal(compact.observation.itemsOmitted, 11 - compact.items.length);
  const partial = await service.execute('observe', { maxFiles: 1 });
  assert.equal(partial.observation.partial, true);
  assert.ok(partial.observation.gaps.file_budget);
  assert.equal(partial.scan.complete, false);
});

test('incomplete baseline never promotes a later discovery to a confirmed new candidate', async (t) => {
  const f = await fixture(t);
  await f.write('one.jsonl', 'one');
  await f.write('two.jsonl', 'two');
  const value = await observer(f, { maxFiles: 1 });
  await f.write('three.jsonl', 'three');
  const result = await value.observe({ maxFiles: 10 });
  assert.equal(result.observation.baseline.complete, false);
  assert.equal(result.observation.counts.new_candidate, 0);
  assert.equal(result.observation.counts.prior_existence_unknown, 2);
  assert.equal(result.observation.partial, true);
});

test('stat and directory failures are unknown rather than deletion or freshness', async (t) => {
  const f = await fixture(t);
  const file = await f.write('one.jsonl', 'one');
  let failStat = false;
  let failDirectory = false;
  const io = { ...fs,
    async lstat(target, options) {
      if (failStat && target === file) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.lstat(target, options);
    },
    async opendir(target) {
      if (failDirectory) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return fs.opendir(target);
    } };
  const value = await observer(f, { io });
  failStat = true;
  failDirectory = true;
  const result = await value.observe();
  assert.equal(result.observation.counts.unreadable, 1);
  assert.equal(result.observation.counts.missing, 0);
  assert.equal(result.observation.partial, true);
  assert.equal(result.items[0].current.code, 'EACCES');
});

test('time and directory entry bounds report incomplete work including unobserved known files', async (t) => {
  const f = await fixture(t);
  const one = await f.write('one.jsonl', 'one');
  const two = await f.write('two.jsonl', 'two');
  let ticks = 0;
  let advance = false;
  const value = await observer(f, { now: () => { if (advance) ticks += 100; return ticks; }, maxDurationMs: 50 });
  advance = true;
  const timed = await value.observe();
  assert.equal(timed.observation.counts.unobserved, 2);
  assert.equal(timed.observation.gaps.time_budget, 1);
  assert.equal(timed.observation.partial, true);
  await fs.unlink(one);
  await fs.unlink(two);
  let reads = 0;
  let closes = 0;
  const io = { ...fs, async opendir() { return {
    async read() { reads += 1; return { name: `ignored-${reads}.tmp`, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }; },
    async close() { closes += 1; },
  }; } };
  const bounded = await observer(f, { io, maxFiles: 1 });
  const result = await bounded.observe({ maxFiles: 1 });
  assert.equal(result.observation.gaps.directory_entry_budget, 1);
  assert.equal(reads, 2022);
  assert.equal(closes, 2);
});

test('post-index archived dependencies are sampled once and retain shared ownership', async (t) => {
  const f = await fixture(t);
  const archive = path.join(f.home, 'archived_sessions');
  await fs.mkdir(archive);
  const file = path.join(archive, 'ancestor.jsonl.zst');
  await fs.writeFile(file, zstdCompressSync(Buffer.from('ancestor')));
  await fs.writeFile(path.join(archive, 'unadmitted.jsonl'), 'not in observation scope');
  const entry = { role: 'history_transcript', pathIdentity: '../archived_sessions/ancestor.jsonl',
    kind: 'file', policy: 'accepted_prefix', existence: 'present', acceptedBytes: 999999,
    evidence: { fileIdentity: { compression: 'zstd' } } };
  const index = { sessions: ['parent', 'child'].map((id) => ({ id, materializationDescriptor: { dependencySetId: 'shared' } })),
    materializationDependencies: new Map([['shared', { entries: [entry] }]]) };
  const value = await observer(f, {}, index);
  assert.equal((await value.observe()).observation.counts.metadata_unchanged, 1);
  await fs.appendFile(file, 'suffix');
  const result = await value.observe({ callerSessionId: 'child' });
  assert.equal(result.observation.sampledFiles, 1);
  assert.equal(result.observation.caller.counts.size_increased, 1);
  assert.deepEqual(result.items[0].indexedSessionIds, ['parent', 'child']);
  assert.equal(result.items[0].baseline.basis, 'post_index_dependency_observation');
});

test('missing candidate root stays an incomplete baseline when it later becomes available', async (t) => {
  const f = await fixture(t);
  await fs.rmdir(f.root);
  const value = await observer(f);
  await fs.mkdir(f.root);
  await f.write('appeared.jsonl', 'appeared');
  const result = await value.observe();
  assert.ok(result.observation.baseline.gaps.ENOENT);
  assert.equal(result.observation.counts.prior_existence_unknown, 1);
  assert.equal(result.observation.counts.new_candidate, 0);
});

test('lossless physical metadata distinguishes shrink, identity replacement and unchanged samples without mutating its baseline', async (t) => {
  const f = await fixture(t);
  const file = await f.write('one.jsonl', 'one');
  const original = await fs.stat(file, { bigint: true });
  const large = 9007199254740999n;
  let size = large;
  let inode = original.ino;
  const io = { ...fs, async lstat(target, options) {
    const stat = await fs.lstat(target, options);
    return target === file && options?.bigint
      ? Object.assign(stat, { size, ino: inode, mtimeNs: 1234567890123456789n, ctimeNs: 1234567890123456790n }) : stat;
  } };
  const value = await observer(f, { io });
  assert.equal((await value.observe()).observation.counts.metadata_unchanged, 1);
  size -= 1n;
  const shrunk = await value.observe();
  assert.equal(shrunk.items[0].change, 'size_decreased');
  assert.equal(shrunk.items[0].baseline.metadata.size, large.toString());
  shrunk.items[0].baseline.metadata.size = '0';
  assert.equal((await value.observe()).items[0].baseline.metadata.size, large.toString());
  inode += 1n;
  assert.equal((await value.observe()).observation.counts.identity_changed, 1);
});

test('directory symlinks are not followed for candidates or previously sampled paths', async (t) => {
  const f = await fixture(t);
  await f.write('one.jsonl', 'one');
  let replaced = false;
  const io = { ...fs, async lstat(target, options) {
    if (replaced && target === f.root) return { isSymbolicLink: () => true };
    if (replaced && target.startsWith(f.root + path.sep)) assert.fail('must not stat through the replaced directory');
    return fs.lstat(target, options);
  } };
  const value = await observer(f, { io });
  replaced = true;
  const result = await value.observe();
  assert.equal(result.observation.counts.unreadable, 1);
  assert.equal(result.observation.partial, true);
  assert.ok(result.observation.gaps.SYMLINK_NOT_FOLLOWED);
});

test('observe rejects retrieval fields and unsafe bounds with legal recovery and unsupported-source reporting', async (t) => {
  const f = await fixture(t);
  await f.write('one.jsonl', 'one');
  const service = await f.service();
  for (const input of [{ cursor: 'anything' }, { source: { sourcePath: '/arbitrary' } }, { query: 'text' }]) {
    await assert.rejects(service.execute('observe', input), { code: 'INVALID_ARGUMENT', message: /observe does not accept.*Remove cursor/u });
    assert.throws(() => parseHistoryArgs(['observe', '--input', JSON.stringify(input)]), { code: 'INVALID_ARGUMENT', message: /Remove retrieval and cursor/u });
  }
  for (const input of [{ maxFiles: 0 }, { maxFiles: 100001 }, { maxFiles: 1.5 }, { callerSessionId: '' }]) {
    await assert.rejects(service.execute('observe', input), { code: 'INVALID_ARGUMENT' });
  }
  assert.deepEqual(parseHistoryArgs(['observe', '--caller-session', 'later-id', '--max-files', '100']).input,
    { callerSessionId: 'later-id', maxFiles: 100 });
  await assert.rejects(service.execute('status', { maxFiles: 1 }), { code: 'INVALID_ARGUMENT', message: /only accepted by observe/u });
  const unsupported = await f.service({ source: 'claude-code', claudeHome: f.home });
  assert.equal((await unsupported.execute('status')).capabilities.sourceObservation.supported, false);
  await assert.rejects(unsupported.execute('observe'), { code: 'UNSUPPORTED_SOURCE', message: /fixed snapshot/u });
  assert.equal((await service.execute('observe')).observation.counts.metadata_unchanged, 1);
});
