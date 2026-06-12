'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
    const manifest = JSON.parse(result.stdout);
    return manifest[0].files.map((file) => file.path).sort();
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

test('package metadata exposes the session-analyzer CLI', () => {
  const pkg = require('../package.json');
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.license, 'BSD-3-Clause');
  assert.deepEqual(pkg.bin, { 'session-analyzer': './server.js' });
  assert.ok(server.startsWith('#!/usr/bin/env node'));
});

test('CLI help documents the npm command and host privacy option', () => {
  const result = run(process.execPath, ['server.js', '--help']);

  assert.match(result.stdout, /session-analyzer \[--repo <repo-path>\]/);
  assert.match(result.stdout, /--host <host>/);
  assert.match(result.stdout, /Binding to another host can expose transcript content/);
  assert.doesNotMatch(result.stdout, /node server\.js \[--repo/);
});

test('npm pack manifest contains only runtime package files', () => {
  const files = npmPackDryRunFiles();
  const fileSet = new Set(files);
  const required = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'README.zh-CN.md',
    'package.json',
    'public/assets/app.js',
    'public/favicon.ico',
    'public/index.html',
    'public/styles.css',
    'public/vendor/highlightjs/github.min.css',
    'public/vendor/highlightjs/highlight.min.js',
    'server.js',
    'src/codex-source.js',
    'src/codex.js',
    'src/folding.js',
    'src/shared/command-highlighting.js',
    'src/shared/folding.js',
    'src/shared/i18n.js',
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
  }

  const forbiddenFiles = new Set([
    'AGENTS.md',
    'restart-default.cmd',
  ]);
  for (const file of forbiddenFiles) {
    assert.equal(fileSet.has(file), false, `${file} should not be included in the package`);
  }
});
