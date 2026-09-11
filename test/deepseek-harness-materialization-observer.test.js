'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildDeepSeekIndex,
  parseSessionArtifact,
} = require('../src/deepseek-harness');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { runWithMaterializationObserver } = require('../src/materialization-observer');

async function makeFixture(t, records) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-dsh-observer-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const sourceHome = path.join(root, 'sessions');
  const sessionDir = path.join(sourceHome, '--synthetic-observer--', 'session');
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(sessionDir, { recursive: true });
  const header = {
    type: 'session',
    version: 0,
    id: 'deepseek-observer-session',
    createdAt: 1000,
    cwd: repoRoot,
    delegationDepth: 0,
  };
  const file = path.join(sessionDir, 'session.jsonl');
  await fsp.writeFile(
    file,
    `${[header, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  return { file, repoRoot, sourceHome };
}

function validRecords() {
  return [
    { type: 'turn/start', seq: 0, time: 1001, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 1002, data: { turn: 1, step: 1 } },
    {
      type: 'user/message', seq: 2, time: 1003, surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'observer test prompt' }],
      },
    },
    {
      type: 'assistant/message', seq: 3, time: 1004, surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: 'observer test answer' }] },
      },
    },
    { type: 'step/end', seq: 4, time: 1005, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 1006, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
}

async function buildFixture(t) {
  const fixture = await makeFixture(t, validRecords());
  const index = await buildDeepSeekIndex({
    sourceHome: fixture.sourceHome,
    repoRoot: fixture.repoRoot,
  });
  assert.equal(index.sessions.length, 1);
  return { ...fixture, index, indexed: index.sessions[0] };
}

function deepSeekEvents(events) {
  return events.filter((event) => event.phase?.startsWith('deepseek_materialization_'));
}

test('DeepSeek materialization emits scoped, content-free source and reconstruction phases', async (t) => {
  const { index, indexed } = await buildFixture(t);
  const events = [];
  await materializeSessionForIndex(index, indexed, {
    onMaterializationPhase: (event) => events.push(event),
  });

  assert.deepEqual(deepSeekEvents(events), [
    { phase: 'deepseek_materialization_source_read', state: 'start' },
    { phase: 'deepseek_materialization_source_read', state: 'end' },
    { phase: 'deepseek_materialization_reconstruction', state: 'start' },
    { phase: 'deepseek_materialization_reconstruction', state: 'end' },
  ]);
  assert.ok(deepSeekEvents(events).every((event) => (
    Object.keys(event).every((key) => ['phase', 'state', 'durationMs'].includes(key))
  )));
});

test('DeepSeek materialization observer is behavior-neutral for success and rejection', async (t) => {
  const { index, indexed, file, repoRoot } = await buildFixture(t);
  const expected = await materializeSessionForIndex(index, indexed);
  const throwingObserver = () => { throw new Error('observer failed'); };
  const observed = await materializeSessionForIndex(index, indexed, {
    onMaterializationPhase: throwingObserver,
  });
  assert.deepEqual(observed, expected);

  // The same accepted-snapshot rejection must survive a throwing callback on
  // the production admission path, not only on the standalone parser path.
  await fsp.appendFile(file, '\n', 'utf8');
  for (const options of [{}, { onMaterializationPhase: throwingObserver }]) {
    await assert.rejects(
      () => materializeSessionForIndex(index, indexed, options),
      (error) => error.code === 'INDEXED_SOURCE_STALE',
    );
  }

  const invalidFile = path.join(path.dirname(file), 'invalid-session.jsonl');
  await fsp.writeFile(invalidFile, [
    JSON.stringify({
      type: 'session', version: 0, id: 'invalid-observer-session', createdAt: 1000,
      cwd: repoRoot, delegationDepth: 0,
    }),
    '{"type":"turn/start",',
  ].join('\n') + '\n', 'utf8');
  const parseOptions = { compression: 'none' };
  let expectedError;
  await assert.rejects(
    () => parseSessionArtifact(invalidFile, 'invalid-session.jsonl', repoRoot, undefined, parseOptions),
    (error) => {
      expectedError = { code: error.code, message: error.message };
      return true;
    },
  );
  let observedError;
  await assert.rejects(
    () => runWithMaterializationObserver(
      throwingObserver,
      () => parseSessionArtifact(invalidFile, 'invalid-session.jsonl', repoRoot, undefined, parseOptions),
    ),
    (error) => {
      observedError = { code: error.code, message: error.message };
      return true;
    },
  );
  assert.deepEqual(observedError, expectedError);
});
