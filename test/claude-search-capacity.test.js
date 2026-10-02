'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const claude = require('../src/claude');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

test('Claude full text survives display limits, disk spill, materialization and Raw pagination', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-full-search-'));
  let index;
  t.after(async () => { disposeProjectQueryStore(index?.projectQueryStore); await fs.rm(home, { recursive: true, force: true }); });
  const repoRoot = path.join(home, 'repo');
  const folder = path.join(home, 'projects', 'synthetic');
  await fs.mkdir(repoRoot); await fs.mkdir(folder, { recursive: true });
  const text = `${'界'.repeat(1_400_000)} unique-body-tail`;
  const input = `${'a'.repeat(20_000)} unique-argument-tail`;
  const records = [
    { type: 'user', message: { role: 'user', content: text } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: `${'r'.repeat(20_000)} unique-reason-tail`, signature: 'forbidden-signature' },
      { type: 'tool_use', id: 'call', name: 'Bash', input: { command: input } },
    ] } },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'call', content: 'unique-short-error', is_error: true },
    ] }, toolUseResult: { stdout: 'o'.repeat(20_000), stderr: 'unique-stderr-tail', exitCode: 1 } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'future_block', text: `${'p'.repeat(20_000)} unique-protocol-tail` },
      { type: 'image', source: { type: 'base64', data: 'forbidden-media-bytes' } },
    ] } },
  ].map((record, i) => ({ sessionId: 'full-search', uuid: `uuid-${i}`, parentUuid: i ? `uuid-${i - 1}` : null,
    timestamp: `2026-08-16T10:00:0${i}Z`, cwd: repoRoot, ...record }));
  await fs.writeFile(path.join(folder, 'full-search.jsonl'), records.map(JSON.stringify).join('\n') + '\n');
  index = await claude.buildClaudeSourceBackedIndex({ claudeHome: home, repoRoot });
  assert.equal(index.sessions.length, 1);
  assert.equal(index.projectQueryStore.schemaVersion, 3);
  await validateIndexOwnershipForCommit(index);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  for (const [q, layers] of [
    ['unique-body-tail', ['main', 'raw']], ['unique-reason-tail', ['main', 'raw']],
    ['unique-argument-tail', ['main', 'raw']], ['unique-short-error', ['main', 'raw']],
    ['unique-stderr-tail', ['main', 'raw']], ['unique-protocol-tail', ['protocol']],
  ]) for (const layer of layers) {
    const project = await claude.query.filterSessions(index, { q, layer });
    const timeline = claude.query.getTimeline(index, session, { q, layer });
    assert.equal(project.total, 1, `${q}/${layer}`);
    assert.equal(project.matchingEventTotal, timeline.searchEventCount, `${q}/${layer} parity`);
    assert.ok(timeline.searchMatchCount > 0);
    assert.ok(timeline.events.every((event) => !Object.hasOwn(event, 'searchText')));
    assert.ok(JSON.stringify(timeline).length < 30_000, 'response keeps bounded presentation');
  }
  for (const q of ['forbidden-signature', 'forbidden-media-bytes']) for (const layer of ['main', 'protocol', 'raw']) {
    assert.equal((await claude.query.filterSessions(index, { q, layer })).total, 0);
  }
});
