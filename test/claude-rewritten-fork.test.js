'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildClaudeIndex, buildClaudeSourceBackedIndex } = require('../src/claude');

test('rewritten-ID CLI siblings and continued parents do not invent lineage from shared UUIDs', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-rewritten-fork-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'repo');
  const container = path.join(home, 'projects', '-synthetic-repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(container, { recursive: true });
  const parent = '11111111-1111-4111-8111-111111111111';
  const one = '22222222-2222-4222-8222-222222222222';
  const two = '33333333-3333-4333-8333-333333333333';
  const row = (sessionId, uuid, content, parentUuid = null) => ({ version: '2.1.283', sessionId,
    uuid, parentUuid, cwd: repoRoot, type: 'user', message: { role: 'user', content } });
  const write = (id, records) => fs.writeFile(path.join(container, `${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  await write(parent, [row(parent, 'shared-root', 'Synthetic parent')]);
  await write(one, [row(one, 'shared-root', 'Synthetic parent'), row(one, 'one-local', 'Synthetic child one', 'shared-root')]);
  await write(two, [row(two, 'shared-root', 'Synthetic parent'), row(two, 'two-local', 'Synthetic child two', 'shared-root')]);
  let previousIndex;
  for (const state of ['siblings', 'continued-parent', 'missing-parent', 'conflicting-copy']) {
    if (state === 'continued-parent') await write(parent, [row(parent, 'shared-root', 'Synthetic parent'), row(parent, 'parent-new', 'Parent continuation', 'shared-root')]);
    if (state === 'missing-parent') await fs.unlink(path.join(container, `${parent}.jsonl`));
    if (state === 'conflicting-copy') await write(two, [row(two, 'shared-root', 'Conflicting content'), row(two, 'two-local', 'Synthetic child two', 'shared-root')]);
    const index = await buildClaudeIndex({ claudeHome: home, repoRoot, previousIndex });
    const strict = await buildClaudeSourceBackedIndex({ claudeHome: home, repoRoot });
    for (const result of [index, strict]) {
      for (const session of result.sessions) {
        assert.equal(session.forkedFromSessionId, '', state);
        assert.equal(session.forkStorageMode, '', state);
        if (session.sourceSessionId !== parent) assert.equal(session.counts.userMessages, 2, state);
      }
    }
    previousIndex = index;
  }
});
