'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyzerSessionId, buildClaudeIndex } = require('../src/claude');

async function makeClaudeHome(t) {
  const claudeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-pointer-review-'));
  t.after(() => fsp.rm(claudeHome, { recursive: true, force: true }));
  return claudeHome;
}

async function writeJsonl(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function record(sessionId, cwd, fields = {}) {
  return {
    sessionId,
    ...(cwd ? { cwd } : {}),
    ...fields,
  };
}

function pointerRecords(parentId, cwd, childPrefix, commandUuid = 'pointer-command') {
  return [
    record(parentId, cwd, {
      type: 'user',
      parentUuid: null,
      uuid: 'pointer-root',
      timestamp: '2026-08-01T08:00:00.000Z',
      message: { role: 'user', content: 'Parent task' },
    }),
    record(parentId, cwd, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: 'pointer-root',
      uuid: commandUuid,
      timestamp: '2026-08-01T08:00:01.000Z',
      content: '<command-name>/fork</command-name>',
    }),
    record(parentId, cwd, {
      type: 'system',
      subtype: 'local_command',
      parentUuid: commandUuid,
      uuid: 'pointer-output',
      timestamp: '2026-08-01T08:00:01.000Z',
      content: `<local-command-stdout>session waiting for a prompt · Review child · ${childPrefix}</local-command-stdout>`,
    }),
  ];
}

test('Pointer fork preserves a child embedded-cwd instead of replacing it with parent ownership', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const parentCwd = path.join(repoRoot, 'parent');
  const childCwd = path.join(repoRoot, 'child');
  const container = path.join(claudeHome, 'projects', '-review-strong-child');
  const parentId = '10101010-1010-4010-8010-101010101010';
  const childId = '20202020-2020-4020-8020-202020202020';
  await fsp.mkdir(parentCwd, { recursive: true });
  await fsp.mkdir(childCwd, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), pointerRecords(parentId, parentCwd, '20202020'));
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    record(childId, childCwd, {
      type: 'user',
      parentUuid: null,
      uuid: 'strong-child-user',
      timestamp: '2026-08-01T08:00:02.000Z',
      message: { role: 'user', content: 'Child continuation' },
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const child = index.sessionsById.get(analyzerSessionId(childId));

  assert.equal(child.forkedFromSessionId, analyzerSessionId(parentId));
  assert.equal(child.forkStorageMode, 'pointer');
  assert.equal(child.projectAssociation, 'embedded-cwd');
  assert.deepEqual([...child.cwdSet], [path.resolve(childCwd)]);
  assert.equal(child.matchesRepo, true);
});

test('Pointer fork fails closed when its provisional parent will not be retained', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const otherRoot = path.join(claudeHome, 'other-repo');
  const container = path.join(claudeHome, 'projects', '-review-provisional-parent');
  const parentId = '30303030-3030-4030-8030-303030303030';
  const childId = '40404040-4040-4040-8040-404040404040';
  const outsideId = '50505050-5050-4050-8050-505050505050';
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(otherRoot, { recursive: true });
  await writeJsonl(path.join(container, `${parentId}.jsonl`), pointerRecords(parentId, '', '40404040'));
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    record(childId, repoRoot, {
      type: 'user',
      parentUuid: null,
      uuid: 'retained-child-user',
      timestamp: '2026-08-01T08:00:02.000Z',
      message: { role: 'user', content: 'Strong child' },
    }),
  ]);
  await writeJsonl(path.join(container, `${outsideId}.jsonl`), [
    record(outsideId, otherRoot, {
      type: 'user',
      parentUuid: null,
      uuid: 'outside-user',
      timestamp: '2026-08-01T08:00:03.000Z',
      message: { role: 'user', content: 'Outside project' },
    }),
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const child = index.sessionsById.get(analyzerSessionId(childId));

  assert.equal(index.sessionsById.has(analyzerSessionId(parentId)), false);
  assert.equal(child.forkedFromSessionId, '');
  assert.equal(child.forkStorageMode, '');
  assert.equal(child.projectAssociation, 'embedded-cwd');
  assert.deepEqual([...child.cwdSet], [path.resolve(repoRoot)]);
});

test('Pointer fork rejects a command UUID reused by another raw record', async (t) => {
  const claudeHome = await makeClaudeHome(t);
  const repoRoot = path.join(claudeHome, 'repo');
  const container = path.join(claudeHome, 'projects', '-review-duplicate-command');
  const parentId = '60606060-6060-4060-8060-606060606060';
  const childId = '70707070-7070-4070-8070-707070707070';
  const commandUuid = 'reused-command-uuid';
  await fsp.mkdir(repoRoot, { recursive: true });
  const parentRecords = pointerRecords(parentId, repoRoot, '70707070', commandUuid);
  parentRecords.push(record(parentId, repoRoot, {
    type: 'mode',
    parentUuid: 'pointer-root',
    uuid: commandUuid,
    timestamp: '2026-08-01T08:00:02.000Z',
    mode: 'normal',
  }));
  await writeJsonl(path.join(container, `${parentId}.jsonl`), parentRecords);
  await writeJsonl(path.join(container, `${childId}.jsonl`), [
    { type: 'ai-title', aiTitle: 'Review child', sessionId: childId },
  ]);

  const index = await buildClaudeIndex({ repoRoot, claudeHome });
  const child = index.sessionsById.get(analyzerSessionId(childId));

  assert.ok(child);
  assert.equal(child.forkedFromSessionId, '');
  assert.equal(child.forkStorageMode, '');
});
