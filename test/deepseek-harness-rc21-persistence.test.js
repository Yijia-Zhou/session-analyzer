'use strict';

// Synthetic DSH 0.2.1-rc.2 (687f282e8625c6b8d11ff58211a90524be2e4317) shapes:
// packages/jobs/jobs/src/types.ts; session/working-directory/src/index.ts;
// api/session-controller/src/types.ts and tests/remote-access.host.spec.ts;
// subagent/subagent/src/catalog.ts; experimental/translator/src/types.ts.
// These fixtures contain no real transcript, external access, or model calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync } = require('node:zlib');
const { buildDeepSeekIndex, deepSeekAdapter, readDeepSeekRawRecord } = require('../src/deepseek-harness');
const { materializeSessionForIndex, validateIndexOwnershipForCommit, buildEventDetailForSession } = require('../src/source-adapters');

const row = (type, seq, data, extras = {}) => ({ type, seq, time: 1000 + seq, data, ...extras });
const message = (seq, source, text) => row('user/message', seq, {
  id: `u${seq}`, role: 'user', source, content: [{ type: 'text', text }],
}, { surfaceOp: 'append' });

async function fixture(t, records, compressed) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sa-dsh-rc21-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'workspace');
  const sourceHome = path.join(root, 'sessions');
  const directory = path.join(sourceHome, 'project', 'synthetic');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(directory, { recursive: true });
  const header = { type: 'session', version: 4, id: 'synthetic', createdAt: 1, cwd: repoRoot, isSeeded: false, delegationDepth: 0 };
  const rows = [header, ...records];
  const lines = rows.map(record => JSON.stringify(record) + '\n');
  const file = path.join(directory, `session.v4.jsonl${compressed ? '.zstd' : ''}`);
  await fsp.writeFile(file, compressed ? Buffer.concat(lines.map(line => zstdCompressSync(Buffer.from(line)))) : lines.join(''));
  const index = await buildDeepSeekIndex({ sourceHome, repoRoot });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sourceDiagnostics.totalCount, 0, JSON.stringify(index.sourceDiagnostics));
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  const session = await materializeSessionForIndex(index, indexed);
  assert.deepEqual(indexed.counts, session.counts);
  assert.equal(indexed.rawEventCount, rows.length);
  assert.equal(session.rawEvents.length, rows.length);
  assert.equal(indexed.logicalEventCount, session.logicalEvents.length);
  for (const [ordinal, record] of rows.entries()) {
    const raw = session.rawEvents[ordinal];
    assert.equal(raw.sourceLocator.recordOrdinal, ordinal);
    if (ordinal) assert.equal(raw.sourceLocator.seq, record.seq);
    assert.equal((await readDeepSeekRawRecord(index, session, raw)).raw, JSON.stringify(record));
  }
  return { index, indexed, session, repoRoot };
}

for (const compressed of [false, true]) {
  test(`0.2.1 rc.2 job and working-directory events are known Protocol without inferred execution (compressed=${compressed})`, async t => {
    const job = {
      jobId: 'bash:00000000-0000-4000-8000-000000000001', owner: 'synthetic',
      kind: 'bash', label: 'Synthetic background operation', startedAt: 1000,
      toolCall: { callId: 'nested-call', rootCallId: 'root-call' },
    };
    const rows = [
      row('job/registered', 0, job),
      row('job/settled', 1, { ...job, finishedAt: 1001, status: 'failed', cause: 'producer', producerReported: true, detail: 'exit code: 7' }),
      row('job/registered', 2, { ...job, jobId: 'bash:00000000-0000-4000-8000-000000000002', startedAt: 1002 }),
      row('working-directory/change', 3, { cwd: '/synthetic/other-project' }),
      message(4, { kind: 'working-directory' }, 'The working directory changed to /synthetic/other-project.'),
    ];
    const { index, indexed, session, repoRoot } = await fixture(t, rows, compressed);
    assert.equal(indexed.projectAssociation, repoRoot);
    assert.equal(session.projectAssociation, repoRoot);
    assert.deepEqual(session.cwdSet, [repoRoot]);
    assert.equal(session.counts.userMessages, 0);
    assert.equal(deepSeekAdapter.query.getTimeline(index, session, { layer: 'main' }).events.length, 0);
    for (const [seq, expected] of rows.entries()) {
      const event = session.logicalEvents.find(item => item.rawRefs.some(ref => ref.sourceLocator.seq === seq));
      assert.ok(event);
      assert.equal(event.layer, 'protocol');
      assert.equal(event.subtype, expected.type);
      assert.equal(event.severity, 'normal');
      assert.deepEqual(event.rawRefs.map(ref => ref.rawId), [session.rawEvents[seq + 1].rawId]);
      const detail = await buildEventDetailForSession(index, session, event.id, 'protocol');
      assert.deepEqual(detail.rawRefs, event.rawRefs);
    }
  });

  test(`0.2.1 rc.2 optional principal preserves human classification and exact source (compressed=${compressed})`, async t => {
    const principal = { kind: 'test-guest', guest: 'synthetic-caller' };
    const guest = message(3, { kind: 'user', rpcId: 'guest-prompt', principal }, 'Guest prompt needle');
    const rows = [
      message(0, { kind: 'user', rpcId: 'owner-prompt', clientTimeZone: 'Asia/Shanghai' }, 'Owner prompt'),
      row('agent/inbox/spliced', 1, { target: 'next-turn', start: 0, inserted: [guest.data] }),
      row('agent/inbox/spliced', 2, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
      guest,
      // Deliberate negative: unrelated source metadata cannot promote a runtime message.
      message(4, { kind: 'working-directory', principal }, 'Attribution does not grant human classification'),
    ];
    const { index, indexed, session } = await fixture(t, rows, compressed);
    assert.equal(indexed.counts.userMessages, 2);
    const main = deepSeekAdapter.query.getTimeline(index, session, { layer: 'main' });
    assert.equal(main.events.length, 2);
    assert.ok(main.events.every(event => event.kind === 'user_message' && event.role === 'user'));
    assert.equal(session.rawEvents[4].role, 'user');
    assert.equal(session.logicalEvents[4].layer, 'protocol');
    const delivered = session.logicalEvents.find(event => event.kind === 'user_message' && event.rawRefs.some(ref => ref.sourceLocator.seq === 3));
    assert.ok(delivered.inboxProvenance);
    assert.equal(delivered.inboxProvenance.messageId, guest.data.id);
    const found = await deepSeekAdapter.query.filterSessions(index, { q: 'Guest prompt needle', layer: 'main' });
    assert.equal(found.matchingEventTotal, 1);
    const detail = await buildEventDetailForSession(index, session, session.rawEvents[4].rawId, 'raw');
    assert.deepEqual(detail.timelineSections[0].value.data.source, guest.data.source);
  });

  test(`0.2.1 rc.2 external catalogs and ignorable plugin records retain fallback without fabricated children (compressed=${compressed})`, async t => {
    const rows = [
      row('subagent/catalog', 0, { version: 2, childId: 'external-child', childCreatedAt: 999, mode: 'external', label: 'External execution' }),
      row('plugin:translator/request', 1, { provider: 'google', text: 'Synthetic translation input', sourceLanguage: 'auto', targetLanguage: 'zh', recipe: 'synthetic' }, { ignorable: true }),
      row('plugin:translator/result', 2, { requestSeq: 1, text: '合成翻译结果' }, { ignorable: true }),
    ];
    const { index, session } = await fixture(t, rows, compressed);
    assert.equal(index.sessions.length, 1);
    assert.equal(session.parentSessionId, '');
    assert.equal(session.forkedFromSessionId, '');
    assert.equal(session.primarySessionMetaKind, '');
    assert.equal(deepSeekAdapter.query.getTimeline(index, session, { layer: 'main' }).events.length, 0);
    assert.ok(session.logicalEvents.every(event => event.layer === 'protocol'));
    assert.equal(session.logicalEvents[0].subtype, 'subagent/catalog');
    assert.equal(session.logicalEvents[0].severity, 'normal');
    for (const event of session.logicalEvents.slice(1)) {
      assert.equal(event.subtype, 'unknown_event');
      assert.equal(event.severity, 'warning');
    }
  });
}
