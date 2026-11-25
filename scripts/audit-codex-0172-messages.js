'use strict';

// Manual compatibility probe. Only creates synthetic records in a new temporary directory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { startHistoryServer } = require('../src/history-server');
const { runHistoryCli } = require('../src/history-cli');
const { projectTrajectoryEvents } = require('../src/browser/trajectory-presentation');
const { foldingProfiles, displayStateFromRules } = require('../src/folding');

const id = 'dddddddd-0172-4172-8172-dddddddddddd';
const turn = 'dddddddd-0172-4172-8172-000000000001';
const event = payload => ({ type: 'event_msg', payload });
const response = (payload, metadata) => ({ type: 'response_item', payload, ...(metadata ? { metadata } : {}) });
const realtime = (itemId, type, fields = {}) => ({ type: 'realtime_item',
  payload: { id: itemId, realtime_session_id: 'rt-synthetic', type, ...fields } });

function fixture(repoRoot) {
  const item = data => event({ type: 'item_completed', thread_id: id, turn_id: turn, completed_at_ms: 1001, item: data });
  const user = (itemId, text, passthrough = {}, metadata) => response({ type: 'message', id: itemId, role: 'user',
    content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { turn_id: turn, ...passthrough } }, metadata);
  const receipt = { event_id: 'handoff001', realtime_session_id: 'rt-synthetic', observed_at_ms: 1001,
    source_event_ids: ['frame001'] };
  const image = { type: 'Extension', kind: 'image_gen.generation', status: 'completed', generationId: 'synthetic-gen' };
  const heartbeat = ['<heartbeat>', '  <automation_id>fixture</automation_id>',
    '  <current_time_iso>2026-11-01T00:00:00Z</current_time_iso>', '  <instructions>',
    'SYNTH_HEARTBEAT', '  </instructions>', '</heartbeat>'].join('\n');
  const delivery = (complete, text) => response({ type: 'message', role: 'assistant', id: complete ? 'send001' : 'send002',
    content: [{ type: 'output_text', text }], internal_chat_message_metadata_passthrough: { turn_id: turn } },
  { user_input_order: complete ? 3 : 4, delivered_assistant_message: complete
    ? 'codex:code-mode-delivery:v1:complete' : 'codex:code-mode-delivery:v1:incomplete:SYNTH_DELIVERED_EXCERPT' });
  // One silent PCM sample. The two output families below differ only in their audio reference and item identity.
  const inline = { type: 'input_audio', audio_url: 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==' };
  const fileAudio = { type: 'input_audio', file_id: 'file-synthetic-external' };
  const externalPair = (itemId, preparedAudio, submittedAudio) => {
    const fields = { id: itemId, name: 'external_source', namespace: 'fixture' };
    const content = audio => [{ type: 'input_text', text: 'SYNTH_EXTERNAL_AUDIO_TEXT' }, audio];
    return [response({ type: 'function_call_output', ...fields, output: content(preparedAudio) }),
      item({ type: 'FunctionCallOutput', ...fields, output: content(submittedAudio) })];
  };
  const rows = [
    { type: 'session_meta', payload: { id, cwd: repoRoot, history_mode: 'paginated', cli_version: '0.172.0' } },
    event({ type: 'task_started', turn_id: turn }),
    { type: 'realtime_item', payload: { type: 'transcript_segment', id: 'old', realtime_session_id: 'old-session',
      role: 'user', text: 'SYNTH_OLD_SPEECH' } },
    realtime('started', 'realtime_session_started', { observed_at_ms: 999 }),
    realtime('frame001', 'frame', { observed_at_ms: 1000,
      channels: { voice_transcript: { role: 'assistant', text: 'SYNTH_FRAME_SPEECH' } } }),
    user('msg-accepted', 'SYNTH_HANDOFF', {}, { realtime_handoff: { ...receipt, mode: 'steer', handoff_id: 'handoff' } }),
    user('msg-chunk', 'SYNTH_CHUNK', {}, { realtime_session_input: { ...receipt, event_id: 'chunk001' } }),
    item({ type: 'UserMessage', id: 'typed-chunk', content: [{ type: 'text', text: 'SYNTH_CHUNK', text_elements: [] }] }),
    realtime('saved001', 'session_input_saved', { reason: 'session_end', observed_at_ms: 1002, source_event_ids: ['frame001'],
      input_item_id: 'input001', input: 'SYNTH_SAVED_INPUT' }),
    realtime('end', 'realtime_session_closed', { outcome: 'ended', observed_at_ms: 1003 }),
    user('msg-xml', '<example>SYNTH_USER_XML</example>', { content_item_kinds: ['user.text'],
      content_item_metadata: [{ provenance: { type: 'user' } }] }),
    item({ type: 'UserMessage', id: 'typed-xml', content: [{ type: 'text', text: '<example>SYNTH_USER_XML</example>', text_elements: [] }] }),
    { type: 'inter_agent_communication_metadata', payload: { trigger_turn: false } },
    response({ type: 'agent_message', author: '/root/a', recipient: '/root/b',
      content: [{ type: 'input_text', text: 'SYNTH_NATIVE_MAIL' }] }, { user_input_order: 2 }),
    delivery(true, 'SYNTH_DELIVERED_COMPLETE'),
    delivery(false, 'The content of a confirmed assistant message is unavailable. Do not infer what was asked or authorized.'),
    response({ type: 'message', role: 'user', id: 'audio-a', content: [{ type: 'input_text', text: 'SYNTH_AUDIO' },
      { type: 'input_audio', file_id: 'file-synthetic-a' }] }),
    item({ type: 'UserMessage', id: 'audio-b', content: [{ type: 'text', text: 'SYNTH_AUDIO', text_elements: [] },
      { type: 'audio', file_id: 'file-synthetic-a' }] }),
    item({ type: 'AgentMessage', id: 'answer', content: [{ type: 'Text', text: 'SYNTH_ANSWER' }], phase: 'final_answer',
      moderation: { moderated: true, display: { mode: 'hide', version: 1, replacement: { kind: 'wellbeingPromptHelpline' } } } }),
    response({ type: 'message', role: 'assistant', id: 'answer', phase: 'final_answer', content: [
      { type: 'output_text', text: 'SYNTH_ANSWER', annotations: [], logprobs: [] }] }),
    item({ ...image, id: 'image-inline', result: 'YQ==', revisedPrompt: 'SYNTH_IMAGE_INLINE' }),
    item({ ...image, id: 'image-file', fileId: 'file-synthetic', revisedPrompt: 'SYNTH_IMAGE_FILE' }),
    response({ type: 'function_call', name: 'imagegen', call_id: 'image-with-call', arguments: '{"prompt":"synthetic"}' }),
    item({ ...image, id: 'image-with-call', fileId: 'file-synthetic-2', revisedPrompt: 'SYNTH_IMAGE_MIRROR' }),
    response({ type: 'function_call_output', call_id: 'image-with-call', output: 'synthetic tool result' }),
    user('msg-heartbeat', heartbeat, { content_item_kinds: ['user.heartbeat'],
      content_item_metadata: [{ provenance: { type: 'user' } }] }),
    item({ type: 'UserMessage', id: 'typed-heartbeat', content: [{ type: 'text', text: heartbeat, text_elements: [] }] }),
    ...externalPair('external-inline', inline, inline),
    // Import-only control: turn/start rejects a client-submitted audio file ID.
    ...externalPair('external-file', fileAudio, fileAudio),
    // Conditional upload: persistence transforms a clone, while the typed item keeps the submitted inline part.
    ...externalPair('external-converted', fileAudio, inline),
  ];
  return { rows, markers: ['SYNTH_OLD_SPEECH', 'SYNTH_FRAME_SPEECH', 'SYNTH_SAVED_INPUT', 'SYNTH_HANDOFF',
    'SYNTH_CHUNK', 'SYNTH_USER_XML', 'SYNTH_NATIVE_MAIL', 'SYNTH_DELIVERED_COMPLETE', 'SYNTH_DELIVERED_EXCERPT',
    'SYNTH_AUDIO', 'SYNTH_ANSWER', 'SYNTH_IMAGE_INLINE', 'SYNTH_IMAGE_FILE', 'SYNTH_IMAGE_MIRROR', 'SYNTH_HEARTBEAT',
    'SYNTH_EXTERNAL_AUDIO_TEXT'] };
}

async function examine(index, records, markers) {
  const indexed = index.sessionsById.get(id);
  const session = indexed.logicalEvents ? indexed : await materializeSessionForIndex(index, indexed);
  const timelinePage = await codex.query.getTimelineAsync(index, session, { layer: 'main', limit: 100 });
  const rules = foldingProfiles.find(p => p.id === 'narrative').rules;
  const trajectory = projectTrajectoryEvents(timelinePage.events, {
    displayStateForEvent: e => displayStateFromRules(e, rules),
  });
  const mainViews = new Map(trajectory.map(row => [row.eventId, row]));
  const rows = [];
  for (const e of session.logicalEvents) {
    const detail = await codex.buildHydratedEventDetail(index, session, e.id, e.layer, { locale: 'en' });
    assert.deepEqual(detail.rawRefs, e.rawRefs);
    for (const ref of e.rawRefs) {
      const raw = session.rawEvents.find(r => r.rawId === ref.rawId);
      const exact = await codex.readIndexedCodexRawRecord(index, session, raw);
      assert.deepEqual(exact.parsed, records[raw.line - 1]);
    }
    rows.push({ lines: e.rawRefs.map(r => r.line), layer: e.layer, kind: e.kind, subtype: e.subtype,
      lane: mainViews.get(e.id)?.lane, folding: mainViews.get(e.id)?.displayState,
      sections: detail.timelineSections.map(s => s.title) });
  }
  const search = {};
  for (const marker of markers) {
    search[marker] = {};
    for (const layer of ['main', 'protocol', 'raw']) {
      const timeline = await codex.query.getTimelineAsync(index, session, { layer, q: marker });
      const project = await codex.query.filterSessions(index, { layer, q: marker });
      assert.equal(project.matchingEventTotal, timeline.searchEventCount, `${layer}/${marker}: one-file project parity`);
      search[marker][layer] = timeline.searchEventCount;
    }
  }
  return { rows, search, users: session.counts.userMessages, assistants: session.counts.assistantMessages };
}

async function historyProbe(options, markers) {
  const running = await startHistoryServer({ repo: options.repoRoot, source: 'codex', codexHome: options.codexHome, port: 0 });
  try {
    const cli = async args => {
      let output = '';
      const code = await runHistoryCli([...args, '--endpoint', running.endpoint, '--presentation', 'full'],
        { stdout: { write(text) { output += text; } } });
      assert.equal(code, 0, output);
      return JSON.parse(output);
    };
    const hits = {};
    for (const marker of markers) {
      const found = await cli(['search', '--query', marker, '--layer', 'main']);
      hits[marker] = found.items.length;
      if (found.items.length) {
        const read = await cli(['read', '--ref', found.items[0].ref, '--parts', 'raw']);
        assert.equal(read.items[0].ref, found.items[0].ref);
        assert.ok(read.items[0].parts.length);
      }
    }
    return hits;
  } finally { await running.close(); }
}

async function audit() {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-codex-0172-'));
  const options = { codexHome, repoRoot: path.join(codexHome, 'repo') };
  try {
    await fs.mkdir(options.repoRoot);
    await fs.mkdir(path.join(codexHome, 'sessions'));
    const { rows, markers } = fixture(options.repoRoot);
    const records = rows.map((row, n) => ({ timestamp: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(), ...row }));
    await fs.writeFile(path.join(codexHome, 'sessions', 'rollout-synthetic.jsonl'), records.map(JSON.stringify).join('\n') + '\n');
    const resident = await examine(await codex.__testOnly.buildUncompactedIndexForDetailTests(options), records, markers);
    const compact = await examine(await codex.buildIndex(options), records, markers);
    const cold = await codex.buildSourceBackedIndex(options);
    const sourceBacked = await examine(cold, records, markers);
    const warm = await codex.buildSourceBackedIndex({ ...options, previousIndex: cold });
    assert.equal(warm.totals.reusedFileCount, 1);
    assert.deepEqual(await examine(warm, records, markers), sourceBacked);
    assert.deepEqual(compact, resident);
    assert.deepEqual(sourceBacked, resident);
    const cli = await historyProbe(options, markers);
    process.stdout.write(JSON.stringify({ paths: ['resident', 'compact', 'source-backed', 'warm'], ...resident, historyMainHits: cli }, null, 2) + '\n');
  } finally { await fs.rm(codexHome, { recursive: true, force: true }); }
}

if (require.main === module) audit().catch(err => { console.error(err); process.exitCode = 1; });
