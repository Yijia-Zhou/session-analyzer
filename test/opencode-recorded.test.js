'use strict';

// Fixed, minimized real-client captures. The expected projections live beside
// the messages and were written by hand, without running the mapper. Runtime
// reconstruction uses node:sqlite only; no OpenCode CLI, network or model call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOpenCodeFixture } = require('./helpers/opencode-fixture');
const { buildOpenCodeIndex, opencodeAdapter } = require('../src/opencode');
const { validateIndexOwnershipForCommit, materializeSessionForIndex,
  readIndexedRawRecord, buildEventDetailForSession } = require('../src/source-adapters');
const { disposeIndexResources } = require('../src/index-resources');
const { validateStructuredLogicalDetailDto, validateLogicalDetailEnvelope } = require('../src/shared/logical-detail-contract');

const fixtures = [
  require('./fixtures/opencode/recorded-tools-compaction-2.1.4.json'),
  require('./fixtures/opencode/recorded-live-export-2.1.4.json'),
  require('./fixtures/opencode/recorded-interrupted-2.1.4.json'),
];

function reconstructedRows(capture) {
  return capture.messages.map(({ sourceIndex, message }) => {
    const { id, type, ...data } = message;
    return { id, type, session_id: capture.sessionID, seq: sourceIndex + 1,
      time_created: data.time.created,
      time_updated: data.time.completed ?? data.time.created,
      data: JSON.stringify(data) };
  });
}

async function capturedIndex(t, fixture, capture) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-opencode-recorded-'));
  const repoRoot = path.join(root, 'project');
  const rows = reconstructedRows(capture);
  let database;
  let index;
  t.after(async () => {
    if (index) await disposeIndexResources(index);
    database?.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  database = createOpenCodeFixture({ dbPath: path.join(root, 'opencode.db'), repoRoot,
    sessions: [{ id: capture.sessionID, directory: repoRoot, version: fixture.producer.version,
      title: 'Recorded message fixture with synthetic session metadata',
      time_created: rows[0].time_created, time_updated: rows.at(-1).time_updated,
      time_idle: null, idle_outcome: null, cost: 0, tokens_input: 0, tokens_output: 0,
      tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0 }],
    messages: rows });
  index = await buildOpenCodeIndex({ sourceHome: database.dbPath, repoRoot,
    snapshotBase: path.join(root, 'snapshots') });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  return { index, session, rows };
}

const mainProjection = (event) => [event.sourceLocator.messageID || '',
  event.opencode.pointer, event.kind, event.status, event.toolName];
const protocolProjection = (event) => [event.sourceLocator.messageID || '', event.subtype, event.status];

test('recorded OpenCode evidence declares its source, minimization and independent expectations', () => {
  for (const fixture of fixtures) {
    assert.equal(fixture.fixtureVersion, 1);
    assert.equal(fixture.kind, 'minimized-sanitized-recorded-messages');
    assert.equal(fixture.producer.version, '2.1.4');
    assert.equal(fixture.producer.sourceSha, '68bc26b7da1990ce10ffecfbc1e09eb13aa5d824');
    assert.match(fixture.captureContext, /Controlled synthetic-project research/);
    assert.match(fixture.expectationOrigin, /Hand-authored/);
    assert.match(fixture.reconstruction, /not captured SQL/);
    for (const source of fixture.sources) {
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert.ok(source.selector.startsWith('$'));
    }
    for (const capture of fixture.cases) {
      assert.ok(fixture.sources.some(source => source.artifact === capture.sourceArtifact));
      assert.match(capture.sessionID, /^ses_recorded_/);
      for (const { message } of capture.messages) {
        assert.match(message.id, /^msg_(tools|live|interrupted)_\d+$/);
        assert.ok(!Object.hasOwn(message, 'native'));
        for (const block of message.content || []) assert.ok(!Object.hasOwn(block, 'native'));
      }
    }
  }
});

for (const fixture of fixtures) for (const capture of fixture.cases) {
  test('recorded OpenCode 2.1.4 ' + capture.name + ': native rows → query, detail and exact Raw', async (t) => {
    const { index, session, rows } = await capturedIndex(t, fixture, capture);
    const expected = capture.expected;
    assert.deepEqual(session.logicalEvents.filter(event => event.layer === 'main').map(mainProjection), expected.main);
    assert.deepEqual(session.logicalEvents.filter(event => event.layer === 'protocol').map(protocolProjection), expected.protocol);
    for (const [key, value] of Object.entries(expected.counts)) assert.equal(session.counts[key], value, key);
    assert.equal(session.rawEventCount, capture.messages.length + 1, 'one synthetic session row plus each selected captured message');
    assert.equal(session.sourceClientVersion, '2.1.4');
    assert.deepEqual(session.analysis.tokenStats.recordedSessionTotals,
      { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      'real message token evidence must not be added into synthetic session totals');

    const timeline = await opencodeAdapter.query.getTimelineAsync(index, session,
      { layer: 'main', limit: 100 });
    assert.deepEqual(timeline.events.map(event => [event.sourceLocator.messageID || '', event.kind, event.status, event.toolName]),
      expected.main.map(([messageID, , kind, status, toolName]) => [messageID, kind, status, toolName]));

    for (const event of session.logicalEvents) {
      const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
      validateStructuredLogicalDetailDto(detail);
      validateLogicalDetailEnvelope(detail, event);
      assert.deepEqual(detail.rawRefs, event.rawRefs);
      assert.deepEqual(detail.sourceLocator, event.sourceLocator);
      if (['user_message', 'assistant_message', 'reasoning', 'compaction', 'abort'].includes(event.kind)) {
        assert.ok(detail.timelineSections.some(section => section.type === 'markdown'
          && section.html.includes(event.opencode.text)), 'Detail preserves the recorded readable text');
      }
    }

    for (const query of expected.queries) {
      const result = await opencodeAdapter.query.filterSessions(index, { layer: query.layer, q: query.q });
      assert.equal(result.total, query.eventCount ? 1 : 0, query.q);
      assert.equal(result.matchingEventTotal, query.eventCount, query.q);
      const timeline = await opencodeAdapter.query.getTimelineAsync(index, session,
        { layer: query.layer, q: query.q, limit: 100 });
      assert.equal(timeline.searchEventCount, query.eventCount);
      const hits = timeline.events.filter(event => event.hasSearchHit);
      assert.equal(hits.length, query.eventCount);
      if (query.eventCount) {
        const event = hits[0];
        assert.equal(event.sourceLocator.messageID, query.messageID);
        assert.equal(event.kind, query.kind);
        assert.equal(result.sessions[0].searchMatch.latestEvent.id, event.id);
        const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
        assert.ok(JSON.stringify(detail.timelineSections).includes(query.q));
        const raw = await readIndexedRawRecord(index, session, event.rawRefs[0].rawId);
        assert.equal(raw.sourceLocator.messageID, query.messageID);
      }
    }

    for (const tool of expected.tools) {
      const event = session.logicalEvents.find(event => event.sourceLocator.messageID === tool.messageID && event.toolName);
      assert.ok(event);
      assert.deepEqual({ messageID: event.sourceLocator.messageID, status: event.status,
        toolStatus: event.opencode.toolStatus, executed: event.opencode.executed,
        exitCode: event.outputStats.exitCode, durationMs: event.outputStats.durationMs,
        output: event.opencode.output, files: event.touchedFiles }, tool);
      const detail = await buildEventDetailForSession(index, session, event.id, event.layer);
      if (tool.output) assert.ok(detail.timelineSections.some(section => section.type === 'terminal' && section.text === tool.output));
      else assert.ok(detail.timelineSections.some(section => section.type === 'notice'
        && section.text.includes('no completed textual result')));
    }

    for (const [position, { message }] of capture.messages.entries()) {
      const rawEvent = session.rawEvents.find(event => event.sourceLocator.messageID === message.id);
      assert.ok(rawEvent);
      assert.equal(rawEvent.line, null);
      const raw = await readIndexedRawRecord(index, session, rawEvent.rawId);
      assert.deepEqual(JSON.parse(raw.raw), rows[position], 'Raw is the exact reconstructed SQL row, not mapped data');
      assert.equal(raw.parsed.data, rows[position].data);
      const { id, type, data } = JSON.parse(raw.raw);
      assert.deepEqual({ id, ...JSON.parse(data), type }, message, 'native captured message shape survives SQL reconstruction');
      assert.equal(raw.sourceLocator.type, 'sqlite_row');
      assert.equal(raw.sourceLocator.table, 'session_message');
      assert.equal(raw.sourceLocator.sessionID, capture.sessionID);
      assert.equal(raw.sourceLocator.snapshotId, index.sessions[0].materializationDescriptor.sourceSnapshotId);
      const detail = await buildEventDetailForSession(index, session, rawEvent.rawId, 'raw');
      assert.deepEqual(detail.timelineSections[0].value, rows[position]);
    }
    if (capture.name === 'tools_compaction') {
      const event = session.logicalEvents.find(event => event.kind === 'compaction');
      const detail = await buildEventDetailForSession(index, session, event.id, 'main');
      assert.equal(event.opencode.compactionStatus, 'completed');
      assert.equal(event.opencode.preservesTranscript, true);
      assert.ok(detail.inspectorSections.some(section => section.text?.includes('Earlier transcript messages remain visible')));
    }
  });
}

test('recorded running API/export divergence and completed convergence remain explicit evidence', () => {
  const cases = fixtures[1].cases;
  const messages = (name) => cases.find(capture => capture.name === name).messages;
  assert.deepEqual(messages('completed_api'), messages('completed_export'));
  assert.deepEqual(messages('running_export'), messages('running_api').slice(0, 1));
  const running = messages('running_api')[1].message;
  const completed = messages('completed_api')[1].message;
  assert.equal(running.id, completed.id, 'the live and persisted forms describe the same mutable message');
  assert.equal(running.content[1].state.status, 'running');
  assert.equal(Object.hasOwn(running.time, 'completed'), false);
  assert.equal(Object.hasOwn(running.content[1].state, 'content'), false);
  assert.equal(completed.content[1].state.status, 'completed');
  assert.equal(completed.content[1].state.metadata.exit, 0);
  assert.ok(completed.time.completed > running.time.created);
});
