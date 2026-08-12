'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  buildEventDetail,
  buildHydratedEventDetail,
  buildIndex,
  readIndexedCodexSourceRows,
} = require('../src/codex');
const { createServer } = require('../server');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');

function withoutResidentParsed(session) {
  return {
    ...session,
    rawEvents: session.rawEvents.map((raw) => {
      const { parsed, ...compactRaw } = raw;
      return compactRaw;
    }),
  };
}

async function makeSyntheticIndex(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-hydration-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const id = '12121212-3434-5656-7878-909090909090';
  const dir = path.join(codexHome, 'sessions', '2026', '08', '12');
  const file = path.join(dir, `rollout-${id}.jsonl`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(repoRoot, { recursive: true });
  const records = [
    { type: 'session_meta', timestamp: '2026-08-12T00:00:00.000Z', payload: { id, cwd: repoRoot } },
    { type: 'response_item', timestamp: '2026-08-12T00:00:01.000Z', payload: { type: 'function_call', name: 'shell_command', call_id: 'call-1', arguments: '{"command":"echo hydrate"}' } },
    { type: 'response_item', timestamp: '2026-08-12T00:00:02.000Z', payload: { type: 'function_call_output', call_id: 'call-1', output: 'hydrated output' } },
  ];
  const originalText = `${records.map(JSON.stringify).join('\n')}\n`;
  await fsp.writeFile(file, originalText, 'utf8');
  const index = await buildIndex({ repoRoot, codexHome });
  return { file, id, index, originalText, records };
}

test('source-backed detail equals resident detail without retaining parsed records', async () => {
  const index = await buildIndex({ repoRoot: 'G:\\vibe\\term-agent', codexHome: fixtureCodexHome });
  const observedKinds = new Set();
  for (const residentSession of index.sessions) {
    const compactSession = withoutResidentParsed(residentSession);
    for (const event of residentSession.logicalEvents) {
      observedKinds.add(event.kind);
      for (const locale of ['en', 'zh-CN']) {
        const expected = buildEventDetail(residentSession, event.id, event.layer, { locale });
        const actual = await buildHydratedEventDetail(index, compactSession, event.id, event.layer, { locale });
        assert.deepEqual(actual, expected, `${event.kind}:${event.id}:${locale}`);
      }
    }
    for (const raw of residentSession.rawEvents) {
      const expected = buildEventDetail(residentSession, raw.rawId, 'raw');
      const actual = await buildHydratedEventDetail(index, compactSession, raw.rawId, 'raw');
      assert.deepEqual(actual, expected, raw.rawId);
    }
  }
  assert.deepEqual([...observedKinds].sort(), [
    'assistant_message',
    'command',
    'compaction',
    'error',
    'mcp_call',
    'other_tool_call',
    'patch',
    'plan_update',
    'proposed_plan',
    'protocol',
    'reasoning',
    'review',
    'user_message',
    'user_shell_command',
    'warning',
    'web_search',
  ]);
});

test('hydration batches all requested Raw refs into one scan per file', async (t) => {
  const { index, id } = await makeSyntheticIndex(t);
  const session = index.sessionsById.get(id);
  const openedFiles = [];
  const rows = await readIndexedCodexSourceRows(index, session, session.rawEvents, {
    onFileOpen: (file) => openedFiles.push(file),
  });
  assert.equal(rows.size, session.rawEvents.length);
  assert.deepEqual(openedFiles, [session.sourceFile]);
});

test('hydration accepts append-only growth but rejects rewrite, shrink, shift, and invalid locators', async (t) => {
  const { file, id, index, originalText, records } = await makeSyntheticIndex(t);
  const session = withoutResidentParsed(index.sessionsById.get(id));
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  const expected = buildEventDetail(index.sessionsById.get(id), command.id, command.layer);

  await fsp.appendFile(file, `${JSON.stringify({ type: 'event_msg', payload: { type: 'turn_complete' } })}\n`, 'utf8');
  assert.deepEqual(await buildHydratedEventDetail(index, session, command.id, command.layer), expected);

  const rewritten = [...records];
  rewritten[1] = { ...rewritten[1], payload: { ...rewritten[1].payload, arguments: '{"command":"changed"}' } };
  await fsp.writeFile(file, `${rewritten.map(JSON.stringify).join('\n')}\n`, 'utf8');
  await assert.rejects(
    buildHydratedEventDetail(index, session, command.id, command.layer),
    (error) => error.code === 'INDEXED_SOURCE_STALE' && error.statusCode === 409,
  );

  await fsp.writeFile(file, `${JSON.stringify(records[0])}\n`, 'utf8');
  await assert.rejects(
    buildHydratedEventDetail(index, session, command.id, command.layer),
    (error) => error.code === 'INDEXED_SOURCE_STALE',
  );

  await fsp.writeFile(file, `${JSON.stringify({ type: 'event_msg', payload: { type: 'turn_started' } })}\n${originalText}`, 'utf8');
  await assert.rejects(
    buildHydratedEventDetail(index, session, command.id, command.layer),
    (error) => error.code === 'INDEXED_SOURCE_STALE',
  );

  await fsp.writeFile(file, originalText, 'utf8');
  const originalLocator = session.rawEvents[1].sourceLocator;
  session.rawEvents[1].sourceLocator = { ...originalLocator, line: originalLocator.line + 1 };
  await assert.rejects(
    buildHydratedEventDetail(index, session, command.id, command.layer),
    (error) => error.code === 'INDEXED_SOURCE_STALE',
  );
});

test('detail and Raw-ref endpoints reject changed source instead of mixing snapshots', async (t) => {
  const { file, id, index, records } = await makeSyntheticIndex(t);
  const session = index.sessionsById.get(id);
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  const raw = session.rawEvents.find((event) => event.callId === 'call-1');
  const rewritten = [...records];
  rewritten[1] = { ...rewritten[1], payload: { ...rewritten[1].payload, arguments: '{"command":"changed"}' } };
  await fsp.writeFile(file, `${rewritten.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const server = createServer(index, 1);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const detail = await fetch(`${base}/api/sessions/${id}/events/${encodeURIComponent(command.id)}/detail?layer=main`);
    assert.equal(detail.status, 409);
    assert.equal((await detail.json()).error, 'Indexed source changed; reindex required');

    const rawResponse = await fetch(`${base}/api/sessions/${id}/raw/${encodeURIComponent(raw.rawId)}`);
    assert.equal(rawResponse.status, 409);
    assert.equal((await rawResponse.json()).error, 'Indexed source changed; reindex required');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
