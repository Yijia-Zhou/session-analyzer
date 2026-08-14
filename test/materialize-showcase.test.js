'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { discoverConfiguredProjects } = require('../src/codex');
const scenario = require('../showcase/scenarios/readme/scenario');
const { buildSessionRecords, projectConfigText } = require('../scripts/materialize-showcase');

test('showcase project config remains valid when the path contains an apostrophe', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'showcase-O\'Connor-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const projectRoot = path.join(root, 'workspace', "O'Connor", 'task-board');
  await fsp.mkdir(projectRoot, { recursive: true });
  await fsp.mkdir(codexHome, { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'config.toml'), projectConfigText(projectRoot), 'utf8');

  const projects = await discoverConfiguredProjects({ codexHome });

  assert.deepEqual(projects.map((project) => project.repoRoot), [path.resolve(projectRoot)]);
});

test('showcase materialization does not mutate canonical events', () => {
  const parent = scenario.sessions.find((session) => session.key === 'parent');
  const before = structuredClone(parent.events);

  buildSessionRecords(parent, 'acme/task-board');

  assert.deepEqual(parent.events, before);
  assert.ok(parent.events.every((event) => !Object.hasOwn(event, 'date') && !Object.hasOwn(event, 'time')));
});

test('showcase derivedKind controls derived provenance metadata', () => {
  const child = scenario.sessions.find((session) => session.key === 'review-child');

  const reviewMeta = buildSessionRecords(child, 'acme/task-board')[0].payload;
  assert.deepEqual(reviewMeta.source, { subagent: 'review' });
  assert.equal(reviewMeta.agent_nickname, 'Review');

  const subagent = {
    ...child,
    derivedKind: 'subagent',
    agentNickname: undefined,
  };
  const subagentMeta = buildSessionRecords(subagent, 'acme/task-board')[0].payload;
  assert.deepEqual(subagentMeta.source, { subagent: 'subagent' });
  assert.equal(subagentMeta.agent_nickname, 'Subagent');

  assert.throws(
    () => buildSessionRecords({ ...child, derivedKind: 'unknown' }, 'acme/task-board'),
    /Unsupported derived session kind: unknown/,
  );
});
