'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { nestedCallSections } = require('../src/pi-nested-calls');
const { buildPiIndex } = require('../src/pi');
const { materializeSessionForIndex, buildEventDetailForSession, readIndexedRawRecord } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');

test('nested receipt shows recorded outcomes, absent arguments and bounded call count without inventing outputs', () => {
  const receipt = { complete: false, calls: [
    { id: 'a', name: 'read', status: 'ok', durationMs: 0, arguments: { path: 'sample.txt' } },
    { id: 'b', name: 'edit', status: 'error', error: 'recorded failure' },
    { id: 'c', name: 'bash', status: 'unfinished', arguments: null },
  ] };
  const sections = nestedCallSections(receipt);
  const text = JSON.stringify(sections);
  assert.match(text, /recorded failure/);
  assert.match(text, /arguments were not recorded/);
  assert.match(text, /unsupported shape/);
  assert.match(text, /Nested result payloads are not recorded/);
  assert.ok(sections.some((section) => section.entries?.some((entry) => entry.key === 'Duration (ms)' && entry.value === '0')));
  assert.equal(nestedCallSections({ complete: true, calls: [{ id: 'bad', name: 'read', status: 'future' }] }), null);
  const many = { complete: true, calls: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, name: 'read', status: 'ok' })) };
  const bounded = nestedCallSections(many);
  assert.equal(bounded.filter((section) => section.type === 'kv').length, 25);
  assert.match(bounded.at(-1).text, /Showing 24 of 200/);
  assert.equal(many.calls.length, 200);
  assert.equal(many.complete, true);
});

async function fixture(t, rows) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-reading-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'sessions'));
  const text = [{ type: 'session', version: 3, id: 'reading', cwd: home }, ...rows].map(JSON.stringify).join('\n') + '\n';
  const file = path.join(home, 'sessions', 'synthetic.jsonl');
  await fs.writeFile(file, text);
  const index = await buildPiIndex({ sourceHome: home, repoRoot: home });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  return { index, text, file };
}

test('pi context targets navigate only to accepted branch ancestors and self-compaction is explicit', async (t) => {
  const f = await fixture(t, [
    { type: 'message', id: 'u', parentId: null, message: { role: 'user', content: 'Original text' } },
    { type: 'context_edit', id: 'edit', parentId: 'u', targetId: 'u', replacement: null },
    { type: 'label', id: 'label', parentId: 'edit', targetId: 'u', label: 'anchor' },
    { type: 'compaction', id: 'compact', parentId: 'label', firstKeptEntryId: 'compact', summary: 'Retain no earlier messages', tokensBefore: 20 },
    { type: 'context_edit', id: 'sibling', parentId: 'u', targetId: 'edit', replacement: null },
  ]);
  for (const indexed of f.index.sessions) {
    const session = await materializeSessionForIndex(f.index, indexed);
    for (const event of session.logicalEvents) {
      const detail = await buildEventDetailForSession(f.index, session, event.id, event.layer);
      const links = detail.inspectorSections.filter((section) => section.type === 'event_refs').flatMap((section) => section.items);
      if (event.subtype === 'pi_context_edit') {
        assert.equal(links.length, session.sourceDerivedId === 'compact' ? 1 : 0);
        if (links.length) {
          assert.equal(links[0].layer, 'raw');
          const raw = await readIndexedRawRecord(f.index, session, links[0].id);
          assert.equal(JSON.parse(raw.raw).id, 'u');
        }
      }
      if (event.kind === 'compaction') assert.match(JSON.stringify(detail), /no earlier conversation entries are retained/);
    }
  }
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('structured nested receipt remains inside one outer operation and preserves physical evidence', async (t) => {
  const nestedCalls = { complete: false, calls: Array.from({ length: 150 }, (_, i) => ({
    id: `n${i}`, name: 'read', status: i === 0 ? 'error' : 'ok', arguments: { path: `file${i}.txt` }, error: i === 0 ? 'failure' : undefined,
  })) };
  const f = await fixture(t, [
    { type: 'message', id: 'call', parentId: null, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'outer', name: 'code', arguments: { code: 'recorded code' } }] } },
    { type: 'message', id: 'result', parentId: 'call', message: { role: 'toolResult', toolCallId: 'outer', toolName: 'code', isError: false, content: [{ type: 'text', text: 'Outer result' }], nestedCalls } },
  ]);
  const session = await materializeSessionForIndex(f.index, f.index.sessions[0]);
  assert.equal(session.counts.toolCalls, 1);
  const event = session.logicalEvents.find((item) => item.toolName === 'code');
  const detail = await buildEventDetailForSession(f.index, session, event.id, 'main');
  assert.match(JSON.stringify(detail), /Showing 24 of 150/);
  const raw = await readIndexedRawRecord(f.index, session, event.rawRefs[1].rawId);
  assert.equal(JSON.parse(raw.raw).message.nestedCalls.calls.length, 150);
});

test('invalid tree remains unmodeled rather than acquiring configuration or usage interpretation', async (t) => {
  const f = await fixture(t, [{ type: 'usage', id: 'orphan', parentId: 'missing', kind: 'cache_warm', usage: { input: 50 } }]);
  const session = await materializeSessionForIndex(f.index, f.index.sessions[0]);
  for (const event of session.logicalEvents) {
    const detail = await buildEventDetailForSession(f.index, session, event.id, event.layer);
    assert.ok(detail.inspectorSections.every((section) => section.type !== 'token_usage'));
    assert.doesNotMatch(JSON.stringify(detail), /Branch recorded selections|partial sums/);
  }
});
