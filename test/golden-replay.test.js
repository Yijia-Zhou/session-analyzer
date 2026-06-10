'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildEventDetail, buildIndex, getTimeline } = require('../src/codex');

const fixtureCodexHome = path.join(__dirname, 'fixtures', 'codex-home');
const repoRoot = 'G:\\vibe\\term-agent';
const primaryFixtureSessionId = '11111111-1111-1111-1111-111111111111';

async function buildFixtureIndex() {
  return buildIndex({
    repoRoot,
    codexHome: fixtureCodexHome,
  });
}

function rawRefLines(eventOrDetail) {
  return (eventOrDetail.rawRefs || []).map((ref) => ref.line);
}

function stableTimelineEvent(event) {
  return {
    kind: event.kind,
    subtype: event.subtype,
    status: event.status,
    severity: event.severity,
    toolName: event.toolName,
    rawRefLines: rawRefLines(event),
  };
}

function stableDetail(session, event) {
  assert.ok(event, 'expected representative event to exist');
  const detail = buildEventDetail(session, event.id, 'main');
  return {
    kind: event.kind,
    subtype: event.subtype,
    status: event.status,
    severity: event.severity,
    metaKeys: Object.keys(detail.meta || {}).sort(),
    timelineTypes: (detail.timelineSections || []).map((section) => section.type),
    inspectorTypes: (detail.inspectorSections || []).map((section) => section.type),
    rawRefLines: rawRefLines(detail),
  };
}

test('Codex fixture replay keeps stable session and timeline machine fields', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessionsById.get(primaryFixtureSessionId);
  const mainTimeline = getTimeline(index, primaryFixtureSessionId, { layer: 'main', offset: 0, limit: 20, q: '' });
  const protocolTimeline = getTimeline(index, primaryFixtureSessionId, { layer: 'protocol', offset: 0, limit: 8, q: '' });

  assert.deepEqual({
    session: {
      id: session.id,
      logicalEvents: session.logicalEvents.length,
      rawEvents: session.rawEvents.length,
      counts: session.counts,
    },
    mainFirstTwenty: mainTimeline.events.map(stableTimelineEvent),
    protocolFirstEight: protocolTimeline.events.map(stableTimelineEvent),
  }, {
    session: {
      id: primaryFixtureSessionId,
      logicalEvents: 42,
      rawEvents: 58,
      counts: {
        turns: 2,
        messages: 2,
        userMessages: 1,
        assistantMessages: 1,
        reasoning: 1,
        toolCalls: 15,
        failedCommands: 1,
        issueEvents: 11,
        patches: 6,
        compactions: 1,
        aborts: 0,
        errors: 1,
        protocol: 13,
        planArtifacts: 1,
        planEvents: 4,
      },
    },
    mainFirstTwenty: [
      { kind: 'user_message', subtype: 'user_message', status: '', severity: 'normal', toolName: '', rawRefLines: [7, 8] },
      { kind: 'reasoning', subtype: 'reasoning', status: '', severity: 'normal', toolName: '', rawRefLines: [10, 11] },
      { kind: 'assistant_message', subtype: 'assistant_message', status: '', severity: 'normal', toolName: '', rawRefLines: [12, 13] },
      { kind: 'web_search', subtype: 'web_search', status: 'completed', severity: 'normal', toolName: 'web_search', rawRefLines: [14, 15] },
      { kind: 'web_search', subtype: 'web_search', status: 'completed', severity: 'normal', toolName: 'web_search', rawRefLines: [16, 17] },
      { kind: 'web_search', subtype: 'web_search', status: 'completed', severity: 'normal', toolName: 'web_search', rawRefLines: [18] },
      { kind: 'command', subtype: 'shell_command', status: 'failed', severity: 'error', toolName: 'shell_command', rawRefLines: [19, 20, 21] },
      { kind: 'command', subtype: 'shell_command', status: 'success', severity: 'normal', toolName: 'shell_command', rawRefLines: [22, 23] },
      { kind: 'patch', subtype: 'apply_patch', status: 'success', severity: 'normal', toolName: 'apply_patch', rawRefLines: [24, 25, 26] },
      { kind: 'proposed_plan', subtype: 'proposed_plan', status: '', severity: 'normal', toolName: '', rawRefLines: [27, 28] },
      { kind: 'other_tool_call', subtype: 'update_plan', status: 'success', severity: 'normal', toolName: 'update_plan', rawRefLines: [29, 30] },
      { kind: 'plan_update', subtype: 'plan_update', status: '', severity: 'normal', toolName: '', rawRefLines: [34] },
      { kind: 'plan_update', subtype: 'plan_delta', status: '', severity: 'normal', toolName: '', rawRefLines: [35] },
      { kind: 'warning', subtype: 'warning', status: '', severity: 'warning', toolName: '', rawRefLines: [36] },
      { kind: 'warning', subtype: 'guardian_warning', status: '', severity: 'warning', toolName: '', rawRefLines: [37] },
      { kind: 'error', subtype: 'stream_error', status: '', severity: 'error', toolName: '', rawRefLines: [38] },
      { kind: 'command', subtype: 'command', status: 'incomplete', severity: 'warning', toolName: 'command', rawRefLines: [39] },
      { kind: 'command', subtype: 'command', status: 'declined', severity: 'warning', toolName: 'command', rawRefLines: [40] },
      { kind: 'patch', subtype: 'patch', status: 'incomplete', severity: 'warning', toolName: 'patch', rawRefLines: [41] },
      { kind: 'patch', subtype: 'patch', status: 'declined', severity: 'warning', toolName: 'patch', rawRefLines: [42] },
    ],
    protocolFirstEight: [
      { kind: 'protocol', subtype: 'session_meta', status: '', severity: 'normal', toolName: '', rawRefLines: [1] },
      { kind: 'protocol', subtype: 'task_started', status: '', severity: 'normal', toolName: '', rawRefLines: [2] },
      { kind: 'protocol', subtype: 'developer_permissions', status: '', severity: 'normal', toolName: '', rawRefLines: [3] },
      { kind: 'protocol', subtype: 'agents_instructions', status: '', severity: 'normal', toolName: '', rawRefLines: [4] },
      { kind: 'protocol', subtype: 'environment_context', status: '', severity: 'normal', toolName: '', rawRefLines: [5] },
      { kind: 'protocol', subtype: 'turn_context', status: '', severity: 'normal', toolName: '', rawRefLines: [6] },
      { kind: 'protocol', subtype: 'token_count', status: '', severity: 'normal', toolName: '', rawRefLines: [9] },
      { kind: 'protocol', subtype: 'session_configured', status: '', severity: 'normal', toolName: '', rawRefLines: [31] },
    ],
  });
});

test('Codex fixture replay keeps stable representative detail DTO sections', async () => {
  const index = await buildFixtureIndex();
  const session = index.sessionsById.get(primaryFixtureSessionId);
  const mainTimeline = getTimeline(index, primaryFixtureSessionId, { layer: 'main', offset: 0, limit: 100, q: '' });
  const pick = (kind) => mainTimeline.events.find((event) => event.kind === kind);

  assert.deepEqual([
    stableDetail(session, pick('command')),
    stableDetail(session, pick('patch')),
    stableDetail(session, pick('other_tool_call')),
    stableDetail(session, pick('plan_update')),
    stableDetail(session, pick('error')),
  ], [
    {
      kind: 'command',
      subtype: 'shell_command',
      status: 'failed',
      severity: 'error',
      metaKeys: ['channels', 'outputStats', 'severity', 'source', 'status', 'timestamp', 'toolName', 'touchedFiles', 'turnId'],
      timelineTypes: ['code', 'terminal', 'terminal'],
      inspectorTypes: ['kv', 'json'],
      rawRefLines: [19, 20, 21],
    },
    {
      kind: 'patch',
      subtype: 'apply_patch',
      status: 'success',
      severity: 'normal',
      metaKeys: ['channels', 'outputStats', 'severity', 'source', 'status', 'timestamp', 'toolName', 'touchedFiles', 'turnId'],
      timelineTypes: ['patch'],
      inspectorTypes: ['kv', 'notice'],
      rawRefLines: [24, 25, 26],
    },
    {
      kind: 'other_tool_call',
      subtype: 'update_plan',
      status: 'success',
      severity: 'normal',
      metaKeys: ['channels', 'outputStats', 'severity', 'source', 'status', 'timestamp', 'toolName', 'touchedFiles', 'turnId'],
      timelineTypes: ['plan_update', 'code'],
      inspectorTypes: ['kv', 'json'],
      rawRefLines: [29, 30],
    },
    {
      kind: 'plan_update',
      subtype: 'plan_update',
      status: '',
      severity: 'normal',
      metaKeys: ['channels', 'outputStats', 'severity', 'source', 'status', 'timestamp', 'toolName', 'touchedFiles', 'turnId'],
      timelineTypes: ['markdown'],
      inspectorTypes: ['raw_json'],
      rawRefLines: [34],
    },
    {
      kind: 'error',
      subtype: 'stream_error',
      status: '',
      severity: 'error',
      metaKeys: ['channels', 'outputStats', 'severity', 'source', 'status', 'timestamp', 'toolName', 'touchedFiles', 'turnId'],
      timelineTypes: ['notice'],
      inspectorTypes: ['kv', 'raw_json'],
      rawRefLines: [38],
    },
  ]);
});
