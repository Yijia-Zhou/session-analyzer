'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const {
  __testOnly,
  buildEventDetail,
  buildHydratedEventDetail,
  buildIndex,
  readImagePreview,
  readIndexedCodexRawRecord,
  readIndexedCodexSourceRows,
} = codex;
const { createServer } = require('../server');
const {
  readLegacyRawLineForSession,
  resolveLegacyRawOwnerForIndex,
} = require('../src/source-adapters');

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

async function makeSyntheticIndex(t, options = {}) {
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
    ...Array.from({ length: options.paddingRows || 0 }, (_, index) => ({
      type: 'event_msg',
      timestamp: new Date(Date.UTC(2026, 7, 12, 0, 0, 1, index)).toISOString(),
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: index + 1 } } },
    })),
    { type: 'response_item', timestamp: '2026-08-12T00:00:01.000Z', payload: { type: 'function_call', name: 'shell_command', call_id: 'call-1', arguments: '{"command":"echo hydrate"}' } },
    { type: 'response_item', timestamp: '2026-08-12T00:00:02.000Z', payload: { type: 'function_call_output', call_id: 'call-1', output: 'hydrated output' } },
    ...(options.includeImage ? [
      { type: 'response_item', timestamp: '2026-08-12T00:00:03.000Z', payload: { type: 'function_call', name: 'view_image', call_id: 'call-image', arguments: { path: 'preview.png' } } },
      { type: 'response_item', timestamp: '2026-08-12T00:00:04.000Z', payload: { type: 'function_call_output', call_id: 'call-image', output: [{ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'high' }] } },
    ] : []),
  ];
  const originalText = `${records.map(JSON.stringify).join('\n')}\n`;
  await fsp.writeFile(file, originalText, 'utf8');
  const index = await buildIndex({ repoRoot, codexHome });
  return { file, id, index, originalText, records };
}

test('source-backed detail equals resident detail without retaining parsed records', async () => {
  const options = { repoRoot: 'G:\\vibe\\term-agent', codexHome: fixtureCodexHome };
  const residentIndex = await __testOnly.buildUncompactedIndexForDetailTests(options);
  const index = await buildIndex(options);
  const observedKinds = new Set();
  for (const compactSession of index.sessions) {
    const residentSession = residentIndex.sessionsById.get(compactSession.id);
    assert.ok(residentSession);
    assert.ok(compactSession.rawEvents.every((raw) => !Object.hasOwn(raw, 'parsed')));
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

test('per-index Codex hydration is FIFO-bounded and a queued abort never opens the source', async (t) => {
  const { index, id } = await makeSyntheticIndex(t);
  const session = index.sessionsById.get(id);
  const raw = session.rawEvents.at(-1);
  let releaseOpenGate;
  const openGate = new Promise((resolve) => { releaseOpenGate = resolve; });
  let opened = 0;
  let active = 0;
  let maxActive = 0;
  const openOrder = [];
  let markTwoStarted;
  const twoStarted = new Promise((resolve) => { markTwoStarted = resolve; });
  const holdOpen = (name) => async () => {
    openOrder.push(name);
    opened += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (opened === 2) markTwoStarted();
    await openGate;
    active -= 1;
  };

  const first = readIndexedCodexSourceRows(index, session, [raw], { onFileOpen: holdOpen('first') });
  const second = readIndexedCodexSourceRows(index, session, [raw], { onFileOpen: holdOpen('second') });
  const queuedController = new AbortController();
  let queuedFileOpens = 0;
  const queued = readIndexedCodexSourceRows(index, session, [raw], {
    signal: queuedController.signal,
    onFileOpen: () => {
      openOrder.push('cancelled');
      queuedFileOpens += 1;
    },
  });
  const fourth = readIndexedCodexSourceRows(index, session, [raw], {
    onFileOpen: () => { openOrder.push('fourth'); },
  });

  await twoStarted;
  assert.equal(opened, 2);
  assert.equal(maxActive, 2);
  queuedController.abort();
  await assert.rejects(queued, (error) => error.name === 'AbortError');
  assert.equal(queuedFileOpens, 0);

  releaseOpenGate();
  const [firstRows, secondRows, fourthRows] = await Promise.all([first, second, fourth]);
  assert.equal(firstRows.get(raw.rawId).line, raw.source.line);
  assert.equal(secondRows.get(raw.rawId).line, raw.source.line);
  assert.equal(fourthRows.get(raw.rawId).line, raw.source.line);
  assert.equal(maxActive, 2);
  assert.deepEqual(openOrder, ['first', 'second', 'fourth']);
});

test('all Codex hydration entry points share one index coordinator without serializing another index', async (t) => {
  const firstFixture = await makeSyntheticIndex(t, { includeImage: true });
  const secondFixture = await makeSyntheticIndex(t);
  const firstSession = firstFixture.index.sessionsById.get(firstFixture.id);
  const secondSession = secondFixture.index.sessionsById.get(secondFixture.id);
  const command = firstSession.logicalEvents.find((event) => event.kind === 'command');
  const commandRaw = firstSession.rawEvents.find((raw) => raw.callId === 'call-1');
  const imageEvent = firstSession.logicalEvents.find((event) => event.toolName === 'view_image');
  const imageRaw = firstSession.rawEvents.find((raw) => raw.embeddedImages?.length > 0);
  const preview = imageRaw.embeddedImages[0];
  const secondRaw = secondSession.rawEvents.at(-1);
  const sameIndexOrder = [];
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let markTwoStarted;
  const twoStarted = new Promise((resolve) => { markTwoStarted = resolve; });
  let started = 0;
  const hold = (name) => async () => {
    sameIndexOrder.push(name);
    started += 1;
    if (started === 2) markTwoStarted();
    await gate;
  };

  const detail = buildHydratedEventDetail(firstFixture.index, firstSession, command.id, command.layer, {
    onFileOpen: hold('detail'),
  });
  const raw = readIndexedCodexRawRecord(firstFixture.index, firstSession, commandRaw, {
    onFileOpen: hold('raw'),
  });
  await twoStarted;

  const image = readImagePreview(
    firstFixture.index,
    firstFixture.id,
    imageEvent.id,
    preview.previewId,
    { onFileOpen: () => { sameIndexOrder.push('image'); } },
  );
  const legacyOwner = resolveLegacyRawOwnerForIndex(
    firstFixture.index,
    imageRaw.source.file,
    imageRaw.source.line,
  );
  const legacy = readLegacyRawLineForSession(
    firstFixture.index,
    firstSession,
    legacyOwner,
    legacyOwner.adapter,
    { onFileOpen: () => { sameIndexOrder.push('legacy'); } },
  );
  assert.deepEqual(sameIndexOrder, ['detail', 'raw']);

  let markIndependentStarted;
  const independentStarted = new Promise((resolve) => { markIndependentStarted = resolve; });
  const independent = readIndexedCodexRawRecord(secondFixture.index, secondSession, secondRaw, {
    onFileOpen: () => { markIndependentStarted(); },
  });
  await independentStarted;
  assert.equal((await independent).line, secondRaw.source.line);

  releaseGate();
  const [hydratedDetail, hydratedRaw, hydratedImage, hydratedLegacy] = await Promise.all([
    detail,
    raw,
    image,
    legacy,
  ]);
  assert.equal(hydratedDetail.id, command.id);
  assert.equal(hydratedRaw.line, commandRaw.source.line);
  assert.equal(hydratedImage.bytes.toString('utf8'), 'hello');
  assert.equal(hydratedLegacy.line, imageRaw.source.line);
  assert.deepEqual(sameIndexOrder, ['detail', 'raw', 'image', 'legacy']);
});

test('active hydration abort stops a late scan without corrupting an independent request or the index', async (t) => {
  const { index, id } = await makeSyntheticIndex(t, { paddingRows: 120 });
  const session = index.sessionsById.get(id);
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  const committedBefore = JSON.stringify(session);
  const controller = new AbortController();
  let scannedLines = 0;

  const abandoned = buildHydratedEventDetail(index, session, command.id, command.layer, {
    signal: controller.signal,
    onSourceLine: (_file, line) => {
      scannedLines = line;
      if (line === 5) controller.abort();
    },
  });
  const independent = buildHydratedEventDetail(index, session, command.id, command.layer);

  await assert.rejects(abandoned, (error) => error.name === 'AbortError');
  const detail = await independent;
  assert.equal(detail.id, command.id);
  assert.equal(scannedLines, 5);
  assert.ok(command.rawRefs.some((ref) => ref.line > scannedLines));
  assert.equal(JSON.stringify(session), committedBefore);
});

test('HTTP disconnect aborts the source-neutral detail signal', async (t) => {
  const { index, id } = await makeSyntheticIndex(t);
  const session = index.sessionsById.get(id);
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  const original = codex.buildHydratedEventDetail;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let markAborted;
  const aborted = new Promise((resolve) => { markAborted = resolve; });
  codex.buildHydratedEventDetail = async (_index, _session, _eventId, _layer, options) => {
    markStarted();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        markAborted();
        reject(error);
      }, { once: true });
    });
  };
  t.after(() => { codex.buildHydratedEventDetail = original; });

  const server = createServer(index, 1);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${server.address().port}/api/sessions/${id}/events/${encodeURIComponent(command.id)}/detail?layer=main`, {
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(request, (error) => error.name === 'AbortError');
  await aborted;
});

test('hydration accepts append-only growth but rejects rewrite, shrink, shift, and invalid locators', async (t) => {
  const { file, id, index, originalText, records } = await makeSyntheticIndex(t);
  const session = withoutResidentParsed(index.sessionsById.get(id));
  const command = session.logicalEvents.find((event) => event.kind === 'command');
  const expected = await buildHydratedEventDetail(index, session, command.id, command.layer);

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
    assert.deepEqual(await detail.json(), {
      error: 'Indexed source changed; reindex required',
      code: 'INDEXED_SOURCE_STALE',
    });

    const rawResponse = await fetch(`${base}/api/sessions/${id}/raw/${encodeURIComponent(raw.rawId)}`);
    assert.equal(rawResponse.status, 409);
    assert.deepEqual(await rawResponse.json(), {
      error: 'Indexed source changed; reindex required',
      code: 'INDEXED_SOURCE_STALE',
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
