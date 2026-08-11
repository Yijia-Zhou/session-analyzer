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
  discoverClaudeProjects,
  readClaudeRawRecord,
  resolveClaudeAnalyzerIdentities,
} = require('../src/claude');
const { getTimeline } = require('../src/codex');
const { buildClaudeEventDetail } = require('../src/claude-detail');
const { createServer, parseArgs } = require('../server');

async function makeClaudeHome(t) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-claude-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  return claudeHome;
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function readFixtureJsonl(name, repoRoot) {
  const source = await fsp.readFile(path.join(__dirname, 'fixtures', 'claude', name), 'utf8');
  return source.trim().split(/\r?\n/).map((line) => {
    const record = JSON.parse(line);
    if (record.cwd === '__REPO_ROOT__') record.cwd = repoRoot;
    return record;
  });
}

function baseRecord(sessionId, cwd, fields = {}) {
  return {
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd,
    sessionId,
    version: '2.1.220',
    gitBranch: 'main',
    ...fields,
  };
}

function assistantRecord(sessionId, cwd, fields) {
  return baseRecord(sessionId, cwd, {
    type: 'assistant',
    ...fields,
  });
}

function userRecord(sessionId, cwd, fields) {
  return baseRecord(sessionId, cwd, {
    type: 'user',
    ...fields,
  });
}

async function buildRichClaudeFixture(t) {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });

  const repeatedUsage = {
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_input_tokens: 5,
    cache_read_input_tokens: 7,
  };
  const records = [
    baseRecord(sessionId, repoRoot, {
      parentUuid: null,
      type: 'mode',
      mode: 'normal',
      uuid: 'meta-1',
      timestamp: '2026-07-31T10:00:00.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'meta-1',
      promptId: 'prompt-1',
      message: { role: 'user', content: 'Inspect this project' },
      uuid: 'user-1',
      timestamp: '2026-07-31T10:00:01.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'user-1',
      message: {
        id: 'message-1',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{ type: 'thinking', thinking: 'I should inspect it.', signature: 'not-searchable' }],
        usage: repeatedUsage,
      },
      uuid: 'assistant-thinking',
      timestamp: '2026-07-31T10:00:02.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'assistant-thinking',
      message: {
        id: 'message-1',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{ type: 'text', text: 'I will inspect the project.' }],
        usage: repeatedUsage,
      },
      uuid: 'assistant-text',
      timestamp: '2026-07-31T09:59:59.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'assistant-text',
      message: {
        id: 'message-1',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'tool_use',
          id: 'call-bash',
          name: 'Bash',
          caller: { type: 'direct' },
          input: { command: 'git status --short', description: 'Inspect status' },
        }],
        usage: repeatedUsage,
      },
      uuid: 'assistant-bash',
      timestamp: '2026-07-31T10:00:03.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'assistant-bash',
      promptId: 'prompt-1',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-bash',
          content: 'clean',
          is_error: false,
        }],
      },
      toolUseResult: { stdout: 'clean', stderr: '', interrupted: false },
      sourceToolAssistantUUID: 'assistant-bash',
      uuid: 'result-bash',
      timestamp: '2026-07-31T10:00:04.000Z',
    }),
    baseRecord(sessionId, repoRoot, {
      parentUuid: 'result-bash',
      type: 'queue-operation',
      operation: 'enqueue',
      content: 'Inspect this project',
      uuid: 'queue-1',
      timestamp: '2026-07-31T10:00:05.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'result-bash',
      message: {
        id: 'message-2',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'tool_use',
          id: 'call-agent',
          name: 'Agent',
          input: {
            description: 'Inspect delegated files',
            prompt: 'Inspect files',
            subagent_type: 'Explore',
          },
        }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      uuid: 'assistant-agent',
      timestamp: '2026-07-31T10:00:06.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'assistant-agent',
      promptId: 'prompt-1',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-agent',
          content: 'Async agent launched successfully.',
          is_error: false,
        }],
      },
      toolUseResult: {
        status: 'async_launched',
        isAsync: true,
        agentId: 'agent-one',
      },
      sourceToolAssistantUUID: 'assistant-agent',
      uuid: 'result-agent',
      timestamp: '2026-07-31T10:00:07.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'result-agent',
      message: {
        id: 'message-3',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'tool_use',
          id: 'call-read',
          name: 'Read',
          input: { file_path: '/outside/secret' },
        }],
        usage: { input_tokens: 15, output_tokens: 3 },
      },
      uuid: 'assistant-read',
      timestamp: '2026-07-31T10:00:08.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'assistant-read',
      promptId: 'prompt-1',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-read',
          content: 'Permission denied',
          is_error: true,
        }],
      },
      toolDenialKind: 'permission-rule',
      toolUseResult: 'Permission denied',
      sourceToolAssistantUUID: 'assistant-read',
      uuid: 'result-read',
      timestamp: '2026-07-31T10:00:09.000Z',
    }),
    baseRecord(sessionId, repoRoot, {
      parentUuid: 'result-read',
      type: 'custom-title',
      customTitle: 'Claude fixture session',
      uuid: 'title-1',
      timestamp: '2026-07-31T10:00:10.000Z',
    }),
    baseRecord(sessionId, repoRoot, {
      parentUuid: null,
      logicalParentUuid: 'result-read',
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      compactMetadata: { trigger: 'manual', preTokens: 200, postTokens: 50 },
      uuid: 'compact-1',
      timestamp: '2026-07-31T10:00:11.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'compact-1',
      isCompactSummary: true,
      message: { role: 'user', content: 'Summary of prior work.' },
      uuid: 'compact-summary',
      timestamp: '2026-07-31T10:00:12.000Z',
    }),
    baseRecord(sessionId, repoRoot, {
      parentUuid: 'compact-summary',
      type: 'attachment',
      attachment: { type: 'compact_file_reference', path: '/tmp/summary.md' },
      uuid: 'compact-reference',
      timestamp: '2026-07-31T10:00:13.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'compact-reference',
      isApiErrorMessage: true,
      error: 'model_not_found',
      apiErrorStatus: 404,
      message: {
        id: 'message-error',
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'The selected model is unavailable.' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      uuid: 'api-error',
      timestamp: '2026-07-31T10:00:14.000Z',
    }),
  ];
  await writeJsonl(file, records);

  const subagentFile = path.join(container, sessionId, 'subagents', 'agent-agent-one.jsonl');
  await writeJsonl(subagentFile, [
    {
      ...userRecord(sessionId, repoRoot, {
        parentUuid: null,
        promptId: 'prompt-1',
        message: { role: 'user', content: 'Inspect delegated files' },
        uuid: 'sub-user',
        timestamp: '2026-07-31T10:00:06.500Z',
      }),
      isSidechain: true,
      agentId: 'agent-one',
    },
    {
      ...assistantRecord(sessionId, repoRoot, {
        parentUuid: 'sub-user',
        message: {
          id: 'sub-message',
          role: 'assistant',
          model: 'claude-opus-test',
          content: [{ type: 'text', text: 'Delegated inspection complete.' }],
          usage: { input_tokens: 8, output_tokens: 4 },
        },
        uuid: 'sub-assistant',
        timestamp: '2026-07-31T10:00:07.500Z',
      }),
      isSidechain: true,
      agentId: 'agent-one',
      attributionAgent: 'Explore',
    },
  ]);
  await fsp.writeFile(
    path.join(container, sessionId, 'subagents', 'agent-agent-one.meta.json'),
    JSON.stringify({
      agentType: 'Explore',
      description: 'Inspect delegated files',
      toolUseId: 'call-agent',
      spawnDepth: 1,
    }),
    'utf8',
  );

  return {
    claudeHome,
    repoRoot,
    container,
    sessionId,
    file,
    records,
  };
}

test('Claude Analyzer Session component encoding is injective and preserves ordinary IDs', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const agentId = 'agent-one';
  assert.equal(analyzerSessionId(uuid), `claude-code:${uuid}`);
  assert.equal(analyzerSubagentSessionId(uuid, agentId), `claude-code:${uuid}:agent:${agentId}`);
  assert.equal(
    analyzerSessionId('parent:agent:child'),
    'claude-code:parent%3Aagent%3Achild',
  );
  assert.equal(
    analyzerSessionId('parent%3Aagent%3Achild'),
    'claude-code:parent%253Aagent%253Achild',
  );

  const identities = [
    analyzerSessionId('parent:agent:child'),
    analyzerSubagentSessionId('parent', 'child'),
    analyzerSessionId('parent%'),
    analyzerSessionId('parent%3A'),
    analyzerSessionId('parent/agent?child#fragment'),
    analyzerSubagentSessionId('parent%3A', 'child'),
    analyzerSubagentSessionId('parent', 'child%'),
  ];
  assert.equal(new Set(identities).size, identities.length);
});

test('Claude Analyzer identity resolution excludes conflicts and dependent candidates but retains unrelated sessions', () => {
  const conflictId = analyzerSessionId('identity-conflict');
  const unrelatedId = analyzerSessionId('identity-unrelated');
  const resolution = resolveClaudeAnalyzerIdentities([
    { id: conflictId, sourceFile: 'primary-a.jsonl' },
    { id: conflictId, sourceFile: 'primary-b.jsonl' },
    {
      id: analyzerSubagentSessionId('identity-conflict', 'child'),
      sourceFile: 'subagents/agent-child.jsonl',
      parentSessionId: conflictId,
    },
    { id: unrelatedId, sourceFile: 'unrelated.jsonl' },
  ]);

  assert.deepEqual(resolution.accepted.map((session) => session.id), [unrelatedId]);
  assert.equal(resolution.conflicts.length, 3);
  assert.ok(resolution.conflicts.every((session) => session.id !== unrelatedId));
});

test('CLI keeps Codex as default and requires explicit Claude Code opt-in', () => {
  const defaults = parseArgs(['node', 'server.js']);
  assert.equal(defaults.source, 'codex');
  assert.match(defaults.claudeHome, /\.claude$/);

  const claude = parseArgs([
    'node',
    'server.js',
    '--source',
    'claude',
    '--claude_home',
    'G:\\claude',
  ]);
  assert.equal(claude.source, 'claude-code');
  assert.equal(claude.claudeHome, 'G:\\claude');
  assert.deepEqual(claude.errors, []);

  assert.match(
    parseArgs(['node', 'server.js', '--source', 'unknown']).errors[0],
    /Invalid value for --source/,
  );
});

test('Claude discovery is layout-aware and groups only top-level transcripts by cwd', async (t) => {
  const fixture = await buildRichClaudeFixture(t);
  const projects = await discoverClaudeProjects({ claudeHome: fixture.claudeHome });

  assert.equal(projects.length, 1);
  assert.equal(projects[0].repoRoot, fixture.repoRoot);
  assert.equal(projects[0].sessionCount, 1);
  assert.equal(projects[0].source, 'claude-code-transcripts');
});

test('Claude primary identity deduplicates an identical renamed export before Analyzer and Raw ids are built', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const containerKey = '-identity-dedup';
  const container = path.join(claudeHome, 'projects', containerKey);
  const sessionId = '10101010-1010-4010-8010-101010101010';
  const records = [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      promptId: 'identity-dedup-prompt',
      message: { role: 'user', content: 'Keep one physical owner' },
      uuid: 'identity-dedup-user',
      timestamp: '2026-08-01T02:00:00.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'identity-dedup-user',
      message: { role: 'assistant', content: [{ type: 'text', text: 'One indexed answer' }] },
      uuid: 'identity-dedup-assistant',
      timestamp: '2026-08-01T02:00:01.000Z',
    }),
  ];
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), records);
  await writeJsonl(path.join(container, 'renamed-export-copy.jsonl'), records);

  const projects = await discoverClaudeProjects({ claudeHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, 1);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const analyzerId = analyzerSessionId(sessionId);
  const session = index.sessionsById.get(analyzerId);
  assert.ok(session);
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessionsById.size, 1);
  assert.equal(session.sourceFile, `${containerKey}/${sessionId}.jsonl`);
  assert.ok(session.rawEvents.every((raw) => raw.sessionId === analyzerId));
  assert.equal(new Set(session.rawEvents.map((raw) => raw.rawId)).size, records.length);
  const rawReadback = await readClaudeRawRecord(index, session, session.rawEvents[0]);
  assert.equal(rawReadback.file, `${containerKey}/${sessionId}.jsonl`);
  assert.equal(rawReadback.parsed.message.content, 'Keep one physical owner');
  assert.deepEqual(index.totals, {
    fileCount: 2,
    candidateFileCount: 1,
    indexedFileCount: 1,
    reusedFileCount: 0,
    skippedFileCount: 0,
    unknownFileCount: 1,
    sessionCount: 1,
    eventCount: 2,
    rawEventCount: 2,
    indexedBytes: session.bytes,
    candidateBytes: session.bytes,
  });
});

test('Claude primary identity fails closed for conflicting files and contradictory declarations', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-identity-conflict');
  const validId = '20202020-2020-4020-8020-202020202020';
  const conflictingId = '30303030-3030-4030-8030-303030303030';
  const contradictoryFirstId = '40404040-4040-4040-8040-404040404040';
  const contradictorySecondId = '50505050-5050-4050-8050-505050505050';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${validId}.jsonl`), [
    userRecord(validId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Only unambiguous session' },
      uuid: 'identity-valid-user',
      timestamp: '2026-08-01T02:10:00.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, 'conflict-a.jsonl'), [
    userRecord(conflictingId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Conflicting transcript A' },
      uuid: 'identity-conflict-a',
      timestamp: '2026-08-01T02:11:00.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, 'conflict-b.jsonl'), [
    userRecord(conflictingId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Conflicting transcript B' },
      uuid: 'identity-conflict-b',
      timestamp: '2026-08-01T02:12:00.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, 'contradictory.jsonl'), [
    baseRecord(contradictoryFirstId, repoRoot, {
      type: 'mode',
      uuid: 'identity-contradictory-first',
      timestamp: '2026-08-01T02:13:00.000Z',
    }),
    baseRecord(contradictorySecondId, repoRoot, {
      type: 'mode',
      uuid: 'identity-contradictory-second',
      timestamp: '2026-08-01T02:13:01.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, 'invalid.jsonl'), [
    baseRecord(null, repoRoot, {
      type: 'mode',
      uuid: 'identity-invalid-null',
      timestamp: '2026-08-01T02:14:00.000Z',
    }),
  ]);

  const projects = await discoverClaudeProjects({ claudeHome });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, 1);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  assert.deepEqual(index.sessions.map((session) => session.sourceSessionId), [validId]);
  assert.equal(index.sessionsById.size, index.sessions.length);
  assert.equal(index.sessionsById.has(analyzerSessionId(conflictingId)), false);
  assert.equal(index.sessionsById.has(analyzerSessionId(contradictoryFirstId)), false);
  assert.equal(index.sessionsById.has(analyzerSessionId(contradictorySecondId)), false);
  assert.equal(index.sessionsById.has(analyzerSessionId('invalid')), false);
  assert.equal(index.totals.fileCount, 5);
  assert.equal(index.totals.candidateFileCount, 1);
  assert.equal(index.totals.indexedFileCount, 1);
  assert.equal(index.totals.unknownFileCount, 4);
  assert.equal(index.totals.sessionCount, 1);
  assert.equal(index.totals.rawEventCount, 1);
});

test('Claude subagent discovery cannot escape the selected source root through record sessionId', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const fileSessionId = 'abababab-abab-4bab-8bab-abababababab';
  const declaredSessionId = '../../outside';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${fileSessionId}.jsonl`), [
    userRecord(declaredSessionId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Selected project activity' },
      uuid: 'escape-parent-user',
      timestamp: '2026-07-31T09:00:00.000Z',
    }),
  ]);
  const escapedSubagent = path.resolve(container, declaredSessionId, 'subagents', 'agent-escape.jsonl');
  await writeJsonl(escapedSubagent, [{
    ...userRecord(declaredSessionId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Must stay outside the index' },
      uuid: 'escaped-subagent-user',
      timestamp: '2026-07-31T09:00:01.000Z',
    }),
    isSidechain: true,
    agentId: 'escape',
  }]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  assert.equal(index.sessions.length, 1);
  assert.equal(index.sessions.some((session) => session.parentSessionId), false);
  assert.equal(index.totals.indexedFileCount, 1);
  assert.equal(index.totals.rawEventCount, 1);
});

test('Claude subagent association rejects conflicting child identity and parent Agent evidence', async (t) => {
  const fixture = await buildRichClaudeFixture(t);
  const subagentsRoot = path.join(fixture.container, fixture.sessionId, 'subagents');
  await fsp.writeFile(
    path.join(subagentsRoot, 'agent-agent-one.meta.json'),
    JSON.stringify({
      agentType: 'Explore',
      description: 'Inspect delegated files',
      toolUseId: 'different-call',
      spawnDepth: 1,
    }),
    'utf8',
  );
  await writeJsonl(path.join(subagentsRoot, 'agent-orphan.jsonl'), [{
    ...userRecord(fixture.sessionId, fixture.repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'No matching parent Agent result' },
      uuid: 'orphan-subagent-user',
      timestamp: '2026-07-31T10:01:00.000Z',
    }),
    isSidechain: true,
    agentId: 'orphan',
  }]);
  await writeJsonl(path.join(subagentsRoot, 'agent-file-identity.jsonl'), [{
    ...userRecord(fixture.sessionId, fixture.repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Conflicting child identity' },
      uuid: 'conflicting-subagent-user',
      timestamp: '2026-07-31T10:01:01.000Z',
    }),
    isSidechain: true,
    agentId: 'record-identity',
  }]);

  const index = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.claudeHome });
  assert.equal(index.sessions.some((session) => session.parentSessionId), false);
  assert.equal(index.totals.indexedFileCount, 1);
  assert.equal(index.totals.rawEventCount, fixture.records.length);
});

test('Claude subagent sidecar cannot disambiguate duplicate parent Agent results', async (t) => {
  const fixture = await buildRichClaudeFixture(t);
  await writeJsonl(fixture.file, [
    ...fixture.records,
    assistantRecord(fixture.sessionId, fixture.repoRoot, {
      parentUuid: 'api-error',
      message: {
        id: 'message-duplicate-agent',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'tool_use',
          id: 'call-agent-duplicate',
          name: 'Agent',
          input: {
            description: 'Inspect delegated files again',
            prompt: 'Inspect files again',
            subagent_type: 'Explore',
          },
        }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      uuid: 'assistant-agent-duplicate',
      timestamp: '2026-07-31T10:00:15.000Z',
    }),
    userRecord(fixture.sessionId, fixture.repoRoot, {
      parentUuid: 'assistant-agent-duplicate',
      promptId: 'prompt-1',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-agent-duplicate',
          content: 'Async agent launched successfully.',
          is_error: false,
        }],
      },
      toolUseResult: {
        status: 'async_launched',
        isAsync: true,
        agentId: 'agent-one',
      },
      sourceToolAssistantUUID: 'assistant-agent-duplicate',
      uuid: 'result-agent-duplicate',
      timestamp: '2026-07-31T10:00:16.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.claudeHome });
  assert.equal(index.sessions.some((session) => session.parentSessionId), false);
  assert.equal(index.totals.indexedFileCount, 1);
  assert.equal(index.totals.rawEventCount, fixture.records.length + 2);
});

test('Claude subagent discovery rejects a real-path escape through a linked directory', async (t) => {
  const fixture = await buildRichClaudeFixture(t);
  const sessionRoot = path.join(fixture.container, fixture.sessionId);
  const outsideSubagents = path.join(fixture.claudeHome, 'outside-subagents');
  await fsp.rm(sessionRoot, { recursive: true, force: true });
  await fsp.mkdir(sessionRoot, { recursive: true });
  await writeJsonl(path.join(outsideSubagents, 'agent-agent-one.jsonl'), [{
    ...userRecord(fixture.sessionId, fixture.repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Linked activity must stay outside the index' },
      uuid: 'linked-subagent-user',
      timestamp: '2026-07-31T10:02:00.000Z',
    }),
    isSidechain: true,
    agentId: 'agent-one',
  }]);
  await fsp.writeFile(
    path.join(outsideSubagents, 'agent-agent-one.meta.json'),
    JSON.stringify({ toolUseId: 'call-agent' }),
    'utf8',
  );
  try {
    await fsp.symlink(
      outsideSubagents,
      path.join(sessionRoot, 'subagents'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(`directory links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const index = await buildClaudeIndex({ repoRoot: fixture.repoRoot, claudeHome: fixture.claudeHome });
  assert.equal(index.sessions.some((session) => session.parentSessionId), false);
  assert.equal(index.totals.indexedFileCount, 1);
});

test('Claude index preserves every JSONL record while projecting messages, tools, compaction, and subagents', async (t) => {
  const fixture = await buildRichClaudeFixture(t);
  const index = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.claudeHome,
  });

  const mainId = analyzerSessionId(fixture.sessionId);
  const childId = analyzerSubagentSessionId(fixture.sessionId, 'agent-one');
  const session = index.sessionsById.get(mainId);
  const child = index.sessionsById.get(childId);
  assert.equal(index.sourceKind, 'claude-code');
  assert.equal(index.totals.fileCount, 1);
  assert.deepEqual(
    session.logicalEvents
      .filter((event) => event.kind === 'agent_coordination')
      .map((event) => ({ callId: event.callId, agentId: event.agentId, toolName: event.toolName })),
    [{ callId: 'call-agent', agentId: 'agent-one', toolName: 'Agent' }],
  );
  assert.equal(index.totals.indexedFileCount, 2);
  assert.equal(index.totals.rawEventCount, fixture.records.length + 2);
  assert.ok(session);
  assert.ok(child);
  assert.equal(session.sourceSessionId, fixture.sessionId);
  assert.equal(session.sourceClientVersion, '2.1.220');
  assert.equal(session.title, 'Claude fixture session');
  assert.equal(child.parentSessionId, mainId);
  assert.equal(child.agentNickname, 'Explore');
  assert.equal(child.subagentToolUseId, 'call-agent');
  assert.equal(child.primarySessionMetaKind, 'subagent');
  assert.match(child.title, /^Explore: Inspect delegated files/);

  const mainKinds = session.logicalEvents.filter((event) => event.layer === 'main').map((event) => event.kind);
  assert.ok(mainKinds.includes('user_message'));
  assert.ok(mainKinds.includes('assistant_message'));
  assert.ok(mainKinds.includes('reasoning'));
  assert.ok(mainKinds.includes('command'));
  assert.ok(mainKinds.includes('read'));
  assert.ok(mainKinds.includes('agent_coordination'));
  assert.equal(mainKinds.includes('other_tool_call'), false);
  assert.ok(mainKinds.includes('compaction'));
  assert.ok(mainKinds.includes('error'));

  const toolEvents = session.logicalEvents.filter((event) => event.toolName);
  assert.equal(toolEvents.length, 3);
  assert.equal(toolEvents.find((event) => event.toolName === 'Bash').status, 'success');
  assert.equal(toolEvents.find((event) => event.toolName === 'Read').kind, 'read');
  assert.equal(toolEvents.find((event) => event.toolName === 'Read').label, 'Read');
  assert.equal(toolEvents.find((event) => event.toolName === 'Read').status, 'declined');
  assert.equal(toolEvents.find((event) => event.toolName === 'Read').severity, 'warning');
  assert.equal(toolEvents.find((event) => event.toolName === 'Agent').agentId, 'agent-one');
  assert.deepEqual(index.eventKinds.main.find((item) => item.value === 'read'), {
    value: 'read', label: 'read', count: 1,
  });
  assert.equal(index.eventKinds.main.some((item) => item.value === 'other_tool_call'), false);
  assert.deepEqual(
    getTimeline(index, session.id, { offset: 0, limit: 100, layer: 'main', kind: 'read' })
      .events.map((event) => event.toolName),
    ['Read'],
  );
  assert.equal(
    buildClaudeEventDetail(
      session,
      toolEvents.find((event) => event.toolName === 'Read').id,
      'main',
      { locale: 'zh-CN' },
    ).title,
    '文件读取',
  );

  const compaction = session.logicalEvents.find((event) => event.kind === 'compaction');
  assert.equal(compaction.rawRefs.length, 3);
  assert.match(compaction.searchText, /Summary of prior work/);
  assert.equal(
    session.logicalEvents.some((event) => event.kind === 'user_message' && /Summary of prior work/.test(event.searchText)),
    false,
  );
  assert.equal(
    session.logicalEvents.some((event) => event.kind === 'user_message' && /Async agent launched/.test(event.searchText)),
    false,
  );
  assert.ok(session.logicalEvents.some((event) => event.layer === 'protocol' && event.subtype === 'enqueue'));

  assert.deepEqual(session.analysis.tokenStats, {
    maxObserved: 100,
    responseCount: 4,
    inputTokens: 125,
    outputTokens: 28,
    cacheCreationInputTokens: 5,
    cacheReadInputTokens: 7,
  });
  const reasoning = session.logicalEvents.find((event) => event.kind === 'reasoning');
  const reasoningRaw = session.rawEvents.find((raw) => raw.uuid === 'assistant-thinking');
  const reasoningIndex = session.logicalEvents.indexOf(reasoning);
  const assistantIndex = session.logicalEvents.findIndex((event) => event.kind === 'assistant_message');
  assert.ok(reasoningIndex < assistantIndex, 'physical line order should win over timestamp regression');
  assert.doesNotMatch(reasoning.searchText, /not-searchable/);

  const logicalReasoningDetail = buildClaudeEventDetail(session, reasoning.id, 'main', { locale: 'en' });
  const rawReasoningDetailEn = buildClaudeEventDetail(session, reasoningRaw.rawId, 'raw', { locale: 'en' });
  const rawReasoningDetailZh = buildClaudeEventDetail(session, reasoningRaw.rawId, 'raw', { locale: 'zh-CN' });
  assert.doesNotMatch(JSON.stringify(logicalReasoningDetail), /signature|not-searchable/);
  assert.match(JSON.stringify(rawReasoningDetailEn), /"signature":"not-searchable"/);
  assert.equal(rawReasoningDetailEn.title, 'thinking');
  assert.equal(rawReasoningDetailZh.title, 'thinking');
});

test('Claude projects background, async Agent, and planning records into source-neutral semantics', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-semantic-lifecycle');
  const sessionId = '81818181-8181-4181-8181-818181818181';
  await fsp.mkdir(repoRoot, { recursive: true });
  const records = await readFixtureJsonl('semantic-lifecycle.jsonl', repoRoot);
  const surrogateRequestPlan = `# Surrogate plan\n\n${String.fromCharCode(0xd800)}`;
  const surrogateResultPlan = `# Surrogate plan\n\n${String.fromCharCode(0xd801)}`;
  records.push(
    assistantRecord(sessionId, repoRoot, {
      uuid: 'semantic-redacted-plan-call',
      parentUuid: 'semantic-away-summary',
      timestamp: '2026-08-03T09:00:20.000Z',
      message: {
        id: 'semantic-redacted-plan-message',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call-exit-plan-redacted-mismatch',
          name: 'ExitPlanMode',
          input: { plan: '# Redacted plan\n\nPayload: data:image/png;base64,QUFBQQ==' },
        }],
      },
    }),
    userRecord(sessionId, repoRoot, {
      uuid: 'semantic-redacted-plan-result',
      parentUuid: 'semantic-redacted-plan-call',
      timestamp: '2026-08-03T09:00:21.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-exit-plan-redacted-mismatch',
          content: 'Returned a different source plan.',
          is_error: false,
        }],
      },
      toolUseResult: { plan: '# Redacted plan\n\nPayload: data:image/png;base64,QkJCQg==' },
    }),
    assistantRecord(sessionId, repoRoot, {
      uuid: 'semantic-surrogate-plan-call',
      parentUuid: 'semantic-redacted-plan-result',
      timestamp: '2026-08-03T09:00:22.000Z',
      message: {
        id: 'semantic-surrogate-plan-message',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call-exit-plan-surrogate-mismatch',
          name: 'ExitPlanMode',
          input: { plan: surrogateRequestPlan },
        }],
      },
    }),
    userRecord(sessionId, repoRoot, {
      uuid: 'semantic-surrogate-plan-result',
      parentUuid: 'semantic-surrogate-plan-call',
      timestamp: '2026-08-03T09:00:23.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-exit-plan-surrogate-mismatch',
          content: 'Returned a plan with a different UTF-16 code unit.',
          is_error: false,
        }],
      },
      toolUseResult: { plan: surrogateResultPlan },
    }),
  );
  await writeJsonl(
    path.join(container, `${sessionId}.jsonl`),
    records,
  );

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const background = session.logicalEvents.find((event) => event.callId === 'call-background');
  const agent = session.logicalEvents.find((event) => event.callId === 'call-agent');
  const plan = session.logicalEvents.find((event) => event.callId === 'call-exit-plan');
  const unconfirmedPlan = session.logicalEvents.find((event) => event.callId === 'call-exit-plan-noecho');
  const redactedMismatch = session.logicalEvents.find((event) => (
    event.callId === 'call-exit-plan-redacted-mismatch'
  ));
  const surrogateMismatch = session.logicalEvents.find((event) => (
    event.callId === 'call-exit-plan-surrogate-mismatch'
  ));
  const taskEvents = session.logicalEvents.filter((event) => (
    ['call-task-create', 'call-task-update'].includes(event.callId)
  ));
  const reminder = session.logicalEvents.find((event) => event.subtype === 'task_reminder');
  const novelReminder = session.logicalEvents.find((event) => event.kind === 'plan_update');
  const whitespaceRaw = session.rawEvents.find((raw) => raw.uuid === 'semantic-whitespace');

  assert.equal(background.kind, 'command');
  assert.equal(background.status, 'success');
  assert.equal(background.label, 'Background command');
  assert.equal(background.lifecycle.phase, 'terminal');
  assert.equal(background.lifecycle.notifications.length, 1);
  assert.equal(background.lifecycle.terminal.exitCode, 0);
  assert.equal(background.rawRefs.length, 4, 'queue and trusted user duplicates remain traceable on one event');

  assert.equal(agent.kind, 'agent_coordination');
  assert.equal(agent.status, 'success');
  assert.equal(agent.lifecycle.taskId, 'agent-1');
  assert.deepEqual(
    agent.lifecycle.notifications.map((notification) => notification.status),
    ['failed', 'completed'],
  );
  assert.equal(agent.rawRefs.length, 5, 'all distinct stops and duplicate source rows remain traceable');
  assert.equal(
    session.logicalEvents.filter((event) => event.searchText.includes('Final findings retained.')).length,
    1,
  );
  const agentDetail = buildClaudeEventDetail(session, agent.id, 'main', { locale: 'en' });
  assert.match(JSON.stringify(agentDetail.timelineSections), /First stop retained/);
  assert.match(JSON.stringify(agentDetail.timelineSections), /Final findings retained/);
  assert.match(
    JSON.stringify(buildClaudeEventDetail(session, agent.id, 'main', { locale: 'zh-CN' }).timelineSections),
    /异步 Agent 已启动/,
  );

  assert.equal(plan.kind, 'proposed_plan');
  assert.equal(plan.subtype, 'proposed_plan');
  assert.equal(plan.toolName, '');
  assert.equal(plan.sourceToolName, 'ExitPlanMode');
  assert.equal(plan.rawRefs.length, 3);
  assert.equal(
    buildClaudeEventDetail(session, plan.id, 'main', { locale: 'zh-CN' }).timelineSections[0]?.title,
    '提议计划',
  );
  assert.equal(unconfirmedPlan.kind, 'other_tool_call');
  assert.equal(unconfirmedPlan.toolName, 'ExitPlanMode');
  assert.equal(unconfirmedPlan.rawRefs.length, 3);
  assert.equal(redactedMismatch.kind, 'other_tool_call');
  assert.equal(redactedMismatch.toolName, 'ExitPlanMode');
  const redactedCallRaw = session.rawEvents.find((raw) => raw.uuid === 'semantic-redacted-plan-call');
  const redactedResultRaw = session.rawEvents.find((raw) => raw.uuid === 'semantic-redacted-plan-result');
  assert.equal(
    redactedCallRaw.toolCalls[0].input.plan,
    redactedResultRaw.toolUseResult.plan,
    'the indexed plans intentionally collide after data URL redaction',
  );
  assert.equal(JSON.stringify(redactedCallRaw).includes('_exactPlanEvidence'), false);
  assert.equal(surrogateMismatch.kind, 'other_tool_call');
  assert.equal(surrogateMismatch.toolName, 'ExitPlanMode');
  assert.notEqual(surrogateRequestPlan, surrogateResultPlan);
  assert.equal(
    Buffer.from(surrogateRequestPlan, 'utf8').equals(Buffer.from(surrogateResultPlan, 'utf8')),
    true,
    'the source plans intentionally collide under UTF-8 replacement encoding',
  );
  assert.equal(session.counts.planArtifacts, 1);
  assert.equal(session.counts.planEvents, 4);
  assert.deepEqual(taskEvents.map((event) => event.kind), ['other_tool_call', 'other_tool_call']);
  assert.ok(taskEvents.every((event) => event.label === 'Plan update'));
  assert.ok(taskEvents.every((event) => (
    buildClaudeEventDetail(session, event.id, 'main', { locale: 'en' }).timelineSections[0]?.type === 'plan_update'
  )));
  assert.match(
    JSON.stringify(buildClaudeEventDetail(session, taskEvents[1].id, 'main', { locale: 'zh-CN' }).timelineSections),
    /任务 #1：pending → completed/,
  );
  assert.equal(reminder.layer, 'protocol');
  assert.equal(reminder.rawRefs.length, 2, 'repeated identical snapshots form one Protocol event');
  assert.equal(session.logicalEvents.filter((event) => event.kind === 'plan_update').length, 1);
  assert.equal(novelReminder.planSnapshot.length, 2);
  assert.match(novelReminder.searchText, /Verify unseen follow-up/);
  assert.equal(
    buildClaudeEventDetail(session, novelReminder.id, 'main', { locale: 'en' }).timelineSections[0]?.type,
    'plan_update',
  );
  assert.equal(
    session.counts.planEvents - session.counts.planArtifacts - taskEvents.length,
    1,
    'only the snapshot state not accounted for by Task transitions contributes another Plan Update',
  );

  assert.equal(agent.provider, 'Novita');
  assert.equal(agent.model, 'inclusionai/ling-3.0-flash:free');
  assert.equal(agent.effort, 'xhigh');
  assert.equal(agentDetail.meta.provider, 'Novita');
  assert.equal(agentDetail.meta.model, 'inclusionai/ling-3.0-flash:free');
  assert.equal(agentDetail.meta.effort, 'xhigh');
  assert.ok(session.logicalEvents.some((event) => event.subtype === 'plan_mode'));
  const away = session.logicalEvents.find((event) => event.subtype === 'away_summary');
  const awayDetail = buildClaudeEventDetail(session, away.id, 'protocol', { locale: 'en' });
  assert.match(JSON.stringify(awayDetail.timelineSections), /Lifecycle work completed/);
  assert.ok(!session.logicalEvents.some((event) => (
    event.rawRefs.some((ref) => ref.rawId === whitespaceRaw.rawId)
  )), 'whitespace-only Assistant text is ignored instead of becoming Protocol noise');
});

test('Claude local command envelopes stay in Protocol instead of becoming human messages', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = 'acacacac-acac-4cac-8cac-acacacacacac';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      message: {
        role: 'user',
        content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>',
      },
      uuid: 'local-command-request',
      timestamp: '2026-07-31T10:30:00.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'local-command-request',
      message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' },
      uuid: 'local-command-output',
      timestamp: '2026-07-31T10:30:01.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'local-command-output',
      message: { role: 'user', content: 'Continue the actual task' },
      uuid: 'human-user',
      timestamp: '2026-07-31T10:30:02.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const main = session.logicalEvents.filter((event) => event.layer === 'main');
  const protocol = session.logicalEvents.filter((event) => event.layer === 'protocol');
  assert.deepEqual(main.map((event) => event.searchText), ['Continue the actual task']);
  assert.equal(protocol.length, 2);
  assert.ok(protocol.every((event) => event.kind === 'protocol'));
  assert.equal(session.counts.userMessages, 1);
  assert.equal(session.title, 'Continue the actual task');
});

test('Claude sessions work with shared timeline, detail, and indexed raw-record APIs', async (t) => {
  const fixture = await buildRichClaudeFixture(t);
  const index = await buildClaudeIndex({
    repoRoot: fixture.repoRoot,
    claudeHome: fixture.claudeHome,
  });
  const session = index.sessionsById.get(analyzerSessionId(fixture.sessionId));
  const timeline = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    layer: 'main',
    q: '',
    kind: '',
    status: '',
    tool: '',
    codeModeRequest: '',
    file: '',
    locale: 'en',
  });
  const command = timeline.events.find((event) => event.kind === 'command');
  assert.equal(command.sourceKind, 'claude-code');
  assert.equal(command.sourceLocator.type, 'jsonl_line');
  assert.ok(command.rawRefs.every((ref) => ref.rawId));

  const detail = buildClaudeEventDetail(session, command.id, 'main', { locale: 'en' });
  assert.equal(detail.sourceKind, 'claude-code');
  assert.ok(detail.timelineSections.some((section) => section.type === 'code'));
  assert.ok(detail.inspectorSections.some((section) => section.type === 'raw_json'));

  const agentEvent = session.logicalEvents.find((event) => event.callId === 'call-agent');
  const compactionEvent = session.logicalEvents.find((event) => event.kind === 'compaction');
  const agentCallRaw = session.rawEvents.find((raw) => (
    raw.toolCalls?.some((call) => call.id === 'call-agent')
  ));
  const agentResultRaw = session.rawEvents.find((raw) => (
    raw.toolResults?.some((result) => result.id === 'call-agent')
  ));
  assert.ok(agentEvent);
  assert.ok(compactionEvent);
  assert.ok(agentCallRaw);
  assert.ok(agentResultRaw);

  const agentDetailZh = buildClaudeEventDetail(session, agentEvent.id, 'main', { locale: 'zh-CN' });
  assert.deepEqual(
    agentDetailZh.timelineSections.map((section) => section.title),
    ['请求', '启动结果', '生命周期', '生命周期数据'],
  );
  const compactionDetailZh = buildClaudeEventDetail(session, compactionEvent.id, 'main', { locale: 'zh-CN' });
  assert.deepEqual(
    compactionDetailZh.timelineSections.map((section) => section.title),
    ['压缩元数据', '压缩摘要'],
  );
  const agentCallDetailZh = buildClaudeEventDetail(session, agentCallRaw.rawId, 'raw', { locale: 'zh-CN' });
  assert.ok(agentCallDetailZh.timelineSections.some((section) => section.title === 'Agent 请求'));
  const agentResultDetailZh = buildClaudeEventDetail(session, agentResultRaw.rawId, 'raw', { locale: 'zh-CN' });
  assert.ok(agentResultDetailZh.timelineSections.some((section) => section.title === '工具结果'));
  assert.ok(agentResultDetailZh.timelineSections.some((section) => section.title === '结构化结果'));

  const server = createServer(index, 1, {
    source: 'claude-code',
    claudeHome: fixture.claudeHome,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.sourceKind, 'claude-code');
    assert.equal(state.sourceHome, path.resolve(fixture.claudeHome));

    const rawRef = command.rawRefs[0];
    const rawResponse = await fetch(
      `${base}/api/sessions/${encodeURIComponent(session.id)}/raw/${encodeURIComponent(rawRef.rawId)}`,
    );
    assert.equal(rawResponse.status, 200);
    const raw = await rawResponse.json();
    assert.equal(raw.rawId, rawRef.rawId);
    assert.equal(raw.sourceKind, 'claude-code');
    assert.equal(raw.parsed.type, 'assistant');

    const detailResponse = await fetch(
      `${base}/api/sessions/${encodeURIComponent(session.id)}/events/${encodeURIComponent(command.id)}/detail?layer=main`,
    );
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).sourceKind, 'claude-code');

    const arbitraryLegacyRead = await fetch(`${base}/api/raw?file=..%2Foutside.jsonl&line=1`);
    assert.equal(arbitraryLegacyRead.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Claude detail localizes adapter-generated file change fallback copy', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-localized-detail');
  const sessionId = '10101010-1010-4010-8010-101010101010';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    assistantRecord(sessionId, repoRoot, {
      parentUuid: null,
      message: {
        id: 'localized-write-message',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'tool_use',
          id: 'localized-write-call',
          name: 'Write',
          input: { file_path: 'Command', content: 'done' },
        }],
      },
      uuid: 'localized-write-assistant',
      timestamp: '2026-08-01T00:30:00.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'localized-write-assistant',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'localized-write-call',
          content: '',
          is_error: false,
        }],
      },
      uuid: 'localized-write-result',
      timestamp: '2026-08-01T00:30:01.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const patchEvent = session.logicalEvents.find((event) => event.kind === 'patch');
  assert.ok(patchEvent);
  const detail = buildClaudeEventDetail(session, patchEvent.id, 'main', { locale: 'zh-CN' });
  assert.equal(detail.timelineSections.find((section) => section.type === 'code')?.title, 'Command');
  const result = detail.timelineSections.find((section) => section.title === '结果');
  assert.ok(result);
  assert.equal(result.text, '文件改动已完成。');
});

test('Claude unknown tool labels stay canonical when source names collide with localized UI copy', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-source-owned-tool-names');
  const sessionId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      promptId: 'source-owned-tool-prompt',
      message: { role: 'user', content: 'Run source-owned tools.' },
      uuid: 'source-owned-tool-user',
      timestamp: '2026-08-01T00:45:00.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'source-owned-tool-user',
      message: {
        id: 'source-owned-tool-calls',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [
          { type: 'tool_use', id: 'call-source-result', name: 'Result', input: { value: 'one' } },
          { type: 'tool_use', id: 'call-source-command', name: 'Command', input: { value: 'two' } },
        ],
      },
      uuid: 'source-owned-tool-assistant',
      timestamp: '2026-08-01T00:45:01.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'source-owned-tool-assistant',
      promptId: 'source-owned-tool-prompt',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-source-result', content: 'first result' },
          { type: 'tool_result', tool_use_id: 'call-source-command', content: 'second result' },
        ],
      },
      uuid: 'source-owned-tool-results',
      timestamp: '2026-08-01T00:45:02.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const toolEvents = session.logicalEvents.filter((event) => event.kind === 'other_tool_call');
  assert.deepEqual(toolEvents.map((event) => event.toolName), ['Result', 'Command']);
  for (const event of toolEvents) {
    assert.equal(event.label, 'Other tool call');
    assert.equal(event.subtype, event.toolName);
    assert.match(event.searchText, new RegExp(`^${event.toolName}\\b`));
    const detail = buildClaudeEventDetail(session, event.id, 'main', { locale: 'zh-CN' });
    assert.equal(detail.title, '其他工具调用');
    assert.equal(detail.meta.toolName, event.toolName);
    assert.equal(detail.subtype, event.toolName);
  }
});

test('Claude detail sanitizes inline payloads and keeps exact source only in indexed Raw readback', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-detail-sanitizer');
  const sessionId = 'abababab-abab-4bab-8bab-abababababab';
  const messageDataUrl = 'data:image/png;base64,message-image-secret';
  const requestDataUrl = 'data:application/octet-stream;base64,request-payload-secret';
  const resultDataUrl = 'data:text/plain,result-payload-secret';
  const structuredDataUrl = 'data:image/jpeg;base64,structured-image-secret';
  const base64WithProse = 'data:text/plain;base64,AAAA after searchable words';
  const nativeBase64Payload = Buffer.from('native-image-secret'.repeat(4_000)).toString('base64');
  const largePayload = `ordinary-large-prefix-${'x'.repeat(160_000)}-large-tail-secret`;
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      promptId: 'prompt-detail-sanitizer',
      message: {
        role: 'user',
        content: `ordinary message before ${messageDataUrl} ordinary message after ${base64WithProse}`,
      },
      uuid: 'detail-user',
      timestamp: '2026-08-01T01:00:00.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'detail-user',
      message: {
        id: 'detail-tool-call',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'tool_use',
          id: 'call-detail-sanitizer',
          name: 'Read',
          input: {
            path: 'README.md',
            ordinaryRequest: 'ordinary request survives',
            inlinePayload: requestDataUrl,
            largePayload,
          },
        }],
      },
      uuid: 'detail-tool-call-row',
      timestamp: '2026-08-01T01:00:01.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'detail-tool-call-row',
      promptId: 'prompt-detail-sanitizer',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call-detail-sanitizer',
          content: `ordinary tool result ${resultDataUrl} result tail`,
          is_error: false,
        }],
      },
      toolUseResult: {
        stdout: 'ordinary stdout survives',
        structured: {
          ordinaryResult: 'ordinary structured result survives',
          inlinePayload: structuredDataUrl,
          largePayload,
        },
      },
      uuid: 'detail-tool-result',
      timestamp: '2026-08-01T01:00:02.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'detail-tool-result',
      message: {
        id: 'detail-native-image',
        role: 'assistant',
        model: 'claude-opus-test',
        content: [{
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: nativeBase64Payload,
          },
        }],
      },
      uuid: 'detail-native-image-row',
      timestamp: '2026-08-01T01:00:03.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const message = session.logicalEvents.find((event) => event.kind === 'user_message');
  const tool = session.logicalEvents.find((event) => event.callId === 'call-detail-sanitizer');
  const callRaw = session.rawEvents.find((raw) => raw.callId === 'call-detail-sanitizer');
  const imageRaw = session.rawEvents.find((raw) => raw.uuid === 'detail-native-image-row');
  const imageEvent = session.logicalEvents.find((event) => (
    event.layer === 'protocol' && event.rawRefs.some((ref) => ref.rawId === imageRaw?.rawId)
  ));
  assert.ok(message);
  assert.ok(tool);
  assert.ok(callRaw);
  assert.ok(imageRaw);
  assert.ok(imageEvent);

  assert.equal(
    imageRaw.parsed.message.content[0].source.data,
    '[embedded base64 payload omitted; see raw refs]',
  );
  assert.doesNotMatch(JSON.stringify(imageRaw), new RegExp(nativeBase64Payload.slice(0, 100)));
  assert.match(imageEvent.searchText, /embedded base64 payload omitted; see raw refs/);

  const messageDetail = buildClaudeEventDetail(session, message.id, 'main');
  const toolDetail = buildClaudeEventDetail(session, tool.id, 'main');
  const rawDetail = buildClaudeEventDetail(session, callRaw.rawId, 'raw');
  const imageDetail = buildClaudeEventDetail(session, imageEvent.id, 'protocol');
  const imageRawDetail = buildClaudeEventDetail(session, imageRaw.rawId, 'raw');
  const renderedDetails = JSON.stringify([messageDetail, toolDetail, rawDetail, imageDetail, imageRawDetail]);

  assert.doesNotMatch(renderedDetails, /data:(?:image|application|text)\//i);
  assert.doesNotMatch(renderedDetails, /message-image-secret|request-payload-secret|result-payload-secret|structured-image-secret/);
  assert.equal(renderedDetails.includes(nativeBase64Payload.slice(0, 100)), false);
  assert.match(renderedDetails, /embedded data URL omitted; see raw refs/);
  assert.match(renderedDetails, /embedded base64 payload omitted; see raw refs/);
  assert.match(renderedDetails, /ordinary message before/);
  assert.match(message.searchText, /after searchable words/);
  assert.match(JSON.stringify(messageDetail), /after searchable words/);
  assert.match(renderedDetails, /ordinary request survives/);
  assert.match(renderedDetails, /ordinary tool result/);
  assert.match(renderedDetails, /ordinary structured result survives/);
  assert.doesNotMatch(JSON.stringify(toolDetail), /large-tail-secret/);
  assert.match(JSON.stringify(toolDetail), /large detail value omitted; see raw refs/);
  assert.ok(JSON.stringify(toolDetail).length < 150_000, 'logical detail should keep a fixed output budget');

  const preservedSearch = getTimeline(index, session.id, {
    offset: 0,
    limit: 100,
    layer: 'main',
    q: 'searchable words',
  });
  assert.ok(preservedSearch.events.some((event) => event.id === message.id && event.hasSearchHit));

  const server = createServer(index, 1, {
    source: 'claude-code',
    claudeHome,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(
      `${base}/api/sessions/${encodeURIComponent(session.id)}/raw/${encodeURIComponent(callRaw.rawId)}`,
    );
    assert.equal(response.status, 200);
    const raw = await response.json();
    assert.equal(raw.parsed.message.content[0].input.inlinePayload, requestDataUrl);
    assert.equal(raw.parsed.message.content[0].input.largePayload, largePayload);
    const imageResponse = await fetch(
      `${base}/api/sessions/${encodeURIComponent(session.id)}/raw/${encodeURIComponent(imageRaw.rawId)}`,
    );
    assert.equal(imageResponse.status, 200);
    const exactImageRaw = await imageResponse.json();
    assert.equal(exactImageRaw.parsed.message.content[0].source.data, nativeBase64Payload);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Claude fork inference requires foreign source identity and shared UUID lineage', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = '22222222-2222-4222-8222-222222222222';
  const forkId = '33333333-3333-4333-8333-333333333333';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    userRecord(parentId, repoRoot, {
      parentUuid: null,
      promptId: 'parent-prompt',
      message: { role: 'user', content: 'Original task' },
      uuid: 'shared-source-uuid',
      timestamp: '2026-07-31T11:00:00.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${forkId}.jsonl`), [
    {
      ...userRecord(forkId, repoRoot, {
        parentUuid: null,
        promptId: 'fork-prompt',
        message: { role: 'user', content: 'Original task' },
        uuid: 'shared-source-uuid',
        timestamp: '2026-07-31T11:00:01.000Z',
      }),
      session_id: parentId,
    },
    baseRecord(forkId, repoRoot, {
      parentUuid: 'shared-source-uuid',
      type: 'ai-title',
      aiTitle: 'Original task ⑂',
      uuid: 'fork-title',
      timestamp: '2026-07-31T11:00:02.000Z',
      session_id: parentId,
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const fork = index.sessionsById.get(analyzerSessionId(forkId));
  assert.equal(fork.forkedFromSessionId, analyzerSessionId(parentId));
  assert.equal(fork.forkStorageMode, 'materialized');
});

test('Claude pointer fork uses exact parent command evidence and keeps inherited context parent-owned', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = '55555555-5555-4555-8555-555555555555';
  const childId = '66666666-6666-4666-8666-666666666666';
  const titleOnlyId = '77777777-7777-4777-8777-777777777777';
  await fsp.mkdir(repoRoot, { recursive: true });

  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    userRecord(parentId, repoRoot, {
      parentUuid: null,
      promptId: 'parent-prompt',
      message: { role: 'user', content: 'Inherited task' },
      uuid: 'parent-user',
      timestamp: '2026-07-31T12:00:00.000Z',
    }),
    assistantRecord(parentId, repoRoot, {
      parentUuid: 'parent-user',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Inherited answer' }] },
      uuid: 'parent-assistant',
      timestamp: '2026-07-31T12:00:01.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'parent-assistant',
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>\n<command-message>fork</command-message>\n<command-args></command-args>',
      uuid: 'fork-command',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'fork-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Pointer fixture ⑂ · 66666666</local-command-stdout>',
      uuid: 'fork-output',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    userRecord(parentId, repoRoot, {
      parentUuid: 'fork-output',
      promptId: 'parent-after-fork',
      message: { role: 'user', content: 'Parent-only continuation' },
      uuid: 'parent-after-fork',
      timestamp: '2026-07-31T12:00:03.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Pointer fixture ⑂', sessionId: childId },
    { type: 'agent-name', agentName: 'Pointer fixture ⑂', sessionId: childId },
  ]);
  await writeJsonl(path.join(container, `${titleOnlyId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Looks forked but has no command evidence ⑂', sessionId: titleOnlyId },
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const parent = index.sessionsById.get(analyzerSessionId(parentId));
  const child = index.sessionsById.get(analyzerSessionId(childId));
  const titleOnly = index.sessionsById.get(analyzerSessionId(titleOnlyId));

  assert.equal(child.forkedFromSessionId, parent.id);
  assert.equal(child.forkStorageMode, 'pointer');
  assert.equal(child.forkContinuationState, 'waiting_for_prompt');
  assert.equal(child.forkedAt, '2026-07-31T12:00:02.000Z');
  assert.equal(child.forkPointUuid, 'parent-assistant');
  assert.equal(child.startedAt, child.forkedAt);
  assert.equal(child.updatedAt, child.forkedAt);
  assert.equal(child.projectAssociation, 'parent-inherited');
  assert.deepEqual([...child.cwdSet], [...parent.cwdSet]);
  assert.equal(child.rawEvents.length, 2);
  assert.equal(child.logicalEvents.filter((event) => event.layer === 'main').length, 0);
  assert.equal(child.counts.messages, 0);
  assert.deepEqual(child.forkEvidence, {
    ownerSessionId: parent.id,
    command: '/fork',
    commandRawId: `${parent.id}:raw:3`,
    outputRawId: `${parent.id}:raw:4`,
  });
  assert.equal(child.inheritedContext.ownerSessionId, parent.id);
  assert.equal(child.inheritedContext.rawRecordCount, 2);
  assert.equal(child.inheritedContext.mainEventCount, 2);
  assert.equal(child.inheritedContext.protocolEventCount, 0);
  assert.deepEqual(
    child.inheritedContext.previewEvents.map((event) => event.preview),
    ['Inherited task', 'Inherited answer'],
  );
  const expectedForkPointEventId = child.inheritedContext.previewEvents.at(-1).parentEventId;
  const parentMainEvents = parent.logicalEvents.filter((event) => event.layer !== 'protocol');
  assert.deepEqual(child.inheritedContext.forkPointTarget, {
    layer: 'main',
    eventId: expectedForkPointEventId,
    timelineIndex: parentMainEvents.findIndex((event) => event.id === expectedForkPointEventId),
  });
  assert.doesNotMatch(
    child.inheritedContext.previewEvents.map((event) => event.preview).join('\n'),
    /Parent-only continuation/,
  );
  assert.equal(titleOnly.forkedFromSessionId, '');
  assert.equal(titleOnly.forkStorageMode, '');

  const childTimeline = getTimeline(index, child.id, {
    layer: 'main',
    offset: 0,
    limit: 100,
    q: 'Inherited task',
    kind: '',
    status: '',
    tool: '',
    file: '',
    locale: 'en',
  });
  assert.equal(childTimeline.total, 0, 'inherited previews must not enter child search or metrics');
  assert.equal(childTimeline.session.inheritedContext.mainEventCount, 2);
  assert.equal(childTimeline.session.inheritedContext.ownerSessionId, parent.id);
  assert.equal(childTimeline.session.rawEventCount, 2);
});

test('Claude pointer fork navigation falls back to the exact parent Raw Record without readable Main ancestry', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = '12121212-1212-4212-8212-121212121212';
  const childId = '34343434-3434-4434-8434-343434343434';
  await fsp.mkdir(repoRoot, { recursive: true });

  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    baseRecord(parentId, repoRoot, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: null,
      content: '<command-name>/status</command-name>',
      uuid: 'protocol-only-anchor',
      timestamp: '2026-07-31T13:00:00.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'protocol-only-anchor',
      content: '<command-name>/fork</command-name>',
      uuid: 'raw-fallback-fork-command',
      timestamp: '2026-07-31T13:00:01.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'raw-fallback-fork-command',
      content: '<local-command-stdout>session waiting for a prompt · Raw fallback pointer ⑂ · 34343434</local-command-stdout>',
      uuid: 'raw-fallback-fork-output',
      timestamp: '2026-07-31T13:00:01.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Raw fallback pointer ⑂', sessionId: childId },
    { type: 'agent-name', agentName: 'Raw fallback pointer ⑂', sessionId: childId },
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const parent = index.sessionsById.get(analyzerSessionId(parentId));
  const child = index.sessionsById.get(analyzerSessionId(childId));
  assert.equal(child.forkStorageMode, 'pointer');
  assert.equal(child.inheritedContext.mainEventCount, 0);
  assert.deepEqual(child.inheritedContext.forkPointTarget, {
    layer: 'raw',
    eventId: parent.rawEvents[0].rawId,
    timelineIndex: 0,
  });
});

test('Claude pointer fork fails closed when the output prefix is ambiguous in one container', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const parentId = '88888888-8888-4888-8888-888888888888';
  const firstChildId = '99999999-1111-4999-8999-999999999999';
  const secondChildId = '99999999-2222-4999-8999-999999999999';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    userRecord(parentId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Parent task' },
      uuid: 'ambiguous-parent-user',
      timestamp: '2026-07-31T13:00:00.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'ambiguous-parent-user',
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>',
      uuid: 'ambiguous-fork-command',
      timestamp: '2026-07-31T13:00:01.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'ambiguous-fork-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Ambiguous · 99999999</local-command-stdout>',
      uuid: 'ambiguous-fork-output',
      timestamp: '2026-07-31T13:00:01.000Z',
    }),
  ]);
  for (const childId of [firstChildId, secondChildId]) {
    await writeJsonl(path.join(container, `${childId}.jsonl`), [
      { type: 'ai-title', aiTitle: 'Ambiguous ⑂', sessionId: childId },
    ]);
  }

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  assert.equal(index.sessionsById.get(analyzerSessionId(firstChildId)).forkedFromSessionId, '');
  assert.equal(index.sessionsById.get(analyzerSessionId(secondChildId)).forkedFromSessionId, '');
});

test('Claude pointer fork rejects missing, unresolved, duplicate, and cyclic fork-point ancestry', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const otherRoot = path.join(claudeHome, 'other-repo');
  const container = path.join(claudeHome, 'projects', '-invalid-fork-points');
  const parentId = '81818181-8181-4181-8181-818181818181';
  const outsideId = '82828282-8282-4282-8282-828282828282';
  const childIds = [
    '11111111-aaaa-4111-8111-111111111111',
    '22222222-bbbb-4222-8222-222222222222',
    '33333333-cccc-4333-8333-333333333333',
    '44444444-dddd-4444-8444-444444444444',
  ];
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(otherRoot, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    userRecord(parentId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Parent with invalid fork evidence' },
      uuid: 'invalid-fork-root',
      timestamp: '2026-08-01T03:20:00.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: null,
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>',
      uuid: 'missing-point-command',
      timestamp: '2026-08-01T03:20:01.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'missing-point-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Missing point · 11111111</local-command-stdout>',
      uuid: 'missing-point-output',
      timestamp: '2026-08-01T03:20:01.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'unresolved-point',
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>',
      uuid: 'unresolved-point-command',
      timestamp: '2026-08-01T03:20:02.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'unresolved-point-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Unresolved point · 22222222</local-command-stdout>',
      uuid: 'unresolved-point-output',
      timestamp: '2026-08-01T03:20:02.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'invalid-fork-root',
      type: 'mode',
      uuid: 'duplicate-point',
      timestamp: '2026-08-01T03:20:03.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'invalid-fork-root',
      type: 'mode',
      uuid: 'duplicate-point',
      timestamp: '2026-08-01T03:20:03.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'duplicate-point',
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>',
      uuid: 'duplicate-point-command',
      timestamp: '2026-08-01T03:20:04.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'duplicate-point-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Duplicate point · 33333333</local-command-stdout>',
      uuid: 'duplicate-point-output',
      timestamp: '2026-08-01T03:20:04.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'cycle-point-b',
      type: 'mode',
      uuid: 'cycle-point-a',
      timestamp: '2026-08-01T03:20:05.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'cycle-point-a',
      type: 'mode',
      uuid: 'cycle-point-b',
      timestamp: '2026-08-01T03:20:05.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'cycle-point-a',
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>',
      uuid: 'cycle-point-command',
      timestamp: '2026-08-01T03:20:06.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'cycle-point-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Cyclic point · 44444444</local-command-stdout>',
      uuid: 'cycle-point-output',
      timestamp: '2026-08-01T03:20:06.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${outsideId}.jsonl`), [
    userRecord(outsideId, otherRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Outside project establishes an ambiguous cwd cluster.' },
      uuid: 'invalid-fork-outside',
      timestamp: '2026-08-01T03:20:07.000Z',
    }),
  ]);
  for (const childId of childIds) {
    await writeJsonl(path.join(container, `${childId}.jsonl`), [
      { type: 'ai-title', aiTitle: 'Must remain provisional ⑂', sessionId: childId },
    ]);
  }

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  assert.deepEqual(index.sessions.map((session) => session.sourceSessionId), [parentId]);
  for (const childId of childIds) {
    assert.equal(index.sessionsById.has(analyzerSessionId(childId)), false);
  }
  assert.equal(index.totals.fileCount, 6);
  assert.equal(index.totals.candidateFileCount, 1);
  assert.equal(index.totals.skippedFileCount, 1);
  assert.equal(index.totals.unknownFileCount, 4);
  assert.equal(index.totals.sessionCount, 1);
});

test('Claude pointer evidence promotes a provisional metadata child when container cwd inference is ambiguous', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const otherRoot = path.join(claudeHome, 'other-repo');
  const container = path.join(claudeHome, 'projects', '-mixed-cwd-fixture');
  const parentId = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
  const childId = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';
  const outsideId = 'cccccccc-3333-4ccc-8ccc-cccccccccccc';
  const orphanId = 'dddddddd-4444-4ddd-8ddd-dddddddddddd';
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(otherRoot, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), [
    userRecord(parentId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Selected parent' },
      uuid: 'selected-parent-user',
      timestamp: '2026-07-31T14:00:00.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'selected-parent-user',
      type: 'system',
      subtype: 'local_command',
      content: '<command-name>/fork</command-name>',
      uuid: 'selected-fork-command',
      timestamp: '2026-07-31T14:00:01.000Z',
    }),
    baseRecord(parentId, repoRoot, {
      parentUuid: 'selected-fork-command',
      type: 'system',
      subtype: 'local_command',
      content: '<local-command-stdout>session waiting for a prompt · Provisional · bbbbbbbb</local-command-stdout>',
      uuid: 'selected-fork-output',
      timestamp: '2026-07-31T14:00:01.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${outsideId}.jsonl`), [
    userRecord(outsideId, otherRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Outside project' },
      uuid: 'outside-user',
      timestamp: '2026-07-31T14:00:02.000Z',
    }),
  ]);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Provisional ⑂', sessionId: childId },
  ]);
  await writeJsonl(path.join(container, `${orphanId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Unrelated metadata', sessionId: orphanId },
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const child = index.sessionsById.get(analyzerSessionId(childId));
  assert.ok(child);
  assert.equal(child.forkedFromSessionId, analyzerSessionId(parentId));
  assert.equal(child.projectAssociation, 'parent-inherited');
  assert.equal(index.sessionsById.has(analyzerSessionId(outsideId)), false);
  assert.equal(index.sessionsById.has(analyzerSessionId(orphanId)), false);
  const { indexedBytes, candidateBytes, ...countTotals } = index.totals;
  assert.deepEqual(countTotals, {
    fileCount: 4,
    candidateFileCount: 2,
    indexedFileCount: 2,
    reusedFileCount: 0,
    skippedFileCount: 1,
    unknownFileCount: 1,
    sessionCount: 2,
    eventCount: 4,
    rawEventCount: 4,
  });
  assert.ok(indexedBytes > 0);
  assert.equal(candidateBytes, indexedBytes);
});

test('Claude keeps legal non-object JSONL values as unknown Raw/Protocol rows and ignores unsafe cwd values', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = '12121212-1212-4121-8121-121212121212';
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(container, { recursive: true });

  const records = [
    null,
    [],
    'legal JSON string',
    42,
    true,
    baseRecord(sessionId, 'relative-cwd', { type: 'mode' }),
    baseRecord(sessionId, '', { type: 'mode' }),
    baseRecord(sessionId, ['not', 'a', 'path'], { type: 'mode' }),
    baseRecord(sessionId, null, { type: 'mode' }),
    baseRecord(sessionId, repoRoot, { type: 'mode', uuid: 'absolute-cwd' }),
  ];
  await writeJsonl(file, records);

  const projects = await discoverClaudeProjects({ claudeHome });
  assert.deepEqual(projects.map((project) => project.repoRoot), [path.resolve(repoRoot)]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  assert.ok(session);
  assert.deepEqual([...session.cwdSet], [path.resolve(repoRoot)]);
  assert.equal(session.rawEvents.length, records.length);
  assert.deepEqual(
    session.rawEvents.slice(0, 5).map((raw) => raw.parsed),
    records.slice(0, 5),
  );
  assert.ok(session.rawEvents.slice(0, 5).every((raw) => raw.recordType === 'unknown'));
  assert.ok(session.rawEvents.slice(0, 5).every((raw) => raw.payloadType === 'unknown'));
  assert.equal(session.rawEvents[0].preview, 'null');
  const nullDetail = buildClaudeEventDetail(session, session.rawEvents[0].rawId, 'raw', { locale: 'en' });
  assert.equal(nullDetail.inspectorSections[0].value, null);
  assert.ok(session.logicalEvents.slice(0, 5).every((event) => (
    event.layer === 'protocol' && event.kind === 'protocol' && event.subtype === 'unknown'
  )));
});

test('Claude keeps unknown Assistant blocks searchable in Protocol alongside modeled blocks', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-unknown-assistant-blocks');
  const sessionId = '61616161-6161-4161-8161-616161616161';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Exercise future Assistant blocks.' },
      uuid: 'unknown-block-user',
      timestamp: '2026-08-01T03:00:00.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'unknown-block-user',
      message: {
        id: 'unknown-block-mixed-response',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Modeled Assistant text remains Main.' },
          { type: 'future_block', evidence: 'mixed future evidence remains searchable' },
        ],
      },
      uuid: 'unknown-block-mixed',
      timestamp: '2026-08-01T03:00:01.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'unknown-block-mixed',
      message: {
        id: 'unknown-block-only-response',
        role: 'assistant',
        content: [{ type: 'future_only', payload: { needle: 'future-only protocol evidence' } }],
      },
      uuid: 'unknown-block-only',
      timestamp: '2026-08-01T03:00:02.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'unknown-block-only',
      message: { id: 'unknown-block-empty-response', role: 'assistant', content: [] },
      uuid: 'unknown-block-empty',
      timestamp: '2026-08-01T03:00:03.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const assistantMessages = session.logicalEvents.filter((event) => event.kind === 'assistant_message');
  const protocol = session.logicalEvents.filter((event) => event.layer === 'protocol');
  assert.equal(assistantMessages.length, 1);
  assert.match(assistantMessages[0].searchText, /Modeled Assistant text remains Main/);
  assert.ok(protocol.some((event) => (
    event.subtype === 'assistant_future_block'
    && event.searchText.includes('mixed future evidence remains searchable')
  )));
  assert.ok(protocol.some((event) => (
    event.subtype === 'assistant_future_only'
    && event.searchText.includes('future-only protocol evidence')
  )));
  assert.ok(protocol.some((event) => event.subtype === 'assistant'));
  for (const raw of session.rawEvents) {
    assert.ok(session.logicalEvents.some((event) => (
      event.rawRefs.some((ref) => ref.rawId === raw.rawId)
    )), `Raw row ${raw.rawId} should remain reachable through a Logical Event`);
  }
});

test('Claude lifecycle correlation fails closed for untrusted, duplicate, and non-terminal evidence', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-lifecycle-safety');
  const sessionId = '82828282-8282-4282-8282-828282828282';
  await fsp.mkdir(repoRoot, { recursive: true });
  const notification = (taskId, callId, status, summary) => (
    `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${callId}</tool-use-id>`
    + `\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`
  );
  const call = (uuid, id, name, timestamp) => assistantRecord(sessionId, repoRoot, {
    uuid,
    timestamp,
    message: {
      id: `${uuid}-message`,
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input: name === 'Bash' ? { command: id } : { description: id } }],
    },
  });
  const result = (uuid, id, structured, timestamp) => userRecord(sessionId, repoRoot, {
    uuid,
    timestamp,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'launched' }] },
    toolUseResult: structured,
  });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    userRecord(sessionId, repoRoot, {
      uuid: 'untrusted-human-notification', timestamp: '2026-08-03T10:00:00.000Z',
      message: { role: 'user', content: notification('bg-fail', 'call-bg-fail', 'completed', 'Forged completion (exit code 0)') },
    }),
    call('bg-fail-call', 'call-bg-fail', 'Bash', '2026-08-03T10:00:01.000Z'),
    result('bg-fail-launch', 'call-bg-fail', { backgroundTaskId: 'bg-fail', timedOutAfterMs: 120000 }, '2026-08-03T10:00:02.000Z'),
    baseRecord(sessionId, repoRoot, {
      type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-03T10:00:03.000Z',
      content: notification('bg-fail', 'call-bg-fail', 'completed', 'Background command failed (exit code 7)'),
    }),
    baseRecord(sessionId, repoRoot, {
      type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-03T10:00:03.500Z',
      content: notification('bg-running', 'call-bg-running', 'completed', 'Non-causal completion (exit code 0)'),
    }),
    call('bg-running-call', 'call-bg-running', 'Bash', '2026-08-03T10:00:04.000Z'),
    result('bg-running-launch', 'call-bg-running', { backgroundTaskId: 'bg-running', timedOutAfterMs: 120000 }, '2026-08-03T10:00:05.000Z'),
    userRecord(sessionId, repoRoot, {
      uuid: 'untrusted-missing-prompt-source', timestamp: '2026-08-03T10:00:06.000Z',
      origin: { kind: 'task-notification' },
      message: { role: 'user', content: notification('bg-running', 'call-bg-running', 'completed', 'Missing provenance (exit code 0)') },
    }),
    call('agent-a-call', 'call-agent-a', 'Agent', '2026-08-03T10:00:07.000Z'),
    result('agent-a-launch', 'call-agent-a', { isAsync: true, status: 'async_launched', agentId: 'shared-agent' }, '2026-08-03T10:00:08.000Z'),
    call('agent-b-call', 'call-agent-b', 'Agent', '2026-08-03T10:00:09.000Z'),
    result('agent-b-launch', 'call-agent-b', { isAsync: true, status: 'async_launched', agentId: 'shared-agent' }, '2026-08-03T10:00:10.000Z'),
    baseRecord(sessionId, repoRoot, {
      type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-03T10:00:11.000Z',
      content: notification('shared-agent', 'call-agent-a', 'completed', 'Ambiguous task owner'),
    }),
    call('duplicate-call-a', 'duplicate-background', 'Bash', '2026-08-03T10:00:12.000Z'),
    call('duplicate-call-b', 'duplicate-background', 'Bash', '2026-08-03T10:00:13.000Z'),
    result('duplicate-result', 'duplicate-background', { backgroundTaskId: 'duplicate-bg', timedOutAfterMs: 1000 }, '2026-08-03T10:00:14.000Z'),
    baseRecord(sessionId, repoRoot, {
      type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-03T10:00:15.000Z',
      content: notification('duplicate-bg', 'duplicate-background', 'completed', 'Ambiguous call owner (exit code 0)'),
    }),
    assistantRecord(sessionId, repoRoot, {
      uuid: 'multi-launch-calls',
      timestamp: '2026-08-03T10:00:16.000Z',
      message: {
        id: 'multi-launch-message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'multi-launch-a', name: 'Bash', input: { command: 'first' } },
          { type: 'tool_use', id: 'multi-launch-b', name: 'Bash', input: { command: 'second' } },
        ],
      },
    }),
    userRecord(sessionId, repoRoot, {
      uuid: 'multi-launch-results',
      timestamp: '2026-08-03T10:00:17.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'multi-launch-a', content: 'first result' },
          { type: 'tool_result', tool_use_id: 'multi-launch-b', content: 'second result' },
        ],
      },
      toolUseResult: {
        backgroundTaskId: 'ambiguous-background',
        timedOutAfterMs: 120000,
        interrupted: true,
        exitCode: 9,
        durationMs: 500,
      },
      toolDenialKind: 'ambiguous-denial',
    }),
    assistantRecord(sessionId, repoRoot, {
      uuid: 'multi-task-calls',
      timestamp: '2026-08-03T10:00:18.000Z',
      message: {
        id: 'multi-task-message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'multi-task-a',
            name: 'TaskUpdate',
            input: { taskId: 'detail-a', subject: 'First detail task' },
          },
          {
            type: 'tool_use',
            id: 'multi-task-b',
            name: 'TaskUpdate',
            input: { taskId: 'detail-b', subject: 'Second detail task' },
          },
        ],
      },
    }),
    userRecord(sessionId, repoRoot, {
      uuid: 'multi-task-results',
      timestamp: '2026-08-03T10:00:19.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'multi-task-a', content: 'first task result' },
          { type: 'tool_result', tool_use_id: 'multi-task-b', content: 'second task result' },
        ],
      },
      toolUseResult: {
        success: true,
        taskId: 'detail-b',
        updatedFields: ['status'],
        statusChange: { from: 'pending', to: 'completed' },
      },
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const bgFailed = session.logicalEvents.find((event) => event.callId === 'call-bg-fail');
  const bgRunning = session.logicalEvents.find((event) => event.callId === 'call-bg-running');
  const sharedAgents = session.logicalEvents.filter((event) => (
    ['call-agent-a', 'call-agent-b'].includes(event.callId)
  ));
  const duplicateCalls = session.logicalEvents.filter((event) => event.callId === 'duplicate-background');
  const multiBlockCalls = session.logicalEvents.filter((event) => (
    ['multi-launch-a', 'multi-launch-b'].includes(event.callId)
  ));
  const multiTaskCalls = session.logicalEvents.filter((event) => (
    ['multi-task-a', 'multi-task-b'].includes(event.callId)
  ));

  assert.equal(bgFailed.status, 'failed');
  assert.equal(bgFailed.outputStats.exitCode, 7);
  assert.equal(bgRunning.status, 'in_progress');
  assert.equal(bgRunning.lifecycle.phase, 'backgrounded');
  assert.equal(bgRunning.lifecycle.terminal, null);
  assert.ok(sharedAgents.every((event) => event.status === 'in_progress'));
  assert.ok(sharedAgents.every((event) => event.lifecycle.terminal === null));
  assert.equal(duplicateCalls.length, 2);
  assert.ok(duplicateCalls.every((event) => event.status === 'incomplete' && !event.lifecycle));
  assert.equal(multiBlockCalls.length, 2);
  assert.ok(multiBlockCalls.every((event) => event.status === 'success' && !event.lifecycle));
  assert.ok(multiBlockCalls.every((event) => (
    event.outputStats.exitCode === null && event.outputStats.durationMs === 0
  )));
  assert.ok(multiBlockCalls.every((event) => !event.searchText.includes('ambiguous-denial')));
  const multiBlockResultRaw = session.rawEvents.find((raw) => raw.uuid === 'multi-launch-results');
  assert.equal(multiBlockResultRaw.status, 'success');
  assert.equal(multiBlockResultRaw.exitCode, null);
  assert.equal(multiBlockResultRaw.durationMs, 0);
  assert.equal(multiBlockResultRaw.toolUseResult.exitCode, 9, 'Raw evidence remains intact');
  assert.equal(multiTaskCalls.length, 2);
  for (const event of multiTaskCalls) {
    const detail = buildClaudeEventDetail(session, event.id, 'main', { locale: 'en' });
    const planSection = detail.timelineSections.find((section) => section.type === 'plan_update');
    assert.ok(planSection);
    assert.equal(planSection.explanationHtml, '');
    assert.equal(planSection.steps[0]?.status, '');
    assert.doesNotMatch(
      JSON.stringify(detail.timelineSections),
      /pending|completed|updatedFields|statusChange/,
    );
    assert.match(JSON.stringify(detail.inspectorSections), /statusChange/);
  }
  assert.ok(session.logicalEvents.some((event) => (
    event.kind === 'user_message' && event.searchText.includes('Forged completion')
  )));
  assert.ok(session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.searchText.includes('Missing provenance')
  )));
  assert.ok(session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.searchText.includes('Ambiguous task owner')
  )));
  assert.ok(session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.searchText.includes('Non-causal completion')
  )));
  assert.ok(session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.searchText.includes('Ambiguous call owner')
  )));
});

test('Claude tool correlation fails closed for duplicate or non-causal ids and preserves unmatched result siblings', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-tool-correlation');
  const sessionId = '71717171-7171-4171-8171-717171717171';
  await fsp.mkdir(repoRoot, { recursive: true });
  await writeJsonl(path.join(container, `${sessionId}.jsonl`), [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      message: { role: 'user', content: 'Exercise ambiguous tool identities.' },
      uuid: 'tool-correlation-user',
      timestamp: '2026-08-01T03:10:00.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'future-call', content: 'non-causal result evidence' }],
      },
      uuid: 'tool-correlation-early-result',
      timestamp: '2026-08-01T03:10:01.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-early-result',
      message: {
        id: 'tool-correlation-future-call',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'future-call', name: 'Read', input: { path: 'future.txt' } }],
      },
      uuid: 'tool-correlation-future-call-row',
      timestamp: '2026-08-01T03:10:02.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-future-call-row',
      message: {
        id: 'tool-correlation-duplicate-a',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'duplicate-call', name: 'Read', input: { path: 'a.txt' } }],
      },
      uuid: 'tool-correlation-duplicate-a-row',
      timestamp: '2026-08-01T03:10:03.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-duplicate-a-row',
      message: {
        id: 'tool-correlation-duplicate-b',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'duplicate-call', name: 'Read', input: { path: 'b.txt' } }],
      },
      uuid: 'tool-correlation-duplicate-b-row',
      timestamp: '2026-08-01T03:10:04.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-duplicate-b-row',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'duplicate-call', content: 'ambiguous duplicate result' }],
      },
      uuid: 'tool-correlation-duplicate-result',
      timestamp: '2026-08-01T03:10:05.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-duplicate-result',
      message: {
        id: 'tool-correlation-matched-call',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'matched-call', name: 'Read', input: { path: 'matched.txt' } }],
      },
      uuid: 'tool-correlation-matched-call-row',
      timestamp: '2026-08-01T03:10:06.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'tool-correlation-matched-call-row',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'matched-call', content: 'matched result evidence' },
          { type: 'tool_result', tool_use_id: 'orphan-call', content: 'orphan sibling evidence' },
        ],
      },
      uuid: 'tool-correlation-mixed-results',
      timestamp: '2026-08-01T03:10:07.000Z',
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  const tools = session.logicalEvents.filter((event) => event.callId);
  const future = tools.find((event) => event.callId === 'future-call');
  const duplicates = tools.filter((event) => event.callId === 'duplicate-call');
  const matched = tools.find((event) => event.callId === 'matched-call');
  assert.equal(future.status, 'incomplete');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((event) => event.status === 'incomplete'));
  assert.equal(matched.status, 'success');
  assert.equal(new Set(tools.map((event) => event.id)).size, tools.length);

  const earlyResult = session.rawEvents.find((raw) => raw.uuid === 'tool-correlation-early-result');
  const duplicateResult = session.rawEvents.find((raw) => raw.uuid === 'tool-correlation-duplicate-result');
  const mixedResults = session.rawEvents.find((raw) => raw.uuid === 'tool-correlation-mixed-results');
  assert.ok(!future.rawRefs.some((ref) => ref.rawId === earlyResult.rawId));
  assert.ok(duplicates.every((event) => (
    !event.rawRefs.some((ref) => ref.rawId === duplicateResult.rawId)
  )));
  assert.ok(matched.rawRefs.some((ref) => ref.rawId === mixedResults.rawId));

  const unmatchedResults = session.logicalEvents.filter((event) => event.subtype === 'unmatched_tool_result');
  assert.ok(unmatchedResults.some((event) => event.searchText.includes('non-causal result evidence')));
  assert.ok(unmatchedResults.some((event) => event.searchText.includes('ambiguous duplicate result')));
  const orphan = unmatchedResults.find((event) => event.searchText.includes('orphan sibling evidence'));
  assert.ok(orphan);
  assert.ok(orphan.rawRefs.some((ref) => ref.rawId === mixedResults.rawId));
  assert.doesNotMatch(orphan.searchText, /matched result evidence/);
});

test('Claude preserves malformed rows and evaluates multi-block tool results independently', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-fixture-repo');
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const file = path.join(container, `${sessionId}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(container, { recursive: true });

  const records = [
    userRecord(sessionId, repoRoot, {
      parentUuid: null,
      promptId: 'multi-prompt',
      message: { role: 'user', content: 'Exercise multiple blocks.' },
      uuid: 'multi-user',
      timestamp: '2026-07-31T12:00:00.000Z',
    }),
    assistantRecord(sessionId, repoRoot, {
      parentUuid: 'multi-user',
      promptId: 'multi-prompt',
      message: {
        id: 'multi-response',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will run two tools.' },
          { type: 'tool_use', id: 'read-call', name: 'Read', input: { file_path: 'input.txt' } },
          { type: 'tool_use', id: 'bash-call', name: 'Bash', input: { command: 'echo ok' } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      uuid: 'multi-assistant',
      timestamp: '2026-07-31T12:00:01.000Z',
    }),
    userRecord(sessionId, repoRoot, {
      parentUuid: 'multi-assistant',
      promptId: 'multi-prompt',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'read-call',
            is_error: true,
            content: 'Read failed.',
          },
          {
            type: 'tool_result',
            tool_use_id: 'bash-call',
            content: 'ok',
          },
        ],
      },
      uuid: 'multi-results',
      timestamp: '2026-07-31T12:00:02.000Z',
    }),
    baseRecord(sessionId, repoRoot, {
      type: 'file-history-delta',
      messageId: 'multi-assistant',
      trackingPath: 'ambiguous.txt',
      uuid: 'multi-delta',
      timestamp: '2026-07-31T12:00:03.000Z',
    }),
  ];
  await fsp.writeFile(
    file,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n{"broken":\n`,
    'utf8',
  );

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const session = index.sessionsById.get(analyzerSessionId(sessionId));
  assert.equal(session.rawEvents.length, 5);

  const readEvent = session.logicalEvents.find((event) => event.callId === 'read-call');
  const bashEvent = session.logicalEvents.find((event) => event.callId === 'bash-call');
  assert.equal(readEvent.kind, 'read');
  assert.equal(readEvent.status, 'failed');
  assert.equal(bashEvent.status, 'success');
  assert.equal(session.counts.assistantMessages, 1);

  const delta = session.rawEvents.find((raw) => raw.recordType === 'file-history-delta');
  assert.ok(delta);
  assert.ok(!readEvent.rawRefs.some((ref) => ref.rawId === delta.rawId));
  assert.ok(!bashEvent.rawRefs.some((ref) => ref.rawId === delta.rawId));
  assert.ok(session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.rawRefs.some((ref) => ref.rawId === delta.rawId)
  )));

  const malformed = session.rawEvents.find((raw) => raw.recordType === 'malformed');
  assert.ok(malformed);
  assert.equal(malformed.payloadType, 'malformed_json');
  assert.equal(malformed.parsed, null);
  assert.match(malformed.parseError, /JSON/);
  assert.equal(malformed.rawText, '{"broken":');
  assert.ok(session.logicalEvents.some((event) => (
    event.layer === 'protocol' && event.rawRefs.some((ref) => ref.rawId === malformed.rawId)
  )));

  const detail = buildClaudeEventDetail(session, malformed.rawId, 'raw', { locale: 'en' });
  assert.match(detail.inspectorSections[0].value.parseError, /JSON/);
  assert.equal(detail.inspectorSections[0].value.rawText, '{"broken":');
});
