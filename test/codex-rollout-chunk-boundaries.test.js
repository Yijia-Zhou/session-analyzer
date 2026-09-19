'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zstdCompressSync, zstdDecompressSync, constants } = require('node:zlib');
const { openDecodedStream } = require('../src/codex-rollout-storage');

async function fixture(t, bytes) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-frame-boundaries-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'rollout-synthetic.jsonl.zst');
  await fsp.writeFile(file, bytes);
  return file;
}

async function decode(file, highWaterMark) {
  const options = highWaterMark === undefined ? {} : { streamOptions: { highWaterMark } };
  const chunks = [];
  for await (const chunk of openDecodedStream(file, options)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// One raw block: exact encoded length without relying on compressor heuristics.
function boundaryPrefix() {
  const payload = Buffer.alloc(65522, 0x20);
  const header = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x60, 0, 0, 0, 0, 0]);
  header.writeUInt16LE(payload.length - 256, 5);
  header.writeUIntLE((payload.length << 3) | 1, 7, 3);
  const frame = Buffer.concat([header, payload]);
  assert.equal(frame.length, 65532);
  assert.deepEqual(zstdDecompressSync(frame), payload);
  return { frame, payload };
}

const payload = Buffer.from('synthetic boundary content '.repeat(20));
const variants = [
  ['content size', zstdCompressSync(payload)],
  ['checksum', zstdCompressSync(payload, { params: {
    [constants.ZSTD_c_checksumFlag]: 1,
    [constants.ZSTD_c_contentSizeFlag]: 0,
  } })],
];

for (const [name, frame] of variants) {
  test(`${name}: native and whole-frame controls`, async (t) => {
    assert.deepEqual(zstdDecompressSync(frame), payload);
    if (name === 'content size') assert.ok(frame[4] >>> 6);
    else assert.ok(frame[4] & 4);
    assert.deepEqual(await decode(await fixture(t, frame), frame.length), payload);
  });

  test(`${name}: magic ending a chunk preserves the descriptor`, async (t) => {
    assert.deepEqual(await decode(await fixture(t, frame), 4), payload);
  });

  test(`${name}: concatenated frame magic ends at default 64 KiB file boundary`, async (t) => {
    const prefix = boundaryPrefix();
    const file = await fixture(t, Buffer.concat([prefix.frame, frame]));
    assert.deepEqual(await decode(file), Buffer.concat([prefix.payload, payload]));
  });

  test(`${name}: every chunk size through the frame covers header, block and checksum splits`, async (t) => {
    const file = await fixture(t, frame);
    for (let size = 1; size <= frame.length; size++) {
      assert.deepEqual(await decode(file, size), payload, `chunk size ${size}`);
    }
  });
}

test('unknown size, skippable frames and empty final blocks retain zero-byte transitions', async (t) => {
  const unknown = zstdCompressSync(payload, { params: { [constants.ZSTD_c_contentSizeFlag]: 0 } });
  const empty = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0, 1, 0, 0]);
  const emptyThenData = Buffer.from([
    0x28, 0xb5, 0x2f, 0xfd, 0x20, 3,
    0, 0, 0, // Empty non-final raw block; a chunk may end here.
    25, 0, 0, 97, 98, 99, // Final three-byte raw block.
  ]);
  assert.deepEqual(zstdDecompressSync(empty), Buffer.alloc(0));
  assert.deepEqual(zstdDecompressSync(emptyThenData), Buffer.from('abc'));
  assert.deepEqual(zstdDecompressSync(unknown), payload);
  const skipEmpty = Buffer.from([0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0]);
  const skipBody = Buffer.from([0x5f, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3]);
  const bytes = Buffer.concat([emptyThenData, skipEmpty, empty, skipBody, unknown, empty, skipEmpty]);
  const file = await fixture(t, bytes);
  for (const size of [1, 2, 3, 4, 5, 8, 9, 11, bytes.length]) {
    assert.deepEqual(await decode(file, size), Buffer.concat([Buffer.from('abc'), payload]), `chunk size ${size}`);
  }
});

test('truncation and corruption remain errors at chunk boundaries', async (t) => {
  const frame = variants[1][1];
  const file = await fixture(t, frame);
  for (let end = 1; end < frame.length; end++) {
    await fsp.writeFile(file, frame.subarray(0, end));
    await assert.rejects(decode(file, 1), { code: 'CODEX_ROLLOUT_STORAGE_INVALID' });
  }
  const corrupt = Buffer.from(frame);
  corrupt[corrupt.length - 1] ^= 1;
  await fsp.writeFile(file, corrupt);
  await assert.rejects(decode(file, 4), { code: 'CODEX_ROLLOUT_STORAGE_INVALID' });
  await fsp.writeFile(file, Buffer.from([0x50, 0x2a, 0x4d, 0x18, 2, 0, 0, 0, 1]));
  await assert.rejects(decode(file, 4), { code: 'CODEX_ROLLOUT_STORAGE_INVALID' });
});
