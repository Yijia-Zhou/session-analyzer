'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const claude = require('../src/claude');
const { materializeSessionForIndex, validateIndexOwnershipForCommit } = require('../src/source-adapters');
const { disposeProjectQueryStore, scanProjectQueryShard } = require('../src/project-query-store');

async function fixture(t, kind, mirrored, result) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-notice-search-'));
  let index;
  t.after(async () => {
    disposeProjectQueryStore(index?.projectQueryStore);
    await fs.rm(root, { recursive: true, force: true });
  });
  const repoRoot = path.join(root, 'repo');
  const folder = path.join(root, 'projects', 'synthetic');
  await fs.mkdir(repoRoot);
  await fs.mkdir(folder, { recursive: true });
  const task = 'synthetic-task';
  const name = kind === 'mcp' ? 'mcp__synthetic__delay' : kind === 'monitor' ? 'Monitor' : 'Agent';
  const receipt = `MCP tool "synthetic/delay" is still running after 1s. It was moved to the background as task ${task} and keeps running; you'll receive a notification with the result when it completes. You can keep working in the meantime. To stop it, use TaskStop with task_id "${task}". Note: it does not survive exiting this session.`;
  const launchText = kind === 'mcp' ? [{ type: 'text', text: receipt }] : 'Launch receipt';
  const input = kind === 'monitor' ? { command: 'watch', timeout_ms: 3000, persistent: false }
    : kind === 'agent' ? { prompt: 'Inspect synthetic data', run_in_background: true } : {};
  const structured = kind === 'mcp' ? structuredClone(launchText)
    : kind === 'monitor' ? { taskId: task, timeoutMs: 3000, persistent: false }
      : { isAsync: true, status: 'async_launched', agentId: task };
  const tag = kind === 'monitor' ? 'event' : 'result';
  const notice = `<task-notification><task-id>${task}</task-id>${kind !== 'mcp' ? '<tool-use-id>call</tool-use-id>' : ''}<status>completed</status><summary>summary-token</summary><${tag}>${result}</${tag}>${kind === 'agent' ? '<recovery>recovery-token</recovery>' : ''}</task-notification>`;
  const records = [
    { type: 'assistant', uuid: 'call-uuid', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'call', name, input },
    ] } },
    { type: 'user', sourceToolAssistantUUID: 'call-uuid', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'call', content: launchText },
    ] }, toolUseResult: structured },
    ...(mirrored ? [{ type: 'queue-operation', operation: 'enqueue', content: notice }] : []),
    { type: 'user', origin: { kind: 'task-notification' }, promptSource: 'system', message: { content: notice } },
  ].map((record, i) => ({ sessionId: 'notice-search', uuid: `row-${i}`, version: '2.1.283',
    cwd: repoRoot, timestamp: `2026-10-02T00:00:0${i}Z`, ...record }));
  await fs.writeFile(path.join(folder, 'notice-search.jsonl'), `${records.map(JSON.stringify).join('\n')}\n`);
  index = await claude.buildClaudeSourceBackedIndex({ claudeHome: root, repoRoot });
  await validateIndexOwnershipForCommit(index);
  assert.equal(index.sessions.length, 1);
  const session = await materializeSessionForIndex(index, index.sessions[0]);
  assert.equal(session.logicalEvents.length, 1, 'notification source rows are owned by the launch');
  assert.equal(session.logicalEvents[0].status, 'success');
  assert.equal(session.logicalEvents[0].rawRefs.length, mirrored ? 4 : 3);
  assert.equal(session.logicalEvents[0].lifecycle.notifications.length, 1);
  return { index, session };
}

for (const kind of ['mcp', 'monitor', 'agent']) for (const mirrored of [false, true]) {
  for (const [shape, result, expected] of [
    ['short', 'result-token', 1],
    ['long tail', `${'x'.repeat(17000)} result-token`, 1],
    ['two genuine occurrences', 'result-token then result-token', 2],
  ]) {
    test(`Claude ${kind} ${mirrored ? 'queue/user mirror' : 'trusted single'} ${shape} has exact notification search counts`, async t => {
      const { index, session } = await fixture(t, kind, mirrored, result);
      const queries = [['result-token', expected], ['summary-token', 1],
        ...(kind === 'agent' ? [['recovery-token', 1]] : [])];
      const rows = [];
      await scanProjectQueryShard(index.projectQueryStore, session.id, 'main', { includeText: true }, row => rows.push(row));
      assert.equal(rows.length, 1);
      for (const [q, count] of queries) {
        const project = await claude.query.filterSessions(index, { q, layer: 'main' });
        const timeline = await claude.query.getTimeline(index, session, { q, layer: 'main' });
        assert.equal(project.matchingEventTotal, 1);
        assert.equal(project.sessions[0].searchMatch.eventCount, 1);
        assert.equal(project.sessions[0].searchMatch.latestEvent.id, session.logicalEvents[0].id);
        // Project API counts matching events, not occurrences. Inspect its
        // committed row too, then assert Session's public occurrence total.
        assert.equal(rows[0].searchText.split(q).length - 1, count, `indexed projection: ${q}`);
        assert.equal(timeline.searchEventCount, 1);
        assert.equal(timeline.searchMatchCount, count, `materialized occurrence count: ${q}`);
      }
    });
  }
}
