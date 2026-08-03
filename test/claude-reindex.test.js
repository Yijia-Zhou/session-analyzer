'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  analyzerSessionId,
  analyzerSubagentSessionId,
  buildClaudeIndex,
  readClaudeRawRecord,
  discoverClaudeProjects,
} = require('../src/claude');

async function makeFixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-claude-reindex-'));
  const repoRoot = path.join(home, 'repo');
  const container = path.join(home, 'projects', '-reindex-fixture');
  await fsp.mkdir(repoRoot, { recursive: true });
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  return { home, repoRoot, container };
}

function record(sessionId, cwd, fields = {}) {
  return {
    sessionId,
    cwd,
    version: '2.1.220',
    ...fields,
  };
}

async function writeJsonl(target, records) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${records.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
}

async function writePrimary(fixture, id, extra = []) {
  const target = path.join(fixture.container, `${id}.jsonl`);
  await writeJsonl(target, [
    record(id, fixture.repoRoot, {
      type: 'user',
      uuid: `${id}-user`,
      timestamp: '2026-08-01T00:00:00.000Z',
      message: { role: 'user', content: `Inspect ${id}` },
    }),
    record(id, fixture.repoRoot, {
      type: 'assistant',
      uuid: `${id}-assistant`,
      parentUuid: `${id}-user`,
      timestamp: '2026-08-01T00:00:01.000Z',
      message: { id: `${id}-message`, role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    }),
    ...extra,
  ]);
  return target;
}

test('Claude primary and subagent IDs stay distinct for delimiter-shaped source data and reuse stably', async (t) => {
  const fixture = await makeFixture(t);
  const aliasedHome = `${fixture.home}-alias`;
  await fsp.symlink(
    fixture.home,
    aliasedHome,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  t.after(async () => {
    try {
      await fsp.unlink(aliasedHome);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
  const ambiguousPrimarySourceId = 'parent:agent:child';
  const parentSourceId = 'parent';
  const agentId = 'child';
  const primaryId = analyzerSessionId(ambiguousPrimarySourceId);
  const parentId = analyzerSessionId(parentSourceId);
  const subagentId = analyzerSubagentSessionId(parentSourceId, agentId);

  await writeJsonl(path.join(fixture.container, 'ambiguous-primary.jsonl'), [
    record(ambiguousPrimarySourceId, fixture.repoRoot, {
      type: 'user',
      uuid: 'ambiguous-primary-user',
      timestamp: '2026-08-01T00:00:00.000Z',
      message: { role: 'user', content: 'Primary with delimiter-shaped identity' },
    }),
  ]);
  await writeJsonl(path.join(fixture.container, `${parentSourceId}.jsonl`), [
    record(parentSourceId, fixture.repoRoot, {
      type: 'user',
      uuid: 'parent-user',
      timestamp: '2026-08-01T00:00:01.000Z',
      message: { role: 'user', content: 'Delegate a child' },
    }),
    record(parentSourceId, fixture.repoRoot, {
      type: 'assistant',
      uuid: 'parent-agent',
      parentUuid: 'parent-user',
      timestamp: '2026-08-01T00:00:01.500Z',
      message: {
        id: 'parent-agent-message',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call-child',
          name: 'Agent',
          input: { description: 'Inspect child work' },
        }],
      },
    }),
    record(parentSourceId, fixture.repoRoot, {
      type: 'user',
      uuid: 'parent-result',
      parentUuid: 'parent-agent',
      timestamp: '2026-08-01T00:00:02.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-child', content: 'started' }],
      },
      toolUseResult: { agentId },
    }),
  ]);
  const subagentFile = path.join(
    fixture.container,
    parentSourceId,
    'subagents',
    `agent-${agentId}.jsonl`,
  );
  await writeJsonl(subagentFile, [
    record(parentSourceId, fixture.repoRoot, {
      type: 'user',
      agentId,
      uuid: 'child-user',
      timestamp: '2026-08-01T00:00:01.750Z',
      message: { role: 'user', content: 'Inspect child work' },
    }),
  ]);
  await fsp.writeFile(
    path.join(fixture.container, parentSourceId, 'subagents', `agent-${agentId}.meta.json`),
    JSON.stringify({ agentType: 'Explore', toolUseId: 'call-child', description: 'Inspect child work' }),
    'utf8',
  );

  assert.notEqual(primaryId, subagentId);
  const projects = await discoverClaudeProjects({ claudeHome: aliasedHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, 2);

  const first = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: aliasedHome });
  assert.equal(first.sessions.length, 3);
  assert.equal(first.sessionsById.size, 3);
  assert.equal(first.sourceRoot, await fsp.realpath(path.join(fixture.home, 'projects')));
  assert.ok(first.sessionsById.has(primaryId));
  assert.ok(first.sessionsById.has(parentId));
  assert.ok(first.sessionsById.has(subagentId));
  const child = first.sessionsById.get(subagentId);
  assert.equal(child.parentSessionId, parentId);
  assert.equal(
    child.sourceFile,
    '-reindex-fixture/parent/subagents/agent-child.jsonl',
  );
  assert.equal(child.rawEvents[0].sessionId, subagentId);
  const allRawIds = first.sessions.flatMap((session) => session.rawEvents.map((raw) => raw.rawId));
  assert.equal(new Set(allRawIds).size, allRawIds.length);
  const readback = await readClaudeRawRecord(first, child, child.rawEvents[0]);
  assert.ok(readback, JSON.stringify({
    sourceRoot: first.sourceRoot,
    sourceAbsFile: child.sourceAbsFile,
    raw: child.rawEvents[0],
  }));
  assert.equal(readback?.rawId, child.rawEvents[0].rawId);
  assert.equal(readback?.parsed?.sessionId, parentSourceId);
  const primaryReadback = await readClaudeRawRecord(
    first,
    first.sessionsById.get(primaryId),
    first.sessionsById.get(primaryId).rawEvents[0],
  );
  assert.equal(primaryReadback?.parsed?.sessionId, ambiguousPrimarySourceId);

  const second = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: aliasedHome,
    previousIndex: first,
  });
  assert.equal(second.totals.reusedFileCount, 3);
  assert.deepEqual([...second.sessionsById.keys()].sort(), [...first.sessionsById.keys()].sort());
  for (const id of [primaryId, parentId, subagentId]) {
    assert.equal(second.sessionsById.get(id).rawEvents, first.sessionsById.get(id).rawEvents);
  }
  assert.equal(second.sessionsById.get(subagentId).parentSessionId, parentId);
});

test('Claude reindex reuses an unchanged primary payload with stable totals, progress, identity, and raw readback', async (t) => {
  const fixture = await makeFixture(t);
  const id = '11111111-1111-4111-8111-111111111111';
  await writePrimary(fixture, id);
  const first = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home });
  const progress = [];
  const second = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.home,
    previousIndex: first,
    onProgress: (entry) => progress.push(entry),
  });

  const firstSession = first.sessionsById.get(analyzerSessionId(id));
  const secondSession = second.sessionsById.get(analyzerSessionId(id));
  assert.notEqual(secondSession, firstSession);
  assert.equal(secondSession.rawEvents, firstSession.rawEvents);
  assert.equal(secondSession.logicalEvents, firstSession.logicalEvents);
  assert.equal(second.totals.reusedFileCount, 1);
  assert.equal(progress.at(-1).reusedFileCount, 1);
  assert.equal(second.sessionsById.get(analyzerSessionId(id)), secondSession);
  assert.equal(second.totals.sessionCount, 1);
  assert.equal(second.totals.eventCount, first.totals.eventCount);

  const readback = await readClaudeRawRecord(second, secondSession, secondSession.rawEvents[0]);
  assert.equal(readback?.parsed?.sessionId, id);
});

test('Claude reindex does not reuse a changed primary transcript', async (t) => {
  const fixture = await makeFixture(t);
  const unchangedId = '22222222-2222-4222-8222-222222222222';
  const changedId = '33333333-3333-4333-8333-333333333333';
  await writePrimary(fixture, unchangedId);
  const changedFile = await writePrimary(fixture, changedId);
  const first = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home });
  await fsp.appendFile(changedFile, `${JSON.stringify(record(changedId, fixture.repoRoot, {
    type: 'custom-title',
    uuid: `${changedId}-title`,
    timestamp: '2026-08-01T00:00:02.000Z',
    customTitle: 'Changed after first index',
  }))}\n`, 'utf8');

  const second = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.home,
    previousIndex: first,
  });
  assert.notEqual(
    second.sessionsById.get(analyzerSessionId(changedId)).rawEvents,
    first.sessionsById.get(analyzerSessionId(changedId)).rawEvents,
  );
  assert.equal(second.sessionsById.get(analyzerSessionId(changedId)).title, 'Changed after first index');
  assert.equal(second.totals.reusedFileCount, 0);
});

test('Claude reindex invalidates a parent/subagent bundle when nested transcript or metadata evidence changes', async (t) => {
  const fixture = await makeFixture(t);
  const id = '44444444-4444-4444-8444-444444444444';
  const agentId = 'worker';
  const mainFile = path.join(fixture.container, `${id}.jsonl`);
  const subagentFile = path.join(fixture.container, id, 'subagents', `agent-${agentId}.jsonl`);
  const metaFile = path.join(fixture.container, id, 'subagents', `agent-${agentId}.meta.json`);
  await writeJsonl(mainFile, [
    record(id, fixture.repoRoot, {
      type: 'user', uuid: 'parent-user', timestamp: '2026-08-01T01:00:00.000Z',
      message: { role: 'user', content: 'Delegate work' },
    }),
    record(id, fixture.repoRoot, {
      type: 'assistant', uuid: 'parent-agent', parentUuid: 'parent-user', timestamp: '2026-08-01T01:00:01.000Z',
      message: { id: 'parent-agent-message', role: 'assistant', content: [{
        type: 'tool_use', id: 'call-worker', name: 'Agent', input: { description: 'Inspect files' },
      }] },
    }),
    record(id, fixture.repoRoot, {
      type: 'user', uuid: 'parent-result', parentUuid: 'parent-agent', timestamp: '2026-08-01T01:00:02.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-worker', content: 'started' }] },
      toolUseResult: { agentId },
    }),
  ]);
  await writeJsonl(subagentFile, [
    record(id, fixture.repoRoot, {
      type: 'user', agentId, uuid: 'worker-user', timestamp: '2026-08-01T01:00:01.500Z',
      message: { role: 'user', content: 'Inspect files' },
    }),
  ]);
  await fsp.writeFile(metaFile, JSON.stringify({ agentType: 'Explore', toolUseId: 'call-worker', description: 'Inspect files' }), 'utf8');

  const first = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home });
  const parentId = analyzerSessionId(id);
  const subagentId = analyzerSubagentSessionId(id, agentId);
  assert.ok(first.sessionsById.has(subagentId));
  const unchanged = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home, previousIndex: first });
  assert.equal(unchanged.totals.reusedFileCount, 2);

  await fsp.writeFile(metaFile, JSON.stringify({ agentType: 'Plan', toolUseId: 'call-worker', description: 'Changed sidecar evidence' }), 'utf8');
  const metadataChanged = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home, previousIndex: unchanged });
  assert.equal(metadataChanged.totals.reusedFileCount, 0);
  assert.notEqual(metadataChanged.sessionsById.get(parentId).rawEvents, unchanged.sessionsById.get(parentId).rawEvents);
  assert.notEqual(metadataChanged.sessionsById.get(subagentId).rawEvents, unchanged.sessionsById.get(subagentId).rawEvents);

  await fsp.appendFile(subagentFile, `${JSON.stringify(record(id, fixture.repoRoot, {
    type: 'assistant', agentId, uuid: 'worker-assistant', timestamp: '2026-08-01T01:00:03.000Z',
    message: { id: 'worker-message', role: 'assistant', content: [{ type: 'text', text: 'Nested change' }] },
  }))}\n`, 'utf8');
  const nestedChanged = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home, previousIndex: metadataChanged });
  assert.equal(nestedChanged.totals.reusedFileCount, 0);
  assert.equal(nestedChanged.sessionsById.get(subagentId).rawEvents.length, 2);
});

test('Claude reindex re-evaluates pointer fork relationships instead of carrying them from a reused index', async (t) => {
  const fixture = await makeFixture(t);
  const parentSourceId = '55555555-5555-4555-8555-555555555555';
  const childSourceId = '66666666-6666-4666-8666-666666666666';
  const parentFile = path.join(fixture.container, `${parentSourceId}.jsonl`);
  await writeJsonl(parentFile, [
    record(parentSourceId, fixture.repoRoot, {
      type: 'user', uuid: 'fork-root', timestamp: '2026-08-01T02:00:00.000Z',
      message: { role: 'user', content: 'Create a pointer fork' },
    }),
    record(parentSourceId, fixture.repoRoot, {
      type: 'system', subtype: 'local_command', uuid: 'fork-command', parentUuid: 'fork-root',
      timestamp: '2026-08-01T02:00:01.000Z', content: '<command-name>/fork</command-name>',
    }),
    record(parentSourceId, fixture.repoRoot, {
      type: 'system', subtype: 'local_command', uuid: 'fork-output', parentUuid: 'fork-command',
      timestamp: '2026-08-01T02:00:01.000Z',
      content: '<local-command-stdout>session waiting for a prompt · Pointer child · 66666666</local-command-stdout>',
    }),
  ]);
  await writeJsonl(path.join(fixture.container, `${childSourceId}.jsonl`), [
    { type: 'ai-title', sessionId: childSourceId, aiTitle: 'Pointer child' },
  ]);

  const first = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home });
  const childId = analyzerSessionId(childSourceId);
  assert.equal(first.sessionsById.get(childId).forkedFromSessionId, analyzerSessionId(parentSourceId));
  const unchanged = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.home, previousIndex: first });
  assert.equal(unchanged.totals.reusedFileCount, 2);
  assert.equal(unchanged.sessionsById.get(childId).forkedFromSessionId, analyzerSessionId(parentSourceId));

  const content = await fsp.readFile(parentFile, 'utf8');
  await fsp.writeFile(parentFile, content.replace('66666666</local-command-stdout>', 'deadbeef</local-command-stdout>'), 'utf8');
  const relationshipChanged = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.home,
    previousIndex: unchanged,
  });
  assert.equal(relationshipChanged.totals.reusedFileCount, 0);
  assert.equal(relationshipChanged.sessionsById.get(childId).forkedFromSessionId, '');
});
