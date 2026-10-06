'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { classifyChanges, determineScope, isAllowedDocument, parseRawDiff } = require('../scripts/ci-scope');
const repoRoot = path.join(__dirname, '..');
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const entry = (filename, overrides = {}) => ({ path: filename, status: 'M', oldMode: '100644', newMode: '100644', ...overrides });
const raw = (filename = 'README.md') => Buffer.from(`:100644 100644 ${sha} ${otherSha} M\0${filename}\0`);

test('CI document scope is a narrow, case-sensitive path allowlist', () => {
  for (const filename of ['README.md', 'README.zh-CN.md', 'docs/development.md', 'docs/exec-plans/active/test.md', 'docs/exec-plans/completed/test.md', 'docs/exec-plans/tech-debt-tracker.md']) {
    assert.equal(isAllowedDocument(filename), true, filename);
  }
  for (const filename of ['readme.md', 'CHANGELOG.md', 'LICENSE', 'AGENTS.md', 'package.json', 'src/app.js', '.github/workflows/ci.yml', 'scripts/ci-scope.js', 'docs/design-docs/npm-release-runbook.md', 'docs/assets/picture.png', 'docs/exec-plans/script.js', 'docs/exec-plans/../design-docs/test.md', 'docs/exec-plans//test.md', 'docs/exec-plans/test\n.md', 'docs\\exec-plans\\test.md', '/README.md']) {
    assert.equal(isAllowedDocument(filename), false, filename);
  }
});

test('only nonempty ordinary-document diffs waive browser coverage', () => {
  assert.equal(classifyChanges([entry('README.md')]).browserRequired, false);
  assert.equal(classifyChanges([]).browserRequired, true);
  assert.equal(classifyChanges([entry('README.md'), entry('src/app.js')]).browserRequired, true);
  for (const overrides of [
    { oldMode: '100755', newMode: '100755' },
    { oldMode: '120000', newMode: '120000' },
    { oldMode: '160000', newMode: '160000' },
    { status: 'T', newMode: '120000' },
    { status: 'U' },
  ]) assert.equal(classifyChanges([entry('README.md', overrides)]).browserRequired, true);
  const removed = entry('docs/exec-plans/active/test.md', { status: 'D', newMode: '000000' });
  const added = entry('docs/exec-plans/completed/test.md', { status: 'A', oldMode: '000000' });
  assert.equal(classifyChanges([removed, added]).browserRequired, false);
  assert.equal(classifyChanges([removed, { ...added, path: 'src/test.md' }]).browserRequired, true);
  assert.equal(classifyChanges([{ ...removed, path: 'src/test.md' }, added]).browserRequired, true);
});

test('raw diff parser rejects truncation, invalid encoding and unexpected formats', () => {
  assert.deepEqual(parseRawDiff(raw()), [entry('README.md')]);
  assert.equal(parseRawDiff(raw('docs/exec-plans/a b.md'))[0].path, 'docs/exec-plans/a b.md');
  for (const invalid of [raw().subarray(0, -1), Buffer.from([0xff, 0]), Buffer.from('garbage\0README.md\0'), Buffer.from(`:100644 100644 ${sha} ${otherSha} R100\0old\0new\0`)]) {
    assert.throws(() => parseRawDiff(invalid));
  }
});

test('non-PR events and uncertain comparisons require full coverage', () => {
  const input = { eventName: 'pull_request', baseSha: sha, headSha: otherSha };
  for (const eventName of ['push', 'workflow_dispatch', 'pull_request_target', undefined]) {
    assert.equal(determineScope({ ...input, eventName }, () => { throw Error('must not read git'); }).reason, 'non-pull-request');
  }
  assert.equal(determineScope({ ...input, headSha: '--bad-ref' }).browserRequired, true);
  assert.equal(determineScope(input, () => { throw Error('missing history or buffer overflow'); }).browserRequired, true);
  assert.equal(determineScope(input, () => Buffer.from('')).browserRequired, true);
  assert.equal(determineScope(input, (args) => args[0] === 'merge-base' ? Buffer.from(sha) : raw().subarray(0, -1)).browserRequired, true);
  assert.equal(determineScope(input, (args) => args[0] === 'merge-base' ? Buffer.from(sha) : Buffer.from('')).browserRequired, true);
  for (const statistics of ['-\t-\tREADME.md\0', '1\t1\tREADME.md', '1\t1\twrong.md\0', '1\t1\tREADME.md\0' + '1\t1\tREADME.md\0']) {
    assert.equal(determineScope(input, (args) => args[0] === 'merge-base' ? Buffer.from(sha) : args.includes('--numstat') ? Buffer.from(statistics) : raw()).browserRequired, true);
  }
});

test('actual git history classifies the PR merge-base diff and both sides of moves', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-ci-scope-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('session-analyzer-ci-scope-'));
    await fsp.rm(directory, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic CI Test', GIT_AUTHOR_EMAIL: 'ci@example.invalid', GIT_COMMITTER_NAME: 'Synthetic CI Test', GIT_COMMITTER_EMAIL: 'ci@example.invalid' },
  }).trim();
  git('init', '--quiet');
  await fsp.writeFile(path.join(directory, 'README.md'), 'base\n');
  await fsp.writeFile(path.join(directory, 'runtime.js'), 'base\n');
  git('add', '--all'); git('commit', '--quiet', '-m', 'synthetic base');
  const baseSha = git('rev-parse', 'HEAD');
  await fsp.writeFile(path.join(directory, 'README.md'), 'docs\n');
  git('add', '--all'); git('commit', '--quiet', '-m', 'synthetic docs');
  const headSha = git('rev-parse', 'HEAD');
  git('checkout', '--detach', baseSha);
  await fsp.writeFile(path.join(directory, 'runtime.js'), 'base advanced\n');
  git('add', '--all'); git('commit', '--quiet', '-m', 'synthetic newer base');
  const advancedBase = git('rev-parse', 'HEAD');
  const input = { eventName: 'pull_request', baseSha: advancedBase, headSha, cwd: directory };
  const result = determineScope(input);
  assert.equal(result.mode, 'docs-only');
  assert.equal(result.mergeBase, baseSha);
  const outputFile = path.join(directory, 'workflow-output');
  const cli = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ci-scope.js')], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', CI_BASE_SHA: advancedBase, CI_HEAD_SHA: headSha, GITHUB_OUTPUT: outputFile },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).browserRequired, false);
  assert.equal(await fsp.readFile(outputFile, 'utf8'), 'mode=docs-only\nbrowser_required=false\n');
  git('checkout', '--detach', headSha);
  git('mv', 'README.md', 'outside.md');
  git('commit', '--quiet', '-m', 'synthetic cross-boundary move');
  assert.equal(determineScope({ ...input, headSha: git('rev-parse', 'HEAD') }).mode, 'full');
  git('checkout', '--detach', headSha);
  await fsp.writeFile(path.join(directory, 'README.md'), Buffer.from([0, 255, 1, 2]));
  git('add', '--', 'README.md'); git('commit', '--quiet', '-m', 'synthetic binary document');
  assert.equal(determineScope({ ...input, headSha: git('rev-parse', 'HEAD') }).mode, 'full');
});

function bashExecutable() {
  if (process.platform !== 'win32') return '/bin/bash';
  const gitPaths = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/u);
  for (const gitPath of gitPaths) {
    for (const candidate of [path.resolve(path.dirname(gitPath), '../bin/bash.exe'), path.join(path.dirname(gitPath), 'bash.exe')]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Git Bash is required to test the actual CI aggregation shell.');
}

test('actual workflow aggregation accepts only complete expected results', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/gu, '\n');
  const match = /      - name: Require expected CI jobs to succeed\n[\s\S]*?        run: \|\n((?:          [^\n]*\n?)+)/u.exec(workflow);
  assert.ok(match, 'aggregate shell block exists');
  const script = match[1].split('\n').map(line => line.slice(10)).join('\n');
  const full = { EVENT_NAME: 'pull_request', SCOPE_RESULT: 'success', SCOPE_MODE: 'full', BROWSER_REQUIRED: 'true', NODE_RESULT: 'success', PACKAGE_RESULT: 'success', BROWSER_RESULT: 'success' };
  const docs = { ...full, SCOPE_MODE: 'docs-only', BROWSER_REQUIRED: 'false', BROWSER_RESULT: 'skipped' };
  const cases = [[full, true], [docs, true], [{ ...full, EVENT_NAME: 'push' }, true], [{ ...full, EVENT_NAME: 'workflow_dispatch' }, true]];
  for (const eventName of ['push', 'workflow_dispatch', '']) cases.push([{ ...docs, EVENT_NAME: eventName }, false]);
  for (const good of [full, docs]) {
    for (const dependency of ['SCOPE_RESULT', 'NODE_RESULT', 'PACKAGE_RESULT']) {
      for (const bad of ['failure', 'cancelled', 'skipped', '']) cases.push([{ ...good, [dependency]: bad }, false]);
    }
    for (const bad of ['failure', 'cancelled', '']) cases.push([{ ...good, BROWSER_RESULT: bad }, false]);
    cases.push([{ ...good, SCOPE_MODE: '' }, false], [{ ...good, BROWSER_REQUIRED: '' }, false]);
  }
  cases.push([{ ...full, BROWSER_RESULT: 'skipped' }, false], [{ ...docs, BROWSER_RESULT: 'success' }, false]);
  const bash = bashExecutable();
  for (const [environment, expected] of cases) {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', script], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ...environment, BASH_ENV: '', ENV: '' },
    });
    assert.ifError(result.error);
    assert.equal(result.status === 0, expected, JSON.stringify(environment));
  }
});

test('workflow wires full-history classification without filtering the required workflow', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/gu, '\n');
  const scope = workflow.slice(workflow.indexOf('  scope:\n'), workflow.indexOf('  node:\n'));
  const browser = workflow.slice(workflow.indexOf('  browser:\n'), workflow.indexOf('  ci:\n'));
  const aggregate = workflow.slice(workflow.indexOf('  ci:\n'));
  assert.doesNotMatch(workflow, /\bpaths(?:-ignore)?:/u);
  assert.match(scope, /fetch-depth: 0/u);
  assert.match(scope, /persist-credentials: false/u);
  assert.match(scope, /CI_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(scope, /CI_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(scope, /run: node scripts\/ci-scope\.js/u);
  assert.match(browser, /needs: scope/u);
  assert.match(browser, /if: \$\{\{ needs\.scope\.outputs\.browser_required != 'false' \}\}/u);
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/u);
  for (const dependency of ['scope', 'node', 'package', 'browser']) assert.ok(aggregate.includes(`      - ${dependency}\n`));
  for (const [name, value] of Object.entries({ EVENT_NAME: 'github.event_name', SCOPE_RESULT: 'needs.scope.result', SCOPE_MODE: 'needs.scope.outputs.mode', BROWSER_REQUIRED: 'needs.scope.outputs.browser_required', NODE_RESULT: 'needs.node.result', PACKAGE_RESULT: 'needs.package.result', BROWSER_RESULT: 'needs.browser.result' })) {
    assert.ok(aggregate.includes(`${name}: \u0024{{ ${value} }}`), name);
  }
});
