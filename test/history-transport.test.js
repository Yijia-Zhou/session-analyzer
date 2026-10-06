'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { formatHistoryHelp, parseHistoryArgs, requestHistory, runHistoryCli } = require('../src/history-cli');
const { MAX_BODY_BYTES, createHistoryServer, startHistoryServer } = require('../src/history-server');

const envelope = (operation, extra = {}) => ({ producer: 'session-analyzer', operation: `history.${operation}`, schemaVersion: 1, ...extra });

async function fixture(t) {
  const calls = [];
  const server = createHistoryServer({ async execute(operation, input) {
    calls.push({ operation, input });
    if (input.cursor === 'stale') throw Object.assign(new Error('Source has changed.'), { code: 'STALE_REFERENCE' });
    return envelope(operation, { items: [], received: input });
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { server, calls, endpoint: `http://127.0.0.1:${server.address().port}` };
}

test('history CLI parses repeatable queries and structured input without silent coercion', () => {
  const parsed = parseHistoryArgs(['search', '--query', 'one', '--query', 'two', '--exclude', 'echo', '--input', '{"kind":"tool_call"}', '--limit', '8', '--format', 'json']);
  assert.deepEqual(parsed.input, { kind: 'tool_call', queries: ['one', 'two'], exclude: ['echo'], limit: 8 });
  assert.deepEqual(parseHistoryArgs(['read', '--context', 'ctx', '--ref', 'a', '--ref', 'b', '--parts', 'message, request', '--offset', '0']).input,
    { contextRef: 'ctx', refs: ['a', 'b'], parts: ['message', 'request'], offset: 0 });
  assert.equal(parseHistoryArgs(['serve', '--repo', '/project', '--source', 'codex']).port, 17891);
  assert.deepEqual(parseHistoryArgs(['search', '--order', 'session', '--session', 'codex:canonical-id']).input,
    { order: 'session', session: 'codex:canonical-id' });
  assert.deepEqual(parseHistoryArgs(['search', '--input', '{"order":"diverse","session":"codex:canonical-id"}']).input,
    { order: 'diverse', session: 'codex:canonical-id' });
  for (const args of [
    ['serve', '--repo', '/project'], ['serve', '--repo', '/project', '--source', 'unknown'],
    ['serve', '--repo', '/project', '--source', 'codex', '--port', '0'],
    ['serve', '--repo', '/project', '--source', 'codex', '--host', '0.0.0.0'],
    ['search', '--limit', '1.5'], ['search', '--limit', '1e3'], ['search', '--limit', '1', '--limit', '2'],
    ['search', '--input', '[]'], ['search', '--input', '{"repo":"other"}'],
    ['search', '--input', '{"limit":4}', '--limit', '2'], ['search', '--query'],
    ['search', '--order', 'diverse', '--order', 'session'],
    ['search', '--session', 'one', '--input', '{"session":"two"}'],
    ['search', '--input', '{"order":1}'], ['search', '--input', '{"session":[]}'],
    ['search', '--endpoint', 'http://localhost:17891'], ['search', '--endpoint', 'http://127.0.0.1:17891/api'],
    ['search', '--endpoint', 'http://user@127.0.0.1:17891'], ['read', '--format', 'text'],
  ]) assert.throws(() => parseHistoryArgs(args), { code: /INVALID_/ });
});

test('real HTTP round trip preserves explicit context and batch input', async (t) => {
  const { endpoint, calls } = await fixture(t);
  const input = { contextRef: 'snapshot', refs: ['event1', 'event2'], parts: ['message'], maxBytes: 8000 };
  assert.deepEqual((await requestHistory(endpoint, 'read', input)).received, input);
  assert.deepEqual(calls, [{ operation: 'read', input }]);
  const failed = await requestHistory(endpoint, 'read', { cursor: 'stale' });
  assert.equal(failed.error.code, 'STALE_REFERENCE');
  let stdout = '';
  assert.equal(await runHistoryCli(['search', '--endpoint', endpoint, '--query', 'decisions', '--order', 'diverse', '--session', 'codex:canonical-id'], { stdout: { write(text) { stdout += text; } } }), 0);
  assert.deepEqual(JSON.parse(stdout).received, { queries: ['decisions'], order: 'diverse', session: 'codex:canonical-id' });
});

test('CLI JSON and HTTP preserve independent query groups and indexed source locators', async (t) => {
  const { endpoint, calls } = await fixture(t);
  const grouped = { groups: [{ id: 'sha', query: 'abc123', limit: 2, maxBytes: 6000 }, { id: 'fallback', queries: ['CI', 'test'], cursor: 'group-cursor' }], maxBytes: 12000 };
  const source = { source: { sourcePath: '2026/session.jsonl', locator: { type: 'jsonl-line', line: 3 } }, length: 500 };
  for (const [operation, input] of [['search', grouped], ['read', source]]) {
    const parsed = parseHistoryArgs([operation, '--input', JSON.stringify(input)]);
    assert.deepEqual(parsed.input, input);
    assert.deepEqual((await requestHistory(endpoint, operation, input)).received, input);
  }
  assert.equal(calls.length, 2);
  for (const input of [{ groups: [] }, { groups: [{ id: 'x', query: 'one' }, { id: 'x', query: 'two' }] },
    { groups: [{ id: 'x', query: 'one', groups: [] }] }, { source: { sourcePath: 'x', locator: { type: 'jsonl-line', line: 0 } } },
    { source: { sourcePath: 'x', sourceRef: 'sr1.x', locator: { type: 'jsonl-line', line: 1 } } },
    { source: { sourcePath: 'x', locator: { type: 'jsonl-line', line: 1, path: 'arbitrary' } } }]) {
    assert.throws(() => parseHistoryArgs(['read', '--input', JSON.stringify(input)]), { code: /INVALID_/ });
  }
});

test('history payload options preserve strings and reject duplicate or malformed input', () => {
  for (const operation of ['status', 'search', 'context', 'read']) {
    assert.deepEqual(parseHistoryArgs([operation, '--presentation', 'compact']).input, { presentation: 'compact' });
    assert.deepEqual(parseHistoryArgs([operation, '--input', '{"presentation":"full"}']).input, { presentation: 'full' });
  }
  assert.deepEqual(parseHistoryArgs(['context', '--view', 'full', '--presentation', 'compact']).input,
    { view: 'full', presentation: 'compact' });
  assert.deepEqual(parseHistoryArgs(['read', '--text-format', 'text', '--context', 'snapshot', '--ref', 'e1']).input,
    { textFormat: 'text', contextRef: 'snapshot', refs: ['e1'] });
  assert.deepEqual(parseHistoryArgs(['read', '--input', '{"textFormat":"structured"}']).input, { textFormat: 'structured' });
  for (const [flag, key] of [['--presentation', 'presentation'], ['--view', 'view'], ['--text-format', 'textFormat']]) {
    for (const args of [
      ['read', flag], ['read', flag, ' '], ['read', flag, '--help'],
      ['read', flag, 'full', flag, 'compact'],
      ['read', flag, 'full', '--input', JSON.stringify({ [key]: 'compact' })],
      ['read', '--input', JSON.stringify({ [key]: 'compact' }), flag, 'full'],
      ...[false, 1, [], {}, null, ' '].map((value) => ['read', '--input', JSON.stringify({ [key]: value })]),
    ]) assert.throws(() => parseHistoryArgs(args), { code: /INVALID_/ });
  }
  assert.throws(() => parseHistoryArgs(['read', '--input', '{"text_format":"text"}']), { code: 'INVALID_INPUT' });
  assert.throws(() => parseHistoryArgs(['search', '--compact', 'true']), { code: 'INVALID_OPTION' });
  assert.deepEqual(parseHistoryArgs(['read']).input, {});
  const help = formatHistoryHelp();
  assert.match(help, /--presentation <full\|compact>/);
  assert.match(help, /--view <outline\|full>/);
  assert.match(help, /--text-format <structured\|text>/);
  assert.match(help, /required when using compact handles/);
  assert.match(help, /evidenceRef/);
});

test('HTTP and CLI forward presentation options to the service without selecting content defaults', async (t) => {
  const { endpoint, calls } = await fixture(t);
  for (const [operation, input] of [
    ['status', { presentation: 'compact' }],
    ['search', { presentation: 'compact', queries: ['decision'] }],
    ['context', { presentation: 'compact', view: 'full', contextRef: 'snapshot', refs: ['e1'] }],
    ['read', { presentation: 'compact', textFormat: 'text', contextRef: 'snapshot', refs: ['e1'] }],
    // Enum and operation validation belongs to the service, after transport shape validation.
    ['search', { presentation: 'unsupported', textFormat: 'unsupported', view: 'unsupported' }],
  ]) {
    assert.deepEqual((await requestHistory(endpoint, operation, input)).received, input);
    assert.deepEqual(calls.at(-1), { operation, input });
  }
  let stdout = '';
  assert.equal(await runHistoryCli(['read', '--endpoint', endpoint, '--presentation', 'compact', '--text-format', 'text', '--context', 'snapshot', '--ref', 'e1'], {
    stdout: { write(text) { stdout += text; } },
  }), 0);
  assert.deepEqual(JSON.parse(stdout).received, { presentation: 'compact', textFormat: 'text', contextRef: 'snapshot', refs: ['e1'] });
});

test('flag-like literal clues reach the search endpoint instead of activating CLI help', async (t) => {
  const { endpoint, calls } = await fixture(t);
  for (const clue of ['--help', '-h', '--repo', '--status=failed', '--']) {
    let stdout = '';
    const status = await runHistoryCli(['search', '--endpoint', endpoint, '--query', clue], {
      stdout: { write(text) { stdout += text; } },
    });
    assert.equal(status, 0);
    assert.equal(JSON.parse(stdout).operation, 'history.search');
    assert.deepEqual(calls.at(-1).input.queries, [clue]);
  }
  assert.equal(calls.length, 5);
  assert.deepEqual(parseHistoryArgs(['search', '--file', '--help', '--exclude', '-h']).input,
    { file: '--help', exclude: ['-h'] });
  assert.deepEqual(parseHistoryArgs(['search', '--help']), { help: true });
  assert.deepEqual(parseHistoryArgs(['search', '--query', '--help', '-h']), { help: true });
  assert.deepEqual(parseHistoryArgs(['--help']), { help: true });
});

test('CLI rejects unknown positional names instead of silently accepting them as serve options', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf']) {
    for (const args of [
      ['serve', '--repo', '/project', '--source', 'codex', name, 'ignored'],
      ['search', name, 'ignored'],
    ]) assert.throws(() => parseHistoryArgs(args), { code: 'INVALID_OPTION' });
    assert.deepEqual(parseHistoryArgs(['search', '--query', name]).input.queries, [name]);
  }
});

test('transport rejects mutation routes, browser origins, malformed and oversized input before execution', async (t) => {
  const { endpoint, calls } = await fixture(t);
  const cases = [
    ['/api/project', 'POST', {}, '{}', 404],
    ['/api/history/status', 'GET', {}, undefined, 405],
    ['/api/history/search', 'POST', { origin: 'https://example.com' }, '{}', 403],
    ['/api/history/search', 'POST', { 'content-type': 'text/plain' }, '{}', 415],
    ['/api/history/search', 'POST', {}, 'oops', 400],
    ['/api/history/search', 'POST', {}, '{"repo":"different-project"}', 400],
    ['/api/history/search', 'POST', {}, '{"limit":"8"}', 400],
    ['/api/history/search', 'POST', {}, '{"order":false}', 400],
    ['/api/history/search', 'POST', {}, '{"session":[]}', 400],
    ['/api/history/search', 'POST', {}, '{"session":" "}', 400],
    ['/api/history/search', 'POST', {}, '{"presentation":false}', 400],
    ['/api/history/context', 'POST', {}, '{"view":[]}', 400],
    ['/api/history/read', 'POST', {}, '{"textFormat":1}', 400],
    ['/api/history/read', 'POST', {}, '{"textFormat":" "}', 400],
    ['/api/history/read', 'POST', {}, '{"text_format":"text"}', 400],
    ['/api/history/search', 'POST', {}, '{"compact":true}', 400],
    ['/api/history/search', 'POST', {}, ' '.repeat(MAX_BODY_BYTES + 1), 413],
  ];
  for (const [route, method, headers, body, expected] of cases) {
    const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal(response.status, expected, `${method} ${route} ${body?.slice(0, 50)}`);
    assert.equal((await response.json()).producer, 'session-analyzer');
  }
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(endpoint + '/api/history/search', { method: 'POST', headers: { host: 'example.com', 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal(calls.length, 0);
});

test('CLI refuses incompatible server envelopes and reports JSON errors', async (t) => {
  const server = http.createServer((req, res) => res.end('{"hello":"world"}'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  let stdout = '';
  const status = await runHistoryCli(['status', '--endpoint', `http://127.0.0.1:${server.address().port}`], { stdout: { write(text) { stdout += text; } } });
  assert.equal(status, 1);
  assert.equal(JSON.parse(stdout).error.code, 'INVALID_RESPONSE');
});

test('headless startup closes its isolated service and executable dispatch preserves old help', async () => {
  let closed = 0;
  const running = await startHistoryServer({ repo: '/project', source: 'codex', port: 0 }, async (options) => {
    assert.equal(options.repo, '/project');
    return { execute: async (operation) => envelope(operation), close: async () => { closed += 1; } };
  });
  assert.equal((await requestHistory(running.endpoint, 'status', {})).operation, 'history.status');
  await running.close();
  assert.equal(closed, 1);
  for (const args of [['--help'], ['history', '--help']]) {
    const child = spawnSync(process.execPath, [path.join(__dirname, '../server.js'), ...args], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, args[0] === 'history' ? /history serve/ : /Repository to analyze/);
  }
  const invalid = spawnSync(process.execPath, [path.join(__dirname, '../server.js'), 'history', 'search', '--format', 'text'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_OPTION');
});
