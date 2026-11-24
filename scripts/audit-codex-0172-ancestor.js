'use strict';

// Offline controls for the frozen-prefix recovery case in upstream
// thread-store/src/local/rollout_lineage_tests.rs. Run manually with node.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { constants, createZstdCompress, zstdCompressSync } = require('node:zlib');
const { buildIndex, buildSourceBackedIndex } = require('../src/codex');
const { disposeIndexResources } = require('../src/index-resources');

async function flushedFrame(text) {
  const stream = createZstdCompress();
  const chunks = [];
  stream.on('data', chunk => chunks.push(chunk));
  try {
    await new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.write(text);
      stream.flush(constants.ZSTD_e_flush, resolve);
    });
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixture-0172-ancestor-'));
  const owner = 'aaaaaaaa-0172-4172-8172-aaaaaaaaaaaa';
  const child = 'bbbbbbbb-0172-4172-8172-bbbbbbbbbbbb';
  const physical = 'cccccccc-0172-4172-8172-cccccccccccc';
  const filename = id => 'rollout-2026-11-24T00-00-00-' + id + '.jsonl';
  const timestamp = '2026-11-24T00:00:00Z';
  const line = (ordinal, type, payload) => JSON.stringify({ timestamp, ordinal, type, payload }) + '\n';
  const header = (id, extra = {}) => ({ id, cwd: dir, history_mode: 'paginated', ...extra });
  const active = path.join(dir, 'sessions');
  const archive = path.join(dir, 'archived_sessions');
  const name = filename(owner + '_' + physical);
  const short = line(0, 'session_meta', header(owner));
  const full = short + line(1, 'response_item', { type: 'message', role: 'user',
    content: [{ type: 'input_text', text: 'frozen prefix fixture' }] });
  try {
    await fs.mkdir(active);
    await fs.mkdir(archive);
    const history_base = { thread_id: physical, end_ordinal_exclusive: 2, end_byte_offset: Buffer.byteLength(full) };
    await fs.writeFile(path.join(active, filename(child)), line(2, 'session_meta', header(child, {
      forked_from_id: owner, history_base, forked_from_ordinal_exclusive: 2,
    })) + line(3, 'event_msg', { type: 'user_message', message: 'independent child question' }));
    await fs.writeFile(path.join(archive, name), full);
    const cases = [['archive-only', null], ['short-active', zstdCompressSync(short)],
      ['unfinished-active', await flushedFrame(short)]];
    for (const [scenario, activeBytes] of cases) {
      if (activeBytes) await fs.writeFile(path.join(active, name + '.zst'), activeBytes);
      for (const build of [buildIndex, buildSourceBackedIndex]) {
        const index = await build({ repoRoot: dir, codexHome: dir });
        try {
          const admitted = index.sessionsById.has(child);
          console.log(JSON.stringify({ scenario, builder: build.name, admitted, codes: index.sourceDiagnostics.counts }));
          assert.equal(admitted, true);
          const selected = index.sessionsById.get(child);
          const snapshots = selected._historySnapshots || selected.materializationDescriptor.payload.historySnapshots;
          assert.equal(snapshots[0].sourceFile, path.join('..', 'archived_sessions', name));
          assert.equal(snapshots[0].acceptedBytes, history_base.end_byte_offset);
          assert.equal(snapshots[0].endOrdinalExclusive, history_base.end_ordinal_exclusive);
        } finally {
          await disposeIndexResources(index);
        }
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
