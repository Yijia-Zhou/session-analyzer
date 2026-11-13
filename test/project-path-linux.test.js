'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { interpretProjectPath, sameProjectPath, projectPathContains } = require('../src/shared/project-path');
const { readWorkbuddySnapshot } = require('../src/workbuddy-storage');

test('native Linux: slash prefixes, case, literal backslashes and symlink/.. remain distinct from lexical project identity',
  { skip: process.platform !== 'linux' }, async t => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'project-path-linux-'));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    for (const [directory, marker] of [['Project', 'UPPER'], ['project', 'lower'], ['a\\b', 'literal'], ['a/b', 'nested']]) {
      await fs.mkdir(path.join(base, directory), { recursive: true });
      await fs.writeFile(path.join(base, directory, 'marker'), marker);
    }
    const project = path.join(base, 'Project');
    const a = await fs.stat(project); const b = await fs.stat('/' + project); const c = await fs.stat('//' + project);
    assert.equal(a.dev, b.dev); assert.equal(a.ino, b.ino); assert.equal(a.ino, c.ino);
    assert.equal(await fs.realpath('/' + project), await fs.realpath(project));
    assert.notEqual((await fs.stat(path.join(base, 'project'))).ino, a.ino);
    assert.equal(await fs.readFile(path.join(base, 'a\\b/marker'), 'utf8'), 'literal');
    assert.equal(await fs.readFile(path.join(base, 'a/b/marker'), 'utf8'), 'nested');
    assert.equal(sameProjectPath('/' + project, '/' + path.join(base, 'project')), false);
    assert.equal(sameProjectPath(path.join(base, 'a\\b'), path.join(base, 'a/b')), false);

    const outside = path.join(base, 'outside');
    await fs.mkdir(path.join(outside, 'child'), { recursive: true });
    await fs.writeFile(path.join(outside, 'marker'), 'physical parent');
    await fs.writeFile(path.join(project, 'marker'), 'lexical parent');
    await fs.symlink(path.join(outside, 'child'), path.join(project, 'escape'));
    const raw = project + '/escape/../marker';
    assert.equal(await fs.readFile(raw, 'utf8'), 'physical parent');
    assert.equal(await fs.readFile(path.resolve(raw), 'utf8'), 'lexical parent');
    assert.equal(projectPathContains(interpretProjectPath(raw), interpretProjectPath(project)), true);
    assert.equal(projectPathContains(await fs.realpath(raw), await fs.realpath(project)), false);

    const external = path.join(outside, 's.jsonl');
    await fs.writeFile(external, '{"synthetic":true}\n');
    await fs.symlink(external, path.join(project, 's.jsonl'));
    await assert.rejects(readWorkbuddySnapshot(path.join(project, 's.jsonl'), { sessionsRoot: project }),
      error => error.code === 'INDEXED_SOURCE_STALE');
    assert.equal(await fs.readFile(external, 'utf8'), '{"synthetic":true}\n');
  });
