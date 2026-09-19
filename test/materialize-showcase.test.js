'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

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
  const child = scenario.sessions.find((session) => session.key === 'subagent-child');

  const childMeta = buildSessionRecords(child, 'acme/task-board')[0].payload;
  assert.deepEqual(childMeta.source, { subagent: 'subagent' });
  assert.equal(childMeta.agent_nickname, 'Docs');

  const reviewMeta = buildSessionRecords({ ...child, derivedKind: 'review', agentNickname: undefined }, 'acme/task-board')[0].payload;
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

test('README showcase patches reproduce the focused failure and recovery', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'showcase-story-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const files = { ...scenario.project.files };
  const parent = scenario.sessions.find((session) => session.key === 'parent');
  const commands = parent.events.filter((event) => event.type === 'command');
  assert.match(commands[1].command, /search-navigation\.js.*search-navigation\.test\.js/);
  assert.match(commands[3].command, /search-navigation\.js.*search-navigation\.test\.js/);
  let runs = 0;
  for (const event of parent.events) {
    if (event.type === 'patch') {
      for (const [file, change] of Object.entries(event.files)) {
        const lines = files[file].trimEnd().split('\n');
        const [header, ...body] = change.unified_diff.split('\n');
        const match = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(header);
        assert.ok(match, header);
        const oldLines = body.filter((line) => /^[ -]/.test(line)).map((line) => line.slice(1));
        const newLines = body.filter((line) => /^[ +]/.test(line)).map((line) => line.slice(1));
        assert.equal(oldLines.length, Number(match[2]));
        assert.equal(newLines.length, Number(match[4]));
        assert.deepEqual(lines.slice(Number(match[1]) - 1, Number(match[1]) - 1 + oldLines.length), oldLines);
        lines.splice(Number(match[1]) - 1, oldLines.length, ...newLines);
        files[file] = lines.join('\n') + '\n';
      }
    }
    if (event.type !== 'command' || event.command !== 'npm test -- search-navigation') continue;
    for (const [file, content] of Object.entries(files)) {
      await fsp.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fsp.writeFile(path.join(root, file), content);
    }
    const script = JSON.parse(files['package.json']).scripts.test.split(' ');
    assert.equal(script.shift(), 'node');
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [...script, 'search-navigation'], {
      cwd: root, encoding: 'utf8', timeout: 15000, env: childEnv,
    });
    assert.ifError(result.error);
    assert.equal(result.status, event.exitCode, result.stdout + result.stderr);
    assert.match(result.stdout, /tests 12/);
    assert.match(result.stdout, event.status === 'failed' ? /pass 11/ : /pass 12/);
    if (event.status === 'failed') {
      assert.match(result.stdout, /Expected next search target to be materialized/);
      assert.match(result.stdout, /search-navigation\.test\.js:29:10/);
    }
    runs += 1;
  }
  assert.equal(runs, 2);
});
