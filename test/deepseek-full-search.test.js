'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { buildDeepSeekIndex, deepSeekAdapter } = require('../src/deepseek-harness');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { materializeSessionForIndex, validateIndexOwnershipForCommit,
  buildEventDetailForSession } = require('../src/source-adapters');

const row = (type, seq, data, extra = {}) => ({ type, seq, time: 1000 + seq, data, ...extra });
const text = value => [{ type: 'text', text: value }];
async function fixture(t, records, version = 4, compressed = false) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-full-search-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const sourceHome = path.join(root, 'sessions');
  const dir = path.join(sourceHome, 'project', 'search');
  await fsp.mkdir(repoRoot);
  await fsp.mkdir(dir, { recursive: true });
  const header = { type: 'session', version, id: 'search', createdAt: 1, cwd: repoRoot,
    delegationDepth: 0, ...(version === 4 ? { isSeeded: false } : {}) };
  const lines = [header, ...records].map(record => Buffer.from(`${JSON.stringify(record)}\n`));
  const file = path.join(dir, `session${version ? `.v${version}` : ''}.jsonl${compressed ? '.zstd' : ''}`);
  await fsp.writeFile(file, Buffer.concat(compressed ? lines.map(line => zstdCompressSync(line)) : lines));
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sourceDiagnostics.totalCount, 0);
  assert.equal(index.sessions.length, 1);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  return { index, session };
}

async function matchBoth(f, needle, layer, count = 1) {
  const project = await deepSeekAdapter.query.filterSessions(f.index, { q: needle, layer });
  const timeline = deepSeekAdapter.query.getTimeline(f.index, f.session, { q: needle, layer });
  assert.equal(project.matchingEventTotal, count, `project ${layer}: ${needle.slice(-60)}`);
  assert.equal(timeline.searchEventCount, count, `session ${layer}: ${needle.slice(-60)}`);
  if (count) {
    assert.ok(timeline.events.some(event => event.id === project.sessions[0].searchMatch.latestEvent.id));
  }
}

for (const version of [0, 4]) for (const compressed of [false, true]) {
  test(`DeepSeek full text and independent result search (v${version}, compressed=${compressed})`, async t => {
    const user = row('user/message', 0, { id: 'u', role: 'user', source: { kind: 'user' },
      content: text('前🙂'.repeat(9000) + ' HUMAN_TAIL') }, { surfaceOp: 'append' });
    const call = row('tool/call', 1, { turn: 1, step: 1, callId: 'call', name: 'read_file',
      arguments: JSON.stringify({ path: 'x'.repeat(17000) + ' ARGUMENT_TAIL' }) });
    const result = row('tool/result', 2, { turn: 1, step: 1,
      message: version === 4 ? { id: 'tool-message', role: 'tool', source: { kind: 'tool', callId: 'call' },
        toolCallId: 'call', isError: true, content: text('SHORT_ERROR_NEEDLE') }
        : { role: 'user', source: { kind: 'tool', callId: 'call' }, content: [{ type: 'tool-result',
          toolCallId: 'call', isError: true, content: text('SHORT_ERROR_NEEDLE') }] } }, { surfaceOp: 'append' });
    const protocol = row('hook/result', 3, { content: 'p'.repeat(17000) + ' PROTOCOL_TAIL',
      signature: 'SECRET_SIGNATURE_NEEDLE', image: { type: 'image', data: 'SECRET_MEDIA_NEEDLE' },
      opaque: { type: 'redacted_thinking', data: 'SECRET_OPAQUE_NEEDLE' },
      encrypted_content: 'SECRET_ENCRYPTED_NEEDLE',
      encoded: { type: 'base64', data: 'SECRET_BASE64_NEEDLE' } });
    const f = await fixture(t, [user, call, result, protocol], version, compressed);
    for (const needle of ['HUMAN_TAIL', 'ARGUMENT_TAIL', 'SHORT_ERROR_NEEDLE']) {
      await matchBoth(f, needle, 'main');
      await matchBoth(f, needle, 'raw');
    }
    await matchBoth(f, 'PROTOCOL_TAIL', 'protocol');
    await matchBoth(f, 'PROTOCOL_TAIL', 'raw');
    for (const needle of ['SECRET_SIGNATURE_NEEDLE', 'SECRET_MEDIA_NEEDLE', 'SECRET_OPAQUE_NEEDLE',
      'SECRET_ENCRYPTED_NEEDLE', 'SECRET_BASE64_NEEDLE']) {
      await matchBoth(f, needle, 'protocol', 0);
      await matchBoth(f, needle, 'raw', 0);
    }
    assert.ok(f.session.logicalEvents.every(event => event.preview.length <= 240));
  });
}

test('DeepSeek attempts search settled tails outside Detail budgets and exclude replaced deltas', async t => {
  const stream = [
    { type: 'text-chunks', index: 0, texts: ['STALE_DELTA'], time0: 1, dt: [] },
    { type: 'chunk', time: 2, chunk: { type: 'block-end', index: 0,
      block: { type: 'text', text: 'x'.repeat(17000) + ' SETTLED_TAIL' } } },
    { type: 'reasoning-chunks', index: 1, texts: ['r'.repeat(17000), ' REASONING_TAIL'], time0: 3, dt: [1] },
  ];
  const f = await fixture(t, [row('assistant/attempt', 0, { turn: 1, step: 1, stream })]);
  for (const layer of ['protocol', 'raw']) {
    await matchBoth(f, 'SETTLED_TAIL', layer);
    await matchBoth(f, 'REASONING_TAIL', layer);
    await matchBoth(f, 'STALE_DELTA', layer, 0);
  }
  const detail = await buildEventDetailForSession(f.index, f.session, f.session.logicalEvents[0].id, 'protocol');
  assert.doesNotMatch(JSON.stringify(detail.timelineSections), /SETTLED_TAIL|REASONING_TAIL/);
});

test('DeepSeek nested opaque payloads stay out of Main/Protocol/Raw searches beyond the old prefix', async t => {
  const hidden = ['HIDDEN_BLOB', 'HIDDEN_AUDIO', 'HIDDEN_IMAGE', 'HIDDEN_DOCUMENT', 'HIDDEN_THOUGHT_SIGNATURE'];
  const payload = { text: `${'x'.repeat(20000)} VISIBLE_PAYLOAD_TAIL`, nested: {
    blob: hidden[0], audio: { type: 'audio', data: hidden[1] },
    image: { type: 'output_image', data: hidden[2] }, document: { type: 'document', data: hidden[3] },
    thought_signature: hidden[4],
  } };
  const dispatch = { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'nested',
    name: 'read', arguments: payload };
  const f = await fixture(t, [
    row('tool/call', 0, { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{"code":"read()"}' }),
    row('tool/ptc-dispatch-start', 1, dispatch),
    row('tool/ptc-dispatch', 2, { ...dispatch, isError: false, content: text('nested complete') }),
    row('tool/result', 3, { turn: 1, step: 1, message: { id: 'outer-result', role: 'tool',
      source: { kind: 'tool', callId: 'outer' }, toolCallId: 'outer', content: text('outer complete') } },
    { surfaceOp: 'append' }),
    row('hook/result', 4, payload),
  ]);
  for (const layer of ['main', 'protocol', 'raw']) {
    for (const needle of hidden) await matchBoth(f, needle, layer, 0);
    await matchBoth(f, 'VISIBLE_PAYLOAD_TAIL', layer, layer === 'raw' ? 3 : 1);
  }
});

test('DeepSeek JSON string arguments and early previews share opaque exclusions without changing plain arguments', async t => {
  const hidden = ['EARLY_SIGNATURE', 'EARLY_IMAGE', 'EARLY_AUDIO', 'EARLY_BLOB', 'EARLY_ENCRYPTED'];
  const payload = { signature: hidden[0],
    nested: [{ type: 'image', text: hidden[1] }, { type: 'audio', data: hidden[2] }],
    blob: hidden[3], encrypted_content: hidden[4],
    allowedSyntaxKey: 'VISIBLE_ARGUMENT_VALUE' };
  const f = await fixture(t, [
    row('tool/call', 0, { turn: 1, step: 1, callId: 'json', name: 'read', arguments: JSON.stringify(payload) }),
    row('tool/call', 1, { turn: 1, step: 1, callId: 'plain', name: 'read', arguments: 'PLAIN_ARGUMENT { incomplete' }),
    row('hook/result', 2, payload),
    row('hook/result', 3, { arguments: JSON.stringify(payload) }),
  ]);
  for (const layer of ['main', 'protocol', 'raw']) {
    for (const needle of hidden) await matchBoth(f, needle, layer, 0);
    for (const event of [...f.session.logicalEvents, ...f.session.rawEvents]) {
      for (const needle of hidden) assert.equal(event.preview.includes(needle), false, `preview ${needle}`);
    }
  }
  for (const layer of ['main', 'raw']) {
    await matchBoth(f, 'PLAIN_ARGUMENT { incomplete', layer);
  }
  await matchBoth(f, 'allowedSyntaxKey', 'main');
  await matchBoth(f, 'allowedSyntaxKey', 'protocol');
  await matchBoth(f, 'allowedSyntaxKey', 'raw', 2);
  await matchBoth(f, 'VISIBLE_ARGUMENT_VALUE', 'main');
  await matchBoth(f, 'VISIBLE_ARGUMENT_VALUE', 'protocol', 2);
});

for (const opaque of [false, true]) {
  test(`DeepSeek 6000-level JSON string arguments remain searchable without recursive encoding (opaque=${opaque})`, async t => {
    const leaf = JSON.stringify({ allowedSyntaxKey: 'DEEP_ALLOWED_TAIL',
      ...(opaque ? { signature: 'DEEP_HIDDEN_SIGNATURE' } : {}) });
    const args = `${'{"nested":'.repeat(6000)}${leaf}${'}'.repeat(6000)}`;
    assert.doesNotThrow(() => JSON.parse(args));
    const f = await fixture(t, [row('tool/call', 0, {
      turn: 1, step: 1, callId: 'deep', name: 'read', arguments: args,
    })]);
    for (const layer of ['main', 'raw']) {
      await matchBoth(f, 'DEEP_ALLOWED_TAIL', layer);
      await matchBoth(f, 'allowedSyntaxKey', layer);
      await matchBoth(f, 'DEEP_HIDDEN_SIGNATURE', layer, 0);
    }
    await matchBoth(f, 'DEEP_HIDDEN_SIGNATURE', 'protocol', 0);
    const event = f.session.logicalEvents[0];
    assert.ok(event.searchText.length < args.length + 100, 'nesting does not amplify output with indentation');
  });
}

test('DeepSeek >4 MiB event searches tail and a physical chunk boundary without changing identity', async t => {
  const body = 'a'.repeat(4 * 1024 * 1024 - 5) + 'CROSS_BOUNDARY_NEEDLE' + 'b'.repeat(1000000) + ' HUGE_TAIL';
  const f = await fixture(t, [row('user/message', 0, { id: 'large', role: 'user',
    source: { kind: 'user' }, content: text(body) }, { surfaceOp: 'append' })]);
  assert.equal(f.session.logicalEvents.length, 1);
  assert.equal(f.session.rawEvents.length, 2);
  for (const needle of ['HUGE_TAIL', 'CROSS_BOUNDARY_NEEDLE']) {
    await matchBoth(f, needle, 'main');
    await matchBoth(f, needle, 'raw');
  }
});
