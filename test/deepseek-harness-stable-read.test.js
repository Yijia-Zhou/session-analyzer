'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const {
  fileIdentity,
  hashBuffer,
  readCommittedArtifactPrefix,
  readStableFile,
} = require('../src/deepseek-harness-storage');

const artifactPath = '/synthetic/session.jsonl';
const content = Buffer.from('{"type":"session"}\n');
const stat = (revision) => ({ dev: 1n, ino: 2n, size: BigInt(content.length), mtimeNs: BigInt(revision), ctimeNs: BigInt(revision) });

// Tests in this file run sequentially; per-test mocks are restored by node:test.
function mockReads(t, { stableAttempt = Infinity, afterStat, readFile } = {}) {
  let stats = 0;
  let reads = 0;
  t.mock.method(fsp, 'stat', async () => {
    stats += 1;
    const attempt = Math.ceil(stats / 2);
    if (stats % 2 === 0) afterStat?.(attempt);
    return stat(attempt >= stableAttempt ? stableAttempt * 2 : stats);
  });
  t.mock.method(fsp, 'readFile', async (...args) => {
    reads += 1;
    return readFile ? readFile(...args) : content;
  });
  t.mock.method(performance, 'now', () => 0);
  return { reads: () => reads, stats: () => stats };
}

function isBusy(error) {
  assert.equal(error.code, 'DEEPSEEK_SOURCE_BUSY');
  assert.equal(error.statusCode, 503);
  assert.equal(error.retryAfterSeconds, 1);
  assert.match(error.message, /changed repeatedly.*Retry when/);
  return true;
}

test('stable file is returned after one complete read', async (t) => {
  const calls = mockReads(t, { stableAttempt: 1 });
  const result = await readStableFile(artifactPath);
  assert.equal(result.buffer, content);
  assert.deepEqual(result.identity, fileIdentity(stat(2)));
  assert.equal(calls.reads(), 1);
});

test('changing file can stabilize on the final allowed attempt', async (t) => {
  const calls = mockReads(t, { stableAttempt: 4 });
  const result = await readStableFile(artifactPath);
  assert.equal(result.buffer, content);
  assert.deepEqual(result.identity, fileIdentity(stat(8)));
  assert.equal(calls.reads(), 4);
});

test('a perpetually changing file fails after four reads', async (t) => {
  const calls = mockReads(t);
  await assert.rejects(readStableFile(artifactPath), isBusy);
  assert.equal(calls.reads(), 4);
  assert.equal(calls.stats(), 8);
});

test('elapsed budget stops retries between complete attempts', async (t) => {
  const calls = mockReads(t);
  let clockReads = 0;
  t.mock.method(performance, 'now', () => clockReads++ === 0 ? 0 : 2000);
  await assert.rejects(readStableFile(artifactPath), isBusy);
  assert.equal(calls.reads(), 1);
  assert.equal(calls.stats(), 2);
});

test('a stable read remains valid when the individual read exceeds the budget', async (t) => {
  const calls = mockReads(t, { stableAttempt: 1 });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(fsp, 'readFile', async () => {
    now = 5000;
    return content;
  });
  assert.equal((await readStableFile(artifactPath)).buffer, content);
  assert.equal(calls.stats(), 2);
});

test('already cancelled reads do not access the file', async (t) => {
  const calls = mockReads(t);
  const controller = new AbortController();
  const reason = new Error('cancelled by caller');
  controller.abort(reason);
  await assert.rejects(readStableFile(artifactPath, controller.signal), (error) => error === reason);
  assert.equal(calls.stats(), 0);
  assert.equal(calls.reads(), 0);
});

test('cancellation on the last attempt wins over the retry budget', async (t) => {
  const controller = new AbortController();
  const reason = new Error('cancelled by caller');
  const calls = mockReads(t, { afterStat: (attempt) => { if (attempt === 4) controller.abort(reason); } });
  await assert.rejects(readStableFile(artifactPath, controller.signal), (error) => error === reason);
  assert.equal(calls.reads(), 4);
});

test('cancellation after the final stat wins over a successful stable read', async (t) => {
  const controller = new AbortController();
  const reason = new Error('cancelled by caller');
  mockReads(t, { stableAttempt: 1, afterStat: () => controller.abort(reason) });
  await assert.rejects(readStableFile(artifactPath, controller.signal), (error) => error === reason);
});

for (const operation of ['stat', 'readFile']) {
  test(`cancellation wins over an underlying ${operation} failure`, async (t) => {
    const controller = new AbortController();
    const reason = new Error('cancelled by caller');
    mockReads(t);
    t.mock.method(fsp, operation, async () => {
      controller.abort(reason);
      throw Object.assign(new Error('file disappeared'), { code: 'ENOENT' });
    });
    await assert.rejects(readStableFile(artifactPath, controller.signal), (error) => error === reason);
  });
}

test('committed-prefix reads propagate busy failures even with an accepted snapshot', async (t) => {
  const calls = mockReads(t);
  await assert.rejects(readCommittedArtifactPrefix(artifactPath, 'none', undefined, {
    fileIdentity: fileIdentity(stat(2)), acceptedBytes: content.length, digest: hashBuffer(content),
  }), isBusy);
  assert.equal(calls.reads(), 4);
});

test('a retried stable snapshot still requires the accepted identity and digest', async (t) => {
  mockReads(t, { stableAttempt: 2 });
  const accepted = { fileIdentity: fileIdentity(stat(4)), acceptedBytes: content.length, digest: hashBuffer(content) };
  const result = await readCommittedArtifactPrefix(artifactPath, 'none', undefined, accepted);
  assert.deepEqual(result.prefix.recordTexts, ['{"type":"session"}']);
  await assert.rejects(readCommittedArtifactPrefix(artifactPath, 'none', undefined, {
    ...accepted, fileIdentity: fileIdentity(stat(2)),
  }), { code: 'INDEXED_SOURCE_STALE' });
  await assert.rejects(readCommittedArtifactPrefix(artifactPath, 'none', undefined, {
    ...accepted, digest: hashBuffer(Buffer.from('different contents')),
  }), { code: 'INDEXED_SOURCE_STALE' });
});
