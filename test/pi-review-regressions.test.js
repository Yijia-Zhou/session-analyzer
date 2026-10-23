'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('../server');
const { piAdapter, buildPiIndex } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { createHistoryService } = require('../src/history-service');

const timestamp = '2026-10-22T12:00:00.000Z';
const entry = (id, parentId, type, fields) => ({ type, id, parentId, timestamp, ...fields });
const message = (id, parentId, role, content, fields) => entry(id, parentId, 'message', {
  message: { role, content, ...fields },
});
async function fixture(t, rows = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceHome = path.join(root, 'agent with spaces');
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(path.join(sourceHome, 'sessions'), { recursive: true });
  await fs.mkdir(repoRoot);
  const records = [entry('review', undefined, 'session', { version: 3, cwd: repoRoot }), ...rows];
  const text = records.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const file = path.join(sourceHome, 'sessions', 'synthetic.jsonl');
  await fs.writeFile(file, text);
  return { root, sourceHome, repoRoot, file, text };
}
function env(t, value) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  process.env.PI_CODING_AGENT_DIR = value;
}

const deep = Array.from({ length: 42 }).reduce((value) => ({ nested: value }), { marker: 'DEEP_RAW_EVIDENCE' });
for (const [label, value] of [
  ['large array', Array.from({ length: 5001 }, (_, n) => n)],
  ['deep object', deep],
  ['wide object', Object.fromEntries(Array.from({ length: 2001 }, (_, n) => [`key${n}`, n]))],
  ['many nodes', Array.from({ length: 128 }, () => Array.from({ length: 128 }, () => ({ marker: 'node' })))],
]) {
  test(`pi bounds ${label} in all Detail evidence while retaining exact Raw`, async (t) => {
    const receipt = { complete: true, calls: [{ id: 'nested-1', name: 'lookup', status: 'ok', arguments: value }] };
    const rows = [
      message('call', null, 'assistant', [{ type: 'toolCall', id: 'tool-1', name: 'codemode', arguments: { value } }]),
      message('result', 'call', 'toolResult', [{ type: 'text', text: 'tool output' }], {
        toolCallId: 'tool-1', toolName: 'codemode', isError: false, details: { value }, nestedCalls: receipt,
      }),
      entry('custom', 'result', 'custom', { customType: 'review', data: { value } }),
      entry('edit', 'custom', 'context_edit', { targetId: 'result', replacement: [{ type: 'future', value }] }),
    ];
    const f = await fixture(t, rows);
    const index = await buildPiIndex(f);
    t.after(() => disposeProjectQueryStore(index.projectQueryStore));
    const session = await materializeSessionForIndex(index, index.sessions[0]);
    for (const event of session.logicalEvents.filter((item) => item.subtype !== 'pi_branch')) {
      const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
      assert.match(JSON.stringify(detail), /omitted; see raw refs|additional fields omitted/);
      assert.deepEqual(detail.rawRefs.map((ref) => ref.rawId), event.rawRefs.map((ref) => ref.rawId));
    }
    for (const raw of session.rawEvents.slice(1)) {
      const detail = await buildEventDetailForSession(index, session, raw.rawId, 'raw');
      assert.match(JSON.stringify(detail), /omitted; see raw refs|additional fields omitted/);
      const original = await readIndexedRawRecord(index, session, raw.rawId);
      assert.equal(original.raw, f.text.split('\n')[raw.line - 1]);
    }
    assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
    if (label === 'deep object') {
      const service = await createHistoryService({ source: 'pi', piHome: f.sourceHome, repo: f.repoRoot });
      t.after(() => service.close());
      const search = await service.execute('search', { query: 'DEEP_RAW_EVIDENCE' });
      assert.ok(search.items.length);
      const read = await service.execute('read', { refs: [search.items[0].ref], parts: ['message', 'raw'] });
      assert.ok(read.items[0].rawRefs.length);
      assert.doesNotMatch(JSON.stringify(read), /LOGICAL_DETAIL_CONTRACT_VIOLATION/);
    }
  });
}

test('pi environment home follows native tilde, file URL and platform path rules', (t) => {
  env(t, '');
  assert.equal(piAdapter.defaultHome(), path.join(os.homedir(), '.pi', 'agent'));
  for (const [value, expected] of [
    ['~', os.homedir()], ['~/pi-agent', path.join(os.homedir(), 'pi-agent')],
    [pathToFileURL(path.join(os.tmpdir(), 'pi space # agent')).href, path.join(os.tmpdir(), 'pi space # agent')],
    ['relative/agent', 'relative/agent'], ['~someone/agent', '~someone/agent'],
    [' leading-space', ' leading-space'],
    ...(process.platform === 'win32' ? [
      ['~\\agent', path.join(os.homedir(), 'agent')],
      ['/c/pi/agent', 'C:\\pi\\agent'], ['/mnt/c/pi/agent', 'C:\\pi\\agent'],
      ['/cygdrive/c/pi/agent', 'C:\\pi\\agent'], ['//host/share', '//host/share'],
    ] : [['/mnt/c/pi/agent', '/mnt/c/pi/agent'], ['~\\agent', '~\\agent']]),
  ]) {
    process.env.PI_CODING_AGENT_DIR = value;
    assert.equal(piAdapter.defaultHome(), expected, value);
  }
});

for (const kind of ['tilde', 'file URL']) {
  test(`pi discovers history through ${kind} environment home without an explicit root`, async (t) => {
    const f = await fixture(t, [message('user', null, 'user', 'ENV_HOME_EVIDENCE')]);
    t.mock.method(os, 'homedir', () => f.root);
    env(t, kind === 'tilde' ? '~/agent with spaces' : pathToFileURL(f.sourceHome).href);
    const server = createServer(null, 0, { source: 'pi' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects`);
    assert.equal(response.status, 200);
    const projects = await response.json();
    assert.equal(projects.sourceHome, f.sourceHome);
    assert.ok(projects.projects.some((project) => project.repoRoot === f.repoRoot));
    const service = await createHistoryService({ source: 'pi', repo: f.repoRoot });
    t.after(() => service.close());
    assert.equal((await service.execute('search', { query: 'ENV_HOME_EVIDENCE' })).scan.matchedEvents, 1);
  });
}

test('invalid pi file URLs do not prevent another source from starting', async (t) => {
  const f = await fixture(t);
  env(t, '');
  for (const value of ['file:///tmp/pi%ZZ', 'file:///tmp/pi%2Fagent', 'file://%']) {
    process.env.PI_CODING_AGENT_DIR = value;
    assert.equal(piAdapter.defaultHome(), value, 'keep invalid configuration available for root diagnostics');
    const server = createServer(null, 0, { source: 'codex', codexHome: f.root });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects`);
      assert.equal(response.status, 200);
      const projects = await response.json();
      assert.equal(projects.sourceKind, 'codex');
      assert.equal(projects.sourceHome, f.root);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  }
});

test('pi malformed rows keep opaque payloads out of search and snippets but retain exact Raw', async (t) => {
  const f = await fixture(t, [message('user', null, 'user', 'SEARCHABLE_GOOD_MESSAGE')]);
  const malformed = [
    '{"signature":"OPAQUE_BAD_SIGNATURE",',
    '{"thinkingSignature":"OPAQUE_BAD_THINKING",',
    '{"thoughtSignature":"OPAQUE_BAD_THOUGHT",',
    '{"textSignature":"OPAQUE_BAD_TEXT",',
    '{"encrypted_content":"OPAQUE_BAD_ENCRYPTED",',
    '{"type":"image","data":"OPAQUE_BAD_MEDIA",',
    '{"base64":"OPAQUE_BAD_BASE64",',
    '{"signat\\u0075re":"OPAQUE_BAD_ESCAPED",',
    'OPAQUE_BAD_NON_JSON',
  ];
  const text = f.text + malformed.join('\n') + '\n';
  await fs.writeFile(f.file, text);
  const index = await buildPiIndex(f);
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  const brokenRows = session.rawEvents.filter((raw) => raw.parseError);
  assert.equal(brokenRows.length, malformed.length);
  for (const [i, raw] of brokenRows.entries()) {
    assert.doesNotMatch(raw.searchText + raw.preview, /OPAQUE_BAD/);
    assert.match(raw.preview, /Malformed JSON/);
    assert.equal((await readIndexedRawRecord(index, session, raw.rawId)).raw, malformed[i]);
    const protocol = session.logicalEvents.find((event) => event.rawRefs.some((ref) => ref.rawId === raw.rawId));
    assert.ok(protocol);
    assert.doesNotMatch(JSON.stringify(await buildEventDetailForSession(index, session, protocol.id, 'protocol')), /OPAQUE_BAD/);
  }
  const service = await createHistoryService({ source: 'pi', piHome: f.sourceHome, repo: f.repoRoot });
  t.after(() => service.close());
  for (const layer of ['main', 'protocol', 'raw']) {
    assert.equal((await service.execute('search', { layer, query: 'OPAQUE_BAD' })).scan.matchedEvents, 0);
  }
  assert.equal((await service.execute('search', { query: 'SEARCHABLE_GOOD_MESSAGE' })).scan.matchedEvents, 1);
  for (const layer of ['protocol', 'raw']) {
    assert.equal((await service.execute('search', { layer, query: 'Malformed JSON' })).scan.matchedEvents, malformed.length);
  }
  assert.equal(await fs.readFile(f.file, 'utf8'), text);
});

for (const depth of [3000, 10000]) {
  test(`pi ${depth}-level evidence keeps sibling indexing, search, Detail and HTTP Raw readable`, async (t) => {
    const f = await fixture(t);
    // Build valid JSON as text; JSON.stringify itself cannot encode the deepest
    // fixture. The writer's data is not constrained by our JS call stack.
    const deepJson = '{"nested":'.repeat(depth) + '"DEEP_SEARCHABLE_SENTINEL"' + '}'.repeat(depth);
    const deepArrayJson = '['.repeat(depth) + '"base64"' + ']'.repeat(depth);
    const marker = 'DEEP_VALUE_PLACEHOLDER';
    const rows = [
      message('user', null, 'user', 'DEEP_SESSION_USER'),
      message('call', 'user', 'assistant', [{ type: 'toolCall', id: 'tool-1', name: 'codemode', arguments: { value: marker } }],
        { usage: { input: 1, extension: marker } }),
      message('result', 'call', 'toolResult', [{ type: 'text', text: 'DEEP_TOOL_OUTPUT' }], {
        toolCallId: 'tool-1', toolName: 'codemode', isError: false, details: { value: marker },
        nestedCalls: { complete: true, calls: [{ id: 'nested-1', name: 'lookup', status: 'ok', arguments: marker }] },
      }),
      entry('custom', 'result', 'custom', { customType: 'review', data: {
        value: marker, type: 'DEEP_ARRAY_PLACEHOLDER', other: { type: { toString: null }, data: 'ordinary data' },
      } }),
      entry('edit', 'custom', 'context_edit', { targetId: 'result', replacement: [{ type: 'future', value: marker }] }),
    ];
    const lines = rows.map((row) => JSON.stringify(row).replaceAll(JSON.stringify(marker), deepJson)
      .replaceAll('"DEEP_ARRAY_PLACEHOLDER"', deepArrayJson));
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
    const text = f.text + lines.join('\n') + '\n';
    await fs.writeFile(f.file, text);
    const siblingFile = path.join(f.sourceHome, 'sessions', 'healthy.jsonl');
    const siblingText = JSON.stringify(entry('healthy', undefined, 'session', { version: 3, cwd: f.repoRoot })) + '\n'
      + JSON.stringify(message('healthy-user', null, 'user', 'HEALTHY_SIBLING_MESSAGE')) + '\n';
    await fs.writeFile(siblingFile, siblingText);
    const index = await buildPiIndex(f);
    t.after(() => disposeProjectQueryStore(index.projectQueryStore));
    assert.equal(index.sessions.length, 2);
    const session = await materializeSessionForIndex(index, index.sessions.find((item) => item.sourceSessionId === 'review'));
    const tool = session.logicalEvents.find((event) => event.toolName === 'codemode');
    assert.equal(tool.status, 'success');
    assert.match(tool.searchText, /DEEP_SEARCHABLE_SENTINEL/);
    const toolDetail = await buildEventDetailForSession(index, session, tool.id, tool.layer);
    assert.match(JSON.stringify(toolDetail), /nested detail value omitted/);
    for (const event of session.logicalEvents) {
      assert.ok(await buildEventDetailForSession(index, session, event.id, event.layer));
    }
    for (const raw of session.rawEvents) {
      assert.ok(await buildEventDetailForSession(index, session, raw.rawId, 'raw'));
      const readback = await readIndexedRawRecord(index, session, raw.rawId);
      assert.equal(readback.raw, text.split('\n')[raw.line - 1]);
      assert.doesNotThrow(() => JSON.stringify(readback), 'parsed companion must remain serializable');
    }
    const service = await createHistoryService({ source: 'pi', piHome: f.sourceHome, repo: f.repoRoot });
    t.after(() => service.close());
    assert.equal((await service.execute('search', { query: 'HEALTHY_SIBLING_MESSAGE' })).scan.matchedEvents, 1);
    const found = await service.execute('search', { query: 'DEEP_SEARCHABLE_SENTINEL' });
    assert.ok(found.items.length);
    const read = await service.execute('read', { refs: [found.items[0].ref], parts: ['message', 'raw'] });
    assert.ok(read.items[0].rawRefs.length);
    const server = createServer(index, 0, { source: 'pi' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const raw = session.rawEvents.find((item) => item.entryId === 'custom');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/${encodeURIComponent(session.id)}/raw/${encodeURIComponent(raw.rawId)}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).raw, lines[3]);
    assert.equal(await fs.readFile(f.file, 'utf8'), text);
    assert.equal(await fs.readFile(siblingFile, 'utf8'), siblingText);
  });
}
