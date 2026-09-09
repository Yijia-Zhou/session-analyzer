'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  analyzerSessionId,
  buildClaudeIndex,
} = require('../src/claude');
const { buildClaudeEventDetail } = require('../src/claude-detail');

async function makeClaudeFixture(t, name) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-claude-compat-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-compatibility-hardening');
  await fsp.mkdir(repoRoot, { recursive: true });
  const source = await fsp.readFile(path.join(__dirname, 'fixtures', 'claude', name), 'utf8');
  const records = source.trim().split(/\r?\n/u).map((line) => {
    const record = JSON.parse(line);
    if (record.cwd === '__REPO_ROOT__') record.cwd = repoRoot;
    return record;
  });
  const sessionId = records[0].sessionId;
  await fsp.mkdir(container, { recursive: true });
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.writeFile(
    file,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  return {
    claudeHome,
    repoRoot,
    sessionId,
    recordCount: records.length,
    file,
    records,
  };
}

async function rewriteClaudeFixture(fixture) {
  await fsp.writeFile(
    fixture.file,
    `${fixture.records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
}

test('Claude slash-command envelopes are tag-order independent and reject mixed or malformed lookalikes', async (t) => {
  const fixture = await makeClaudeFixture(t, 'compatibility-hardening-m1.jsonl');
  const index = await buildClaudeIndex(fixture);
  const session = index.sessionsById.get(analyzerSessionId(fixture.sessionId));
  assert.ok(session);
  assert.equal(session.rawEvents.length, fixture.recordCount);

  const envelopeRawIds = new Set(session.rawEvents.slice(0, 2).map((raw) => raw.rawId));
  const envelopeEvents = session.logicalEvents.filter((event) => (
    event.layer === 'protocol'
    && event.subtype === 'local_command'
    && event.rawRefs.some((ref) => envelopeRawIds.has(ref.rawId))
  ));
  assert.equal(envelopeEvents.length, 2);

  const rejectedRawIds = new Set(session.rawEvents.slice(2).map((raw) => raw.rawId));
  const rejectedEvents = session.logicalEvents.filter((event) => (
    event.kind === 'user_message'
    && event.rawRefs.some((ref) => rejectedRawIds.has(ref.rawId))
  ));
  assert.equal(rejectedEvents.length, rejectedRawIds.size);
  assert.ok(rejectedEvents.some((event) => event.searchText.includes('ordinary text')));
  assert.ok(rejectedEvents.some((event) => event.searchText.includes('command-extra')));
  assert.ok(rejectedEvents.some((event) => event.searchText.includes('goal-status')));

  for (const raw of session.rawEvents) {
    assert.ok(session.logicalEvents.some((event) => (
      event.rawRefs.some((ref) => ref.rawId === raw.rawId)
    )), `Raw row ${raw.line} remains reachable`);
  }
});

test('Claude local Workflow launch extends async lifecycle and fails closed on contradictory terminals', async (t) => {
  const fixture = await makeClaudeFixture(t, 'workflow-lifecycle.jsonl');
  const index = await buildClaudeIndex(fixture);
  const session = index.sessionsById.get(analyzerSessionId(fixture.sessionId));
  assert.ok(session);
  assert.equal(session.rawEvents.length, fixture.recordCount);

  const success = session.logicalEvents.find((event) => event.callId === 'call-workflow-success');
  const failed = session.logicalEvents.find((event) => event.callId === 'call-workflow-failed');
  const ambiguous = session.logicalEvents.find((event) => event.callId === 'call-workflow-ambiguous');
  assert.equal(success.kind, 'other_tool_call');
  assert.equal(success.label, 'Async workflow');
  assert.equal(success.status, 'success');
  assert.equal(success.lifecycle.kind, 'async_workflow');
  assert.equal(success.lifecycle.taskId, 'workflow-success');
  assert.deepEqual(success.lifecycle.workflow, {
    runId: 'run-success',
    workflowName: 'Synthetic success',
    scriptPath: '/synthetic/workflow-success.md',
    transcriptDir: '/synthetic/transcripts/run-success',
    summary: 'Synthetic workflow launch',
  });
  assert.equal(success.lifecycle.notifications.length, 1, 'trusted queue/user mirrors deduplicate semantically');
  assert.deepEqual(success.lifecycle.terminal.usage, {
    agentCount: 3,
    agentsDone: 3,
    agentsError: 0,
    agentsSkipped: 0,
    agentsEmptyResult: 0,
    totalTokens: null,
    subagentTokens: 120,
    toolUses: 3,
    durationMs: 450,
  });
  assert.equal(success.lifecycle.terminal.outputFile, '/synthetic/output/workflow-success.txt');
  assert.equal(success.lifecycle.terminal.recovery, 'Synthetic recovery is not needed.');
  assert.equal(success.outputStats.durationMs, 450);
  assert.equal(success.rawRefs.length, 4, 'call, receipt, and both source notification mirrors remain traceable');
  assert.ok(success.tags.includes('workflow'));
  assert.ok(success.tags.includes('async'));
  const successDetailEn = buildClaudeEventDetail(session, success.id, 'main', { locale: 'en' });
  const successDetailZh = buildClaudeEventDetail(session, success.id, 'main', { locale: 'zh-CN' });
  assert.equal(successDetailEn.title, 'Async workflow');
  assert.equal(successDetailZh.title, '异步工作流');
  assert.match(JSON.stringify(successDetailEn.timelineSections), /Synthetic workflow completed/);
  assert.match(JSON.stringify(successDetailEn.inspectorSections), /Async workflow launched/);
  assert.match(JSON.stringify(successDetailEn.inspectorSections), /workflow-success\.txt/);
  assert.match(JSON.stringify(successDetailEn.inspectorSections), /Synthetic recovery is not needed/);
  assert.match(JSON.stringify(successDetailEn.inspectorSections), /agentCount/);
  assert.match(JSON.stringify(successDetailZh.inspectorSections), /异步工作流已启动/);
  assert.match(JSON.stringify(successDetailZh.inspectorSections), /工作流终态/);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.lifecycle.kind, 'async_workflow');
  assert.equal(failed.lifecycle.terminal.status, 'failed');
  assert.equal(failed.outputStats.durationMs, 300);
  assert.equal(failed.rawRefs.length, 3);

  assert.equal(ambiguous.status, 'in_progress');
  assert.equal(ambiguous.lifecycle.phase, 'async_launched');
  assert.equal(ambiguous.lifecycle.terminal, null);
  assert.deepEqual(ambiguous.lifecycle.notifications, []);
  assert.equal(ambiguous.rawRefs.length, 2, 'contradictory notifications are not absorbed as trusted lifecycle facts');
  const ambiguousFallbacks = session.logicalEvents.filter((event) => (
    event.layer === 'protocol'
    && ['Synthetic ambiguous success', 'Synthetic contradictory failure']
      .some((text) => event.searchText.includes(text))
  ));
  assert.equal(ambiguousFallbacks.length, 2);

  for (const raw of session.rawEvents) {
    assert.ok(session.logicalEvents.some((event) => (
      event.rawRefs.some((ref) => ref.rawId === raw.rawId)
    )), `Raw row ${raw.line} remains reachable`);
  }
});

test('Claude reindex invalidates an async Workflow when exact terminal evidence is appended', async (t) => {
  const fixture = await makeClaudeFixture(t, 'workflow-lifecycle.jsonl');
  const launchRecords = fixture.records.slice(0, 2);
  await fsp.writeFile(
    fixture.file,
    `${launchRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  const first = await buildClaudeIndex(fixture);
  const firstEvent = first.sessionsById.get(analyzerSessionId(fixture.sessionId)).logicalEvents
    .find((event) => event.callId === 'call-workflow-success');
  assert.equal(firstEvent.status, 'in_progress');
  assert.equal(firstEvent.lifecycle.phase, 'async_launched');

  const unchanged = await buildClaudeIndex({ ...fixture, previousIndex: first });
  assert.equal(unchanged.totals.reusedFileCount, 1);
  await fsp.appendFile(
    fixture.file,
    `${fixture.records.slice(2, 4).map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  const terminal = await buildClaudeIndex({ ...fixture, previousIndex: unchanged });
  const terminalEvent = terminal.sessionsById.get(analyzerSessionId(fixture.sessionId)).logicalEvents
    .find((event) => event.callId === 'call-workflow-success');
  assert.equal(terminal.totals.reusedFileCount, 0);
  assert.equal(terminalEvent.status, 'success');
  assert.equal(terminalEvent.lifecycle.terminal.status, 'completed');
  assert.equal(terminalEvent.rawRefs.length, 4);
  assert.notEqual(terminalEvent, firstEvent);
});

test('Claude local Workflow admission and notification correlation reject incomplete or ambiguous evidence', async (t) => {
  const fixture = await makeClaudeFixture(t, 'workflow-lifecycle-negative.jsonl');
  const index = await buildClaudeIndex(fixture);
  const session = index.sessionsById.get(analyzerSessionId(fixture.sessionId));
  const byCallId = new Map(session.logicalEvents
    .filter((event) => event.callId)
    .map((event) => [event.callId, event]));

  assert.equal(byCallId.get('call-wrong-caller').lifecycle, undefined);
  assert.equal(byCallId.get('call-incomplete-receipt').lifecycle, undefined);
  for (const callId of ['call-mismatch', 'call-noncausal', 'call-invalid-terminal']) {
    const event = byCallId.get(callId);
    assert.equal(event.status, 'in_progress');
    assert.equal(event.lifecycle.phase, 'async_launched');
    assert.equal(event.lifecycle.terminal, null);
    assert.equal(event.rawRefs.length, 2);
  }
  const duplicated = byCallId.get('call-duplicate-notification');
  assert.equal(duplicated.status, 'in_progress');
  assert.equal(duplicated.lifecycle.terminal, null);
  assert.equal(duplicated.rawRefs.length, 2);

  for (const expected of [
    'Synthetic mismatched notification',
    'Synthetic noncausal notification',
    'Synthetic duplicated terminal',
    'Synthetic invalid terminal status',
  ]) {
    assert.ok(session.logicalEvents.some((event) => (
      event.layer === 'protocol' && event.searchText.includes(expected)
    )), `${expected} remains Protocol fallback`);
  }
  assert.equal(
    session.logicalEvents.filter((event) => (
      event.layer === 'protocol' && event.searchText.includes('Synthetic duplicated terminal')
    )).length,
    2,
  );
  for (const raw of session.rawEvents) {
    assert.ok(session.logicalEvents.some((event) => (
      event.rawRefs.some((ref) => ref.rawId === raw.rawId)
    )), `Raw row ${raw.line} remains reachable`);
  }
});

test('Claude Workflow terminal evidence requires exact mirrors and a complete known shape', async (t) => {
  const cases = [
    {
      label: 'non-byte-identical queue/user mirror',
      mutate: (records) => {
        records[3].message.content = records[2].content.replace(
          '<usage>',
          '<usage>\n',
        );
      },
    },
    {
      label: 'unknown terminal tag',
      mutate: (records) => {
        const content = records[2].content.replace(
          '</task-notification>',
          '<extra>unmodeled</extra></task-notification>',
        );
        records[2].content = content;
        records[3].message.content = content;
      },
    },
    {
      label: 'missing usage facts',
      mutate: (records) => {
        const content = records[2].content.replace(/<usage>[\s\S]*<\/usage>/u, '');
        records[2].content = content;
        records[3].message.content = content;
      },
    },
    {
      label: 'malformed usage fact',
      mutate: (records) => {
        const content = records[2].content.replace(
          '<duration_ms>450</duration_ms>',
          '<duration_ms>not-a-number</duration_ms>',
        );
        records[2].content = content;
        records[3].message.content = content;
      },
    },
  ];

  for (const item of cases) {
    const fixture = await makeClaudeFixture(t, 'workflow-lifecycle.jsonl');
    item.mutate(fixture.records);
    await rewriteClaudeFixture(fixture);
    const index = await buildClaudeIndex(fixture);
    const session = index.sessionsById.get(analyzerSessionId(fixture.sessionId));
    const event = session.logicalEvents.find((candidate) => candidate.callId === 'call-workflow-success');
    assert.equal(event.status, 'in_progress', `${item.label}: terminal is not semantic`);
    assert.equal(event.lifecycle.terminal, null, `${item.label}: terminal remains absent`);
    assert.equal(event.rawRefs.length, 2, `${item.label}: only call and receipt are consumed`);
    assert.equal(
      session.logicalEvents.filter((candidate) => (
        candidate.layer === 'protocol'
        && candidate.searchText.includes('Synthetic workflow completed')
      )).length,
      2,
      `${item.label}: both terminal rows remain independently visible`,
    );
  }
});
