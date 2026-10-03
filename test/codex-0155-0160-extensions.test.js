'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

// Synthetic rust-v0.160.0 shapes. Authority: ext/items/src, ext/image-generation/
// src/tool.rs, ext/web-search/src/tool.rs, core/src/tools/handlers/sleep.rs,
// core/src/tools/handlers/multi_agents/{spawn,send_input,resume_agent,wait,close_agent}.rs.
const ID = 'eeeeeeee-0160-4160-9160-eeeeeeeeeeee';
const CHILD = 'ffffffff-0160-4160-9160-ffffffffffff';
const TURN = 'extension-turn';
const typed = (item) => ({ type: 'event_msg', payload: { type: 'item_completed', thread_id: ID,
  turn_id: TURN, completed_at_ms: 1790935200000, item } });
const call = (id, name, args = {}) => ({ type: 'response_item', payload: {
  type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) } });
const output = (id, value) => ({ type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: value } });

async function fixture(t, rows, historyMode = 'paginated') {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-0160-extensions-'));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(codexHome, 'sessions'));
  const records = [{ type: 'session_meta', payload: { id: ID, cwd: repoRoot, history_mode: historyMode } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: TURN } }, ...rows].map((row, i) => ({
    timestamp: new Date(Date.parse('2026-10-02T10:00:00Z') + i * 1000).toISOString(), ...row,
  }));
  await fs.writeFile(path.join(codexHome, 'sessions', `rollout-${ID}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
  return { records, options: { codexHome, repoRoot } };
}

async function representations(f, inspect) {
  for (const [name, build] of [['strict', codex.__testOnly.buildUncompactedIndexForDetailTests],
    ['compact', codex.buildIndex], ['source-backed', codex.buildSourceBackedIndex]]) {
    const index = await build(f.options);
    const indexed = index.sessionsById.get(ID);
    const session = name === 'source-backed' ? await materializeSessionForIndex(index, indexed) : indexed;
    await inspect(index, session, name);
  }
}

async function readPaths(index, session, e, marker, f) {
  assert.equal(codex.query.getTimeline(index, session, { layer: e.layer, q: marker, limit: 100 }).searchEventCount, 1);
  assert.equal(codex.query.getEvent(index, session, e.id, { layer: e.layer }).id, e.id);
  const detail = await codex.buildHydratedEventDetail(index, session, e.id, e.layer, { locale: 'en' });
  assert.ok(JSON.stringify(detail).includes(marker), `hydrated detail retains ${marker}`);
  assert.deepEqual(detail.rawRefs, e.rawRefs);
  for (const ref of e.rawRefs) {
    const raw = session.rawEvents.find((r) => r.rawId === ref.rawId);
    assert.deepEqual((await codex.readRawLine(index, raw.source.file, raw.source.line)).parsed, f.records[raw.source.line - 1]);
  }
  return detail;
}

function extensionCases() {
  return [
    { name: 'clock.sleep', marker: 'clock.sleep', status: 'completed',
      item: { type: 'Extension', kind: 'clock.sleep', id: 'sleep-fixture', durationMs: 54321 },
      args: { duration_ms: 54321 }, output: 'Wall time: 0.0050 seconds\nSleep interrupted by new input.' },
    ...['completed', 'failed'].map((status) => ({ name: 'imagegen', marker: `image-prompt-${status}`, status: status === 'failed' ? 'failed' : 'success',
      item: { type: 'Extension', kind: 'image_gen.generation', id: `image-${status}`, status,
        revisedPrompt: `image-prompt-${status}`, result: status === 'failed' ? '' : 'YQ==', transparentBackground: true,
        failure: status === 'failed' ? { type: 'usageLimitExceeded', limitId: 'synthetic-limit', resetsAt: null } : null },
      args: { prompt: `image-prompt-${status}` }, output: status === 'failed' ? 'fixture image failure' : 'fixture image result' })),
    ...[{ type: 'search', query: 'web-search-marker', queries: null },
      { type: 'openPage', url: 'https://example.invalid/web-open-marker' },
      { type: 'findInPage', url: 'https://example.invalid/', pattern: 'web-find-marker' }].map((action, i) => ({
      name: 'run', marker: ['web-search-marker', 'web-open-marker', 'web-find-marker'][i], status: 'completed',
      item: { type: 'Extension', kind: 'web.search', id: `web-${i}`, query: ['web-search-marker', 'web-open-marker', 'web-find-marker'][i],
        action, results: [{ title: `result-${i}`, url: 'https://example.invalid/' }] }, args: { search_query: [{ q: `query-${i}` }] },
      output: `web-output-${i}` })),
  ];
}

test('extension items retain one call, source identity, detail and search with optional response mirrors', async (t) => {
  for (const c of extensionCases()) await t.test(c.item.id, async (t) => {
    for (const mode of ['typed-only', 'mixed']) {
      const rows = mode === 'typed-only' ? [typed(c.item)] : [call(c.item.id, c.name, c.args), typed(c.item), output(c.item.id, c.output)];
      const f = await fixture(t, rows);
      await representations(f, async (index, session, repr) => {
        const main = session.logicalEvents.filter((e) => e.layer === 'main');
        assert.equal(main.length, 1, `${mode}/${repr}`);
        assert.equal(session.counts.toolCalls, 1, `${mode}/${repr}`);
        assert.equal(main[0].status, c.status, `${mode}/${repr}`);
        assert.equal(main[0].rawRefs.length, rows.length);
        assert.equal(session.counts.userMessages, 0);
        await readPaths(index, session, main[0], c.marker, f);
        if (c.item.kind === 'clock.sleep') {
          assert.notEqual(main[0].status, 'success');
          assert.notEqual(main[0].outputStats.durationMs, 54321, 'requested duration is not elapsed');
          const raw = session.rawEvents.find((r) => r.line === (mode === 'mixed' ? 4 : 3));
          assert.notEqual(raw.durationMs, 54321, 'source summary must not promote requested duration');
        }
      });
    }
  });
});

test('typed generated PNG previews retain the original nested locator without image bytes in ordinary detail', async (t) => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  for (const mixed of [false, true]) {
    const item = { type: 'Extension', kind: 'image_gen.generation', id: 'image-preview',
      status: 'completed', revisedPrompt: 'generated-preview-marker', result: png };
    const rows = [typed(item)];
    if (mixed) rows.push({ type: 'response_item', payload: { type: 'image_generation_call',
      id: item.id, status: 'completed', revised_prompt: item.revisedPrompt, result: png } });
    const f = await fixture(t, rows);
    await representations(f, async (index, session) => {
      const events = session.logicalEvents.filter((e) => e.layer === 'main');
      assert.equal(events.length, 1);
      assert.equal(session.counts.toolCalls, 1);
      assert.equal(events[0].rawRefs.length, rows.length);
      const detail = await readPaths(index, session, events[0], item.revisedPrompt, f);
      const previewSection = detail.inspectorSections.find((s) => s.type === 'image_preview');
      assert.equal(previewSection.images.length, 1, 'typed preview and legacy mirror show the image once');
      assert.ok(!JSON.stringify(detail).includes(png));
      assert.ok(!JSON.stringify(session).includes(png));
      const preview = await codex.readImagePreview(index, session, events[0].id, previewSection.images[0].previewId);
      assert.equal(preview.mimeType, 'image/png');
      assert.deepEqual(preview.bytes, Buffer.from(png, 'base64'));
    });
  }
});

test('five durable collaboration tool types preserve results with and without response mirrors', async (t) => {
  for (const tool of ['spawn_agent', 'send_input', 'resume_agent', 'wait', 'close_agent']) {
    await t.test(tool, async (t) => {
      for (const mode of ['typed-only', 'mixed']) {
        const id = `collab-${tool}`;
        const marker = `collaboration-marker-${tool}`;
        const item = { type: 'CollabAgentToolCall', id, tool, status: 'completed', sender_thread_id: ID,
          receiver_thread_ids: [CHILD], receiver_agents: [], prompt: marker, agents_states: { [CHILD]: { completed: 'fixture child response' } } };
        const rows = mode === 'typed-only' ? [typed(item)] : [call(id, tool, { message: marker }), typed(item), output(id, 'fixture call result')];
        const f = await fixture(t, rows);
        await representations(f, async (index, session, repr) => {
          const main = session.logicalEvents.filter((e) => e.layer === 'main');
          assert.equal(main.length, 1, `${tool}/${mode}/${repr}`);
          assert.equal(main[0].kind, 'agent_coordination');
          assert.equal(main[0].status, 'success');
          assert.equal(main[0].rawRefs.length, rows.length);
          assert.equal(session.counts.toolCalls, 1);
          assert.equal(session.counts.userMessages, 0);
          await readPaths(index, session, main[0], marker, f);
        });
      }
    });
  }
});

test('interrupted collaboration wait is an interruption rather than a successful completion or failure', async (t) => {
  const marker = 'interrupted-wait-marker';
  const f = await fixture(t, [typed({ type: 'CollabAgentToolCall', id: marker, tool: 'wait', status: 'interrupted',
    sender_thread_id: ID, receiver_thread_ids: [CHILD], receiver_agents: [], agents_states: {} })]);
  await representations(f, async (index, session) => {
    const main = session.logicalEvents.filter((e) => e.layer === 'main');
    assert.equal(main.length, 1);
    assert.equal(main[0].status, 'interrupted');
    assert.equal(session.counts.failedCommands, 0);
    assert.equal(session.counts.errors, 0);
    await readPaths(index, session, main[0], marker, f);
  });
});

test('unknown extension kinds remain Protocol and Raw without inventing tools', async (t) => {
  const marker = 'future-extension-marker';
  const f = await fixture(t, [typed({ type: 'Extension', kind: 'future.unknown', id: 'future-extension', content: marker })]);
  await representations(f, async (index, session) => {
    assert.equal(session.counts.toolCalls, 0);
    assert.equal(session.logicalEvents.filter((e) => e.layer === 'main').length, 0);
    const e = session.logicalEvents.find((e) => e.subtype === 'item_completed');
    assert.ok(e);
    await readPaths(index, session, e, marker, f);
  });
});

test('subagent activity enriches exact call provenance and never becomes a new tool call', async (t) => {
  const activity = { type: 'SubAgentActivity', id: 'message-call', kind: 'interacted', agent_thread_id: CHILD, agent_path: '/root/worker' };
  const completion = { ...activity, id: 'subagent-completed-worker-turn', kind: 'completed' };
  for (const mixed of [false, true]) {
    const rows = mixed ? [call('message-call', 'send_message', { target: '/root/worker', message: 'subagent-message-marker' }),
      typed(activity), output('message-call', 'message accepted'), typed(completion)] : [typed(activity), typed(completion)];
    const f = await fixture(t, rows);
    await representations(f, async (index, session) => {
      const main = session.logicalEvents.filter((e) => e.layer === 'main');
      assert.equal(session.counts.toolCalls, mixed ? 1 : 0);
      assert.equal(session.counts.userMessages, 0);
      assert.equal(main.length, mixed ? 1 : 0);
      if (mixed) {
        assert.equal(main[0].kind, 'agent_coordination');
        assert.equal(main[0].rawRefs.length, 3);
        await readPaths(index, session, main[0], 'subagent-message-marker', f);
      }
      const remaining = session.logicalEvents.filter((e) => e.subtype === 'sub_agent_activity');
      assert.equal(remaining.length, mixed ? 1 : 2);
      for (const e of remaining) {
        assert.equal(e.layer, 'protocol');
        const detail = await codex.buildHydratedEventDetail(index, session, e.id, 'protocol', { locale: 'en' });
        assert.deepEqual(detail.rawRefs, e.rawRefs);
        for (const ref of e.rawRefs) {
          const raw = session.rawEvents.find((r) => r.rawId === ref.rawId);
          assert.deepEqual((await codex.readRawLine(index, raw.source.file, raw.source.line)).parsed, f.records[raw.source.line - 1]);
        }
      }
    });
  }
});

test('standalone web legacy fanout and captured cross-mode mirrors never duplicate a same-call activity', async (t) => {
  const item = { type: 'Extension', kind: 'web.search', id: 'web-fanout', query: 'web-fanout-marker',
    action: { type: 'findInPage', url: 'https://example.invalid/', pattern: 'web-fanout-marker' }, results: [] };
  const end = { type: 'event_msg', payload: { type: 'web_search_end', call_id: item.id,
    query: item.query, action: { ...item.action, type: 'find_in_page' }, results: [] } };
  for (const mode of ['legacy', 'paginated', 'captured-cross-mode']) {
    // A normal writer persists one fanout carrier according to history mode.
    // Both carriers together are a deliberate captured-stream counterexample.
    const carriers = mode === 'legacy' ? [end] : mode === 'paginated' ? [typed(item)] : [typed(item), end];
    const rows = [call(item.id, 'run', { find: [{ ref_id: 'https://example.invalid/', pattern: item.query }] }),
      ...carriers, output(item.id, 'web-fanout-marker')];
    const f = await fixture(t, rows, mode === 'legacy' ? 'legacy' : 'paginated');
    await representations(f, async (index, session) => {
      const main = session.logicalEvents.filter((e) => e.layer === 'main');
      assert.equal(main.length, 1, mode);
      assert.equal(session.counts.toolCalls, 1, mode);
      assert.equal(main[0].rawRefs.length, rows.length, mode);
      await readPaths(index, session, main[0], item.query, f);
    });
  }
});

test('sleep typed completion remains durable with the same response call in Legacy history', async (t) => {
  const item = { type: 'Extension', kind: 'clock.sleep', id: 'legacy-sleep', durationMs: 60000 };
  const rows = [call(item.id, 'sleep', { duration_ms: item.durationMs }), typed(item),
    output(item.id, 'Wall time: 0.0020 seconds\nSleep interrupted by new input.')];
  const f = await fixture(t, rows, 'legacy');
  await representations(f, async (index, session) => {
    const main = session.logicalEvents.filter((e) => e.layer === 'main');
    assert.equal(main.length, 1);
    assert.equal(session.counts.toolCalls, 1);
    assert.equal(main[0].status, 'completed');
    assert.equal(main[0].rawRefs.length, 3);
    assert.notEqual(main[0].outputStats.durationMs, 60000);
    await readPaths(index, session, main[0], 'Sleep interrupted by new input.', f);
  });
});

test('observed 0.160 collaboration.wait_agent joins its typed wait outcome only in the proven namespace', async (t) => {
  // Minimized synthetic reproduction of the user's 2026-10-03 TUI sample.
  // Writer emitted name=wait_agent, namespace=collaboration, item.tool=wait.
  for (const namespace of ['collaboration', 'unrelated']) {
    const invocation = call('observed-wait', 'wait_agent', { timeout_ms: 10000 });
    invocation.payload.namespace = namespace;
    const f = await fixture(t, [invocation, typed({ type: 'CollabAgentToolCall', id: 'observed-wait', tool: 'wait',
      status: 'completed', sender_thread_id: ID, receiver_thread_ids: [CHILD], receiver_agents: [], agents_states: {} }),
    output('observed-wait', 'WAIT_RESULT')]);
    await representations(f, async (index, session) => {
      const main = session.logicalEvents.find((e) => e.layer === 'main');
      assert.ok(main);
      assert.equal(session.counts.toolCalls, 1);
      assert.equal(main.rawRefs.length, namespace === 'collaboration' ? 3 : 2);
      assert.equal(session.logicalEvents.filter((e) => e.subtype === 'item_completed').length, namespace === 'collaboration' ? 0 : 1);
      await readPaths(index, session, main, 'WAIT_RESULT', f);
    });
  }
});
