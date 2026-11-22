'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { parseHistoryArgs, resolveHistoryInput, runHistoryCli } = require('../src/history-cli');
const { MAX_BODY_BYTES, createHistoryServer } = require('../src/history-server');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'history-input-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const server = createHistoryServer({ async execute(operation, input) {
    calls.push({ operation, input });
    return { producer: 'session-analyzer', operation: `history.${operation}`, schemaVersion: 1, received: input };
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { root, calls, endpoint: `http://127.0.0.1:${server.address().port}` };
}

async function invoke(args, io = {}) {
  let output = '';
  const code = await runHistoryCli(args, { ...io, stdout: { write(value) { output += value; } } });
  return { code, result: JSON.parse(output) };
}

test('around-hit CLI flags form one complete selector and preserve zero', () => {
  assert.deepEqual(parseHistoryArgs(['read', '--ref', 'hit', '--around-hit-before', '0', '--around-hit-after', '99999']).input,
    { refs: ['hit'], aroundHit: { before: 0, after: 99999 } });
  for (const args of [
    ['--around-hit-before', '1'], ['--around-hit-after', '1'],
    ['--around-hit-before', '1', '--around-hit-after', '2', '--around-hit-after', '3'],
    ['--around-hit-before', '1.5', '--around-hit-after', '2'],
    ['--around-hit-before', '-1', '--around-hit-after', '2'],
    ['--around-hit-before', '50000', '--around-hit-after', '50000'],
    ['--around-hit-before', '1', '--around-hit-after', '2', '--input', '{"aroundHit":{"before":1,"after":2}}'],
  ]) assert.throws(() => parseHistoryArgs(['read', ...args]), { code: /INVALID_/ });
});

test('CLI exposes explicit read mode and separates Raw-link indices from text coordinates', () => {
  assert.deepEqual(parseHistoryArgs(['read', '--mode', 'auto', '--raw-offset', '4', '--offset', '17']).input,
    { mode: 'auto', rawOffset: 4, offset: 17 });
  assert.deepEqual(parseHistoryArgs(['read', '--end-offset', '170', '--length', '50']).input, { endOffset: 170, length: 50 });
  for (const args of [['--raw-offset', '-1'], ['--raw-offset', '1e3'], ['--raw-offset', '1', '--input', '{"rawOffset":1}'],
    ['--mode', 'content', '--input', '{"mode":"auto"}']]) {
    assert.throws(() => parseHistoryArgs(['read', ...args]), { code: /INVALID_/ });
  }
});

test('input-file parsing performs no I/O and rejects competing input sources', async () => {
  const parsed = parseHistoryArgs(['read', '--input-file', 'definitely-missing-input-file.json']);
  assert.equal(parsed.inputFile, 'definitely-missing-input-file.json');
  assert.deepEqual(parsed.input, {});
  await assert.rejects(resolveHistoryInput(parsed), { code: 'INPUT_READ_FAILED' });
  for (const args of [
    ['--input', '{}', '--input-file', 'input.json'], ['--input-file', '-', '--input', '{}'],
    ['--input-file', 'first.json', '--input-file', 'second.json'], ['--input-file'],
  ]) assert.throws(() => parseHistoryArgs(['read', ...args]), { code: 'INVALID_OPTION' });
  assert.throws(() => parseHistoryArgs(['serve', '--repo', '/project', '--source', 'codex', '--input-file', '-']), { code: 'INVALID_OPTION' });
});

test('UTF-8 files including a BOM preserve structured input through real HTTP', async (t) => {
  const { root, calls, endpoint } = await fixture(t);
  const input = { refs: ['reference with space'], aroundHit: { before: 0, after: 120 }, maxBytes: 8000 };
  const inputPath = path.join(root, '带 空格.json');
  await fs.writeFile(inputPath, '\ufeff' + JSON.stringify(input));
  const { code, result } = await invoke(['read', '--endpoint', endpoint, '--input-file', inputPath, '--context', 'snapshot']);
  assert.equal(code, 0);
  assert.deepEqual(result.received, { ...input, contextRef: 'snapshot' });
  assert.deepEqual(calls, [{ operation: 'read', input: result.received }]);
});

test('piped UTF-8 JSON preserves Unicode and quoting across byte chunk boundaries', async (t) => {
  const { endpoint, calls } = await fixture(t);
  const input = { queries: ['中文 "quoted" \\path\n$HOME `literal`', "single ' quote 😀"], exclude: ['--help'] };
  const bytes = Buffer.from(JSON.stringify(input));
  const stdin = Readable.from(Array.from(bytes, (byte) => Buffer.from([byte])));
  const { code, result } = await invoke(['search', '--endpoint', endpoint, '--input-file', '-'], { stdin });
  assert.equal(code, 0);
  assert.deepEqual(result.received, input);
  assert.deepEqual(calls, [{ operation: 'search', input }]);
});

test('input-file rejects duplicate fields, invalid shapes and encoding before any request', async (t) => {
  const { endpoint, calls } = await fixture(t);
  for (const [bytes, flags, expected] of [
    [Buffer.from('{"limit":2}'), ['--limit', '2'], 'INVALID_OPTION'],
    [Buffer.from('{"aroundHit":{"before":1,"after":2}}'), ['--around-hit-before', '1', '--around-hit-after', '2'], 'INVALID_OPTION'],
    [Buffer.from('[]'), [], 'INVALID_INPUT'], [Buffer.from('{"unknown":true}'), [], 'INVALID_INPUT'],
    [Buffer.from('null'), [], 'INVALID_INPUT'], [Buffer.from('{}\n{}'), [], 'INVALID_JSON'],
    [Buffer.from([123, 34, 113, 34, 58, 34, 255, 34, 125]), [], 'INVALID_INPUT'],
  ]) {
    const { code, result } = await invoke(['read', '--endpoint', endpoint, '--input-file', '-', ...flags], { stdin: Readable.from([bytes]) });
    assert.equal(code, 1);
    assert.equal(result.error.code, expected);
  }
  const tty = Readable.from([]);
  tty.isTTY = true;
  assert.equal((await invoke(['read', '--input-file', '-'], { stdin: tty })).result.error.code, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('file/stdin and the merged object each obey the request byte limit', async (t) => {
  const { root, endpoint, calls } = await fixture(t);
  const largePath = path.join(root, 'large.json');
  await fs.writeFile(largePath, Buffer.alloc(MAX_BODY_BYTES + 1, 32));
  assert.equal((await invoke(['search', '--endpoint', endpoint, '--input-file', largePath])).result.error.code, 'BODY_TOO_LARGE');
  assert.equal((await invoke(['search', '--endpoint', endpoint, '--input-file', '-'], {
    stdin: Readable.from([Buffer.alloc(MAX_BODY_BYTES, 32), Buffer.from('x')]),
  })).result.error.code, 'BODY_TOO_LARGE');
  // Individually legal strings can exceed the transport bound after flags are merged.
  const largeInput = JSON.stringify({ queries: Array.from({ length: 4 }, () => 'x'.repeat(65500)) });
  assert.ok(Buffer.byteLength(largeInput) < MAX_BODY_BYTES);
  assert.equal((await invoke(['search', '--endpoint', endpoint, '--input-file', '-', '--exclude', 'y'.repeat(1000)], {
    stdin: Readable.from([largeInput]),
  })).result.error.code, 'BODY_TOO_LARGE');
  assert.equal(calls.length, 0);
});

test('open file input receives the same complete validation as inline input', async () => {
  const options = parseHistoryArgs(['open', '--input-file', '-', '--no-browser']);
  assert.deepEqual(await resolveHistoryInput(options, { stdin: Readable.from(['{"refs":["one"]}']) }), { refs: ['one'] });
  for (const input of [{}, { refs: ['one', 'two'] }, { refs: ['one'], length: 20 }]) {
    await assert.rejects(resolveHistoryInput(options, { stdin: Readable.from([JSON.stringify(input)]) }), { code: 'INVALID_ARGUMENT' });
  }
});
