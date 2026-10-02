'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const claude = require('../src/claude');
const source = require('../src/claude-source');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

const secrets = ['HIDDEN_IMAGE_TAIL', 'HIDDEN_AUDIO_TAIL', 'HIDDEN_DOCUMENT_TAIL',
  'HIDDEN_BLOB_TAIL', 'HIDDEN_SIGNATURE_TAIL', 'HIDDEN_ENCRYPTED_TAIL', 'HIDDEN_REDACTED_TAIL'];
function payload(prefixLength = 20000) {
  return { type: 'future_block', text: `${'p'.repeat(prefixLength)} VISIBLE_TEXT_TAIL`,
    nested: {
      allowedSyntaxKey: 'VISIBLE_NESTED_TAIL',
      image: { type: 'image', data: secrets[0] },
      audio: { type: 'audio', data: secrets[1] },
      document: { type: 'document', data: secrets[2] },
      blob: secrets[3], thought_signature: secrets[4], encrypted_content: secrets[5],
      opaque: { type: 'redacted_thinking', data: secrets[6] },
    } };
}

test('Claude scalar and structured search share nested opaque exclusions beyond the old prefix', () => {
  for (const collect of [source.blockSearchText, source.stringifySearchValue]) {
    const text = collect(payload());
    assert.match(text, /VISIBLE_TEXT_TAIL/);
    assert.match(text, /VISIBLE_NESTED_TAIL/);
    for (const secret of secrets) assert.equal(text.includes(secret), false, `${collect.name}: ${secret}`);
  }
  assert.match(source.stringifySearchValue(payload()), /"allowedSyntaxKey"/);
});

for (const prefixLength of [0, 20000]) test(`Claude nested opaque media never enters search through text or preview (${prefixLength})`, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-opaque-search-'));
  let index;
  t.after(async () => {
    disposeProjectQueryStore(index?.projectQueryStore);
    await fs.rm(home, { recursive: true, force: true });
  });
  const repoRoot = path.join(home, 'repo');
  const folder = path.join(home, 'projects', 'synthetic');
  await fs.mkdir(repoRoot);
  await fs.mkdir(folder, { recursive: true });
  const records = [
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'opaque-call', name: 'FutureTool', input: { payload: payload(prefixLength) } },
    ] } },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'opaque-call', content: [payload(prefixLength)] },
    ] }, toolUseResult: payload(prefixLength) },
    { type: 'assistant', message: { role: 'assistant', content: [payload(prefixLength)] } },
  ].map((record, i) => ({ sessionId: 'opaque-search', uuid: `row-${i}`,
    parentUuid: i ? `row-${i - 1}` : null, timestamp: `2026-10-02T00:00:0${i}Z`, cwd: repoRoot, ...record }));
  await fs.writeFile(path.join(folder, 'opaque-search.jsonl'), `${records.map(JSON.stringify).join('\n')}\n`);
  index = await claude.buildClaudeSourceBackedIndex({ claudeHome: home, repoRoot });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  for (const layer of ['main', 'protocol', 'raw']) {
    for (const q of secrets) {
      const project = await claude.query.filterSessions(index, { q, layer });
      const timeline = claude.query.getTimeline(index, session, { q, layer });
      assert.equal(project.matchingEventTotal, 0, `${layer} project ${q}`);
      assert.equal(timeline.searchEventCount, 0, `${layer} session ${q}`);
    }
    for (const q of ['VISIBLE_TEXT_TAIL', 'VISIBLE_NESTED_TAIL', 'allowedSyntaxKey']) {
      const project = await claude.query.filterSessions(index, { q, layer });
      const timeline = claude.query.getTimeline(index, session, { q, layer });
      assert.ok(project.matchingEventTotal > 0, `${layer} keeps ${q}`);
      assert.equal(project.matchingEventTotal, timeline.searchEventCount);
    }
  }
});
