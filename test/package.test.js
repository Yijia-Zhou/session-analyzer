'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isPackageStatePayload,
  normalizePackManifest,
  packageRegistry,
  waitForPackageState,
} = require('../scripts/package-smoke');

const repoRoot = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32'
  ? { command: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'npm'] }
  : { command: 'npm', prefixArgs: [] };

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: options.shell || false,
    ...options,
    env: {
      ...process.env,
      ...options.env,
    },
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with exit code ${result.status}`,
      result.error ? result.error.stack || result.error.message : '',
      result.signal ? `signal: ${result.signal}` : '',
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function npmPackDryRunFiles() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-analyzer-npm-cache-'));
  try {
    const result = run(npmCommand.command, [...npmCommand.prefixArgs, 'pack', '--dry-run', '--json'], {
      env: { npm_config_cache: cacheDir },
    });
    const manifest = normalizePackManifest(JSON.parse(result.stdout));
    return manifest.files.map((file) => file.path).sort();
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

test('package metadata exposes the session-analyzer CLI', () => {
  const pkg = require('../package.json');
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  assert.equal(pkg.version, '0.1.2');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.license, 'BSD-3-Clause');
  assert.deepEqual(pkg.engines, { node: '>=22' });
  assert.deepEqual(pkg.publishConfig, {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
  });
  assert.equal(pkg.scripts['release:check'], 'npm run build:check && npm test && npm run test:package');
  assert.equal(pkg.scripts.prepublishOnly, 'npm run release:check');
  assert.deepEqual(pkg.dependencies, {
    acorn: '8.15.0',
    'markdown-it': '14.3.0',
  });
  assert.deepEqual(pkg.allowScripts, {
    'esbuild@0.28.1': true,
    fsevents: false,
  });
  assert.deepEqual(pkg.devEngines, {
    runtime: {
      name: 'node',
      version: '^22.22.2 || ^24.15.0',
      onFail: 'error',
    },
    packageManager: {
      name: 'npm',
      version: '12.0.2',
      onFail: 'error',
    },
  });
  assert.equal(pkg.devDependencies['highlight.js'], '11.11.1');
  assert.deepEqual(pkg.bin, { 'session-analyzer': 'server.js' });
  assert.ok(server.startsWith('#!/usr/bin/env node'));
});

test('install-script policy covers every locked install script', () => {
  const pkg = require('../package.json');
  const lock = require('../package-lock.json');
  const npmrcLines = fs.readFileSync(path.join(repoRoot, '.npmrc'), 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const decisions = Object.entries(lock.packages)
    .filter(([location, metadata]) => location && metadata.hasInstallScript)
    .map(([location, metadata]) => {
      const packageName = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const exactKey = `${packageName}@${metadata.version}`;
      const decision = Object.hasOwn(pkg.allowScripts, exactKey)
        ? pkg.allowScripts[exactKey]
        : pkg.allowScripts[packageName];
      return { package: exactKey, decision };
    })
    .sort((left, right) => left.package.localeCompare(right.package));

  assert.deepEqual(npmrcLines, ['strict-allow-scripts=true']);
  assert.deepEqual(decisions, [
    { package: 'esbuild@0.28.1', decision: true },
    { package: 'fsevents@2.3.2', decision: false },
  ]);
});

test('CI pins npm before every strict dependency installation', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const bootstrap = 'npm install --global npm@12.0.2 --ignore-scripts --registry=https://registry.npmjs.org/';
  const strictInstall = 'npm ci --strict-allow-scripts';
  const isolatedBootstrapDirectory = 'working-directory: ${{ runner.temp }}';
  const disabledSetupNodeCache = 'package-manager-cache: false';

  assert.equal(workflow.split(bootstrap).length - 1, 3);
  assert.equal(workflow.split(strictInstall).length - 1, 3);
  assert.equal(workflow.split(isolatedBootstrapDirectory).length - 1, 3);
  assert.equal(workflow.split(disabledSetupNodeCache).length - 1, 3);
  assert.doesNotMatch(workflow, /^\s+cache:\s*npm\s*$/mu);
});

test('packaged third-party notice preserves the Highlight.js license', () => {
  const normalizeEol = (value) => value.replace(/\r\n/gu, '\n').trim();
  const notice = normalizeEol(fs.readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'));
  const highlightLicense = normalizeEol(fs.readFileSync(path.join(repoRoot, 'node_modules', 'highlight.js', 'LICENSE'), 'utf8'));

  assert.match(notice, /Highlight\.js 11\.11\.1/u);
  assert.match(notice, /public\/vendor\/highlightjs\/highlight\.min\.js/u);
  assert.match(notice, /public\/vendor\/highlightjs\/github\.min\.css/u);
  assert.ok(notice.includes(highlightLicense));
});

test('source setup docs bootstrap exact npm before strict installation', () => {
  const bootstrap = 'npm install --global npm@12.0.2 --ignore-scripts --registry=https://registry.npmjs.org/';
  const strictInstall = 'npm ci --strict-allow-scripts --registry=https://registry.npmjs.org/';
  const docs = [
    {
      path: 'README.md',
      runtimeBoundary: 'Installed CLI:',
      sourceBoundary: 'Source development and release work:',
    },
    {
      path: 'README.zh-CN.md',
      runtimeBoundary: '已安装 CLI：',
      sourceBoundary: '源码开发与发布工作：',
    },
  ];

  for (const doc of docs) {
    const content = fs.readFileSync(path.join(repoRoot, doc.path), 'utf8');
    assert.match(content, new RegExp(doc.runtimeBoundary, 'u'));
    assert.match(content, new RegExp(doc.sourceBoundary, 'u'));
    assert.ok(content.indexOf(bootstrap) > -1, `${doc.path} should document the exact npm bootstrap`);
    assert.ok(content.indexOf(strictInstall) > content.indexOf(bootstrap), `${doc.path} should bootstrap npm before strict install`);
    assert.doesNotMatch(content, /(?:^|\r?\n)npm install(?:\r?\n|$)/u);
  }
});

test('final dist-tag evidence uses a separately proven anonymous userconfig', () => {
  const runbook = fs.readFileSync(path.join(repoRoot, 'docs', 'design-docs', 'npm-release-runbook.md'), 'utf8');
  const stepStart = runbook.indexOf('### 10. Promote the verified version');
  const stepEnd = runbook.indexOf('### 11. Create the release tag', stepStart);
  const step = runbook.slice(stepStart, stepEnd);
  const whoami = 'npm whoami --registry=$finalTagRegistry';
  const distTags = "npm dist-tag ls 'session-analyzer' --registry=$finalTagRegistry";

  assert.ok(stepStart > -1 && stepEnd > stepStart);
  assert.match(step, /session-analyzer-npm-tags-/u);
  assert.match(step, /NPM_CONFIG_USERCONFIG/u);
  assert.match(step, /ENEEDAUTH/u);
  assert.ok(step.indexOf(whoami) > -1);
  assert.ok(step.indexOf(distTags) > step.indexOf(whoami));
  assert.match(step, /Remove-Item 'Env:NPM_CONFIG_USERCONFIG'/u);
});

test('CLI help documents the npm command and host privacy option', () => {
  const result = run(process.execPath, ['server.js', '--help']);

  assert.match(result.stdout, /session-analyzer \[--repo <repo-path>\]/);
  assert.match(result.stdout, /--host <host>/);
  assert.match(result.stdout, /Binding to another host can expose transcript content/);
  assert.doesNotMatch(result.stdout, /node server\.js \[--repo/);
});

test('npm pack manifest normalization supports npm 11 and npm 12 JSON shapes', () => {
  const artifact = {
    filename: 'session-analyzer-0.1.2.tgz',
    files: [{ path: 'server.js' }],
  };

  assert.equal(normalizePackManifest([artifact]), artifact);
  assert.equal(normalizePackManifest({ 'session-analyzer': artifact }), artifact);
  assert.throws(
    () => normalizePackManifest({}),
    /exactly one package artifact/,
  );
  assert.throws(
    () => normalizePackManifest({ first: artifact, second: artifact }),
    /exactly one package artifact/,
  );
});

test('package smoke pins nested npm operations to the public registry', () => {
  assert.equal(packageRegistry, 'https://registry.npmjs.org/');
});

test('npm pack manifest contains only runtime package files', () => {
  const files = npmPackDryRunFiles();
  const fileSet = new Set(files);
  const required = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'README.zh-CN.md',
    'THIRD_PARTY_NOTICES.md',
    'package.json',
    'public/assets/app.js',
    'public/favicon.ico',
    'public/index.html',
    'public/styles.css',
    'public/vendor/highlightjs/github.min.css',
    'public/vendor/highlightjs/highlight.min.js',
    'server.js',
    'src/codex-code-mode.js',
    'src/codex-code-mode-presentation.js',
    'src/codex-detail.js',
    'src/codex-goal.js',
    'src/codex-logical.js',
    'src/codex-presentation-context.js',
    'src/codex-search.js',
    'src/codex-source.js',
    'src/codex-tool-lifecycle-contract.js',
    'src/codex.js',
    'src/folding.js',
    'src/shared/command-highlighting.js',
    'src/shared/code-mode-presentation-contract.js',
    'src/shared/folding.js',
    'src/shared/i18n.js',
    'src/shared/plan-facet.js',
  ];
  for (const file of required) {
    assert.ok(fileSet.has(file), `${file} should be included in the package`);
  }

  const forbiddenPrefixes = [
    'docs/',
    'e2e/',
    'scripts/',
    'src/browser/',
    'test/',
  ];
  for (const file of files) {
    assert.equal(file, file.replace(/\\/g, '/'));
    assert.equal(forbiddenPrefixes.some((prefix) => file.startsWith(prefix)), false, `${file} should not be included in the package`);
    assert.equal(file.endsWith('.map'), false, `${file} source maps should not be included in the package`);
  }

  const forbiddenFiles = new Set([
    'AGENTS.md',
    'restart-default.cmd',
  ]);
  for (const file of forbiddenFiles) {
    assert.equal(fileSet.has(file), false, `${file} should not be included in the package`);
  }
});

test('package smoke state predicate requires final app state payload', () => {
  assert.equal(isPackageStatePayload({
    statusCode: 202,
    json: { job: { id: '1', status: 'running' } },
    body: '{"job":{"id":"1","status":"running"}}',
  }), false);

  assert.equal(isPackageStatePayload({
    statusCode: 200,
    json: {
      totals: {},
      supportedLocales: ['en', 'zh-CN'],
      eventKinds: {},
      codeModeRequests: [],
      projectSelected: true,
    },
    body: '{}',
  }), true);
});

test('package smoke waits past a 202 indexing job before passing state', async () => {
  const statePayload = {
    totals: {},
    supportedLocales: ['en', 'zh-CN'],
    eventKinds: {},
    codeModeRequests: [],
    projectSelected: true,
  };
  let stateCalls = 0;
  const requestedUrls = [];

  const result = await waitForPackageState('http://127.0.0.1:12345', {
    timeoutMs: 1000,
    pollIntervalMs: 1,
    requestJson: async (url) => {
      requestedUrls.push(url);
      if (url.endsWith('/api/state')) {
        stateCalls += 1;
        if (stateCalls === 1) {
          return {
            statusCode: 202,
            json: { job: { id: 'job-1', status: 'running' } },
            body: '{"job":{"id":"job-1","status":"running"}}',
          };
        }
        return {
          statusCode: 200,
          json: statePayload,
          body: JSON.stringify(statePayload),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.equal(result.json, statePayload);
  assert.deepEqual(requestedUrls, [
    'http://127.0.0.1:12345/api/state',
    'http://127.0.0.1:12345/api/state',
  ]);
});

test('package smoke reports indexing failure after an initial 202 state response', async () => {
  let stateCalls = 0;
  await assert.rejects(waitForPackageState('http://127.0.0.1:12345', {
    timeoutMs: 1000,
    pollIntervalMs: 1,
    requestJson: async (url) => {
      if (url.endsWith('/api/state')) {
        stateCalls += 1;
        if (stateCalls === 1) {
          return {
            statusCode: 202,
            json: { job: { id: 'job-1', status: 'running' } },
            body: '{"job":{"id":"job-1","status":"running"}}',
          };
        }
        return {
          statusCode: 409,
          json: { error: 'Project not selected' },
          body: '{"error":"Project not selected"}',
        };
      }
      if (url.endsWith('/api/project/status?jobId=job-1')) {
        return {
          statusCode: 200,
          json: { job: { id: 'job-1', status: 'failed', error: 'synthetic failure' } },
          body: '{"job":{"id":"job-1","status":"failed","error":"synthetic failure"}}',
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }), /Indexing job failed during package smoke: synthetic failure/);
});
