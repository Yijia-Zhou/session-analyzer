'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const codex = require('../src/codex');
const claude = require('../src/claude');
const { materializeSessionForIndex, validateIndexOwnership } = require('../src/source-adapters');

async function fixture(t, source) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), `session-contract-capacity-${source}-`));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  await fsp.mkdir(repoRoot);
  return { home, repoRoot };
}

test('Codex commits and materializes copied metadata beyond former dependency byte limits', async (t) => {
  const { home, repoRoot } = await fixture(t, 'codex');
  const id = '11111111-1111-4111-8111-111111111111';
  const folder = path.join(home, 'sessions', '2026', '08', '16');
  await fsp.mkdir(folder, { recursive: true });
  const records = [
    { timestamp: '2026-08-16T10:00:00Z', type: 'session_meta', payload: { id, cwd: repoRoot } },
    { timestamp: '2026-08-16T10:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'capacity fixture' } },
  ];
  await fsp.writeFile(path.join(folder, `rollout-2026-08-16T10-00-00-${id}.jsonl`), `${records.map(JSON.stringify).join('\n')}\n`);
  const title = `${'界'.repeat(1_400_000)}-title-tail`;
  await fsp.writeFile(path.join(home, 'session_index.jsonl'), `${JSON.stringify({ id, thread_name: title })}\n`);
  const index = await codex.buildSourceBackedIndex({ codexHome: home, repoRoot });
  validateIndexOwnership(index);
  const indexed = index.sessionsById.get(id);
  assert.equal(indexed.title, title);
  const dependency = index.materializationDependencies.get(indexed.materializationDescriptor.dependencySetId);
  assert.equal(dependency.entries.length, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(dependency)) > 4 * 1024 * 1024);
  const materialized = await materializeSessionForIndex(index, indexed);
  assert.equal(materialized.analysis.title, title);
  assert.equal(materialized.rawEvents.length, 2);
  dependency.entries[1].evidence.title += 'mutation';
  assert.throws(() => validateIndexOwnership(index), /metadata|identity|snapshot/i);
});

test('Claude commits and materializes growing cwd evidence beyond descriptor limits', async (t) => {
  const { home, repoRoot } = await fixture(t, 'claude');
  const id = 'capacity-claude';
  const folder = path.join(home, 'projects', 'synthetic-capacity');
  await fsp.mkdir(folder, { recursive: true });
  const records = Array.from({ length: 16_385 }, (_, index) => ({
    type: 'user', uuid: `cwd-${index}`, parentUuid: index ? `cwd-${index - 1}` : null,
    sessionId: id, cwd: path.join(repoRoot, `directory-${index}`),
    timestamp: '2026-08-16T10:00:00Z', message: { role: 'user', content: `message-${index}` },
  }));
  await fsp.writeFile(path.join(folder, `${id}.jsonl`), `${records.map(JSON.stringify).join('\n')}\n`);
  const index = await claude.buildClaudeSourceBackedIndex({ claudeHome: home, repoRoot });
  validateIndexOwnership(index);
  assert.equal(index.sessions.length, 1);
  const indexed = index.sessions[0];
  assert.equal(indexed.cwdSet.length, records.length);
  assert.ok(Buffer.byteLength(JSON.stringify(indexed.materializationDescriptor)) > 512 * 1024);
  const materialized = await materializeSessionForIndex(index, indexed);
  assert.deepEqual(materialized.cwdSet, indexed.cwdSet);
  assert.equal(materialized.rawEvents.length, records.length);
  assert.equal(materialized.rawEvents.at(-1).uuid, `cwd-${records.length - 1}`);
  indexed.materializationDescriptor.payload.projection.cwdSet.push('/foreign-cwd');
  assert.throws(() => validateIndexOwnership(index), /projection|snapshot/i);
});
