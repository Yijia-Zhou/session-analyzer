'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { isCredentialEnvironmentName } = require('../scripts/release-automation');

function npm(args, cwd, env) {
  const windows = process.platform === 'win32';
  return spawnSync(windows ? (process.env.ComSpec || 'cmd.exe') : 'npm', windows ? ['/d', '/s', '/c', 'npm', ...args] : args, {
    cwd, env, encoding: 'utf8', timeout: 30000,
  });
}

test('pinned npm directory dry-run executes prepublishOnly exactly once and propagates its failure', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-guard-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('session-analyzer-guard-test-'));
    await fsp.rm(directory, { recursive: true, force: true });
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !isCredentialEnvironmentName(name) && !name.toUpperCase().startsWith('NPM_CONFIG_')));
  Object.assign(env, {
    NPM_CONFIG_USERCONFIG: path.join(directory, 'user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(directory, 'global.npmrc'),
    NPM_CONFIG_CACHE: path.join(directory, 'cache'),
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    // npm still looks up metadata during dry-run; keep the empty-cache fixture offline.
    NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_LOGLEVEL: 'error',
  });
  await Promise.all(['user.npmrc', 'global.npmrc'].map(filename => fsp.writeFile(path.join(directory, filename), '')));
  const version = npm(['--version'], directory, env);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), require('../package.json').devEngines.packageManager.version);
  await fsp.writeFile(path.join(directory, 'package.json'), JSON.stringify({
    name: 'session-analyzer-synthetic-lifecycle-check', version: '0.0.0',
    files: ['guard.js'], scripts: { prepublishOnly: 'node guard.js' },
  }));
  await fsp.writeFile(path.join(directory, 'guard.js'), [
    "require('node:fs').appendFileSync('guard-calls.txt', 'called\\n');",
    "if (process.env.SYNTHETIC_GUARD_FAILURE === '1') process.exit(42);",
  ].join('\n'));
  // Fixed dry-run arguments and isolated empty configs: this test never publishes.
  const args = ['publish', '--dry-run', '--foreground-scripts', '--tag=latest', '--access=public', '--registry=https://registry.npmjs.org/'];
  for (const fails of [false, true]) {
    await fsp.rm(path.join(directory, 'guard-calls.txt'), { force: true });
    const result = npm(args, directory, { ...env, SYNTHETIC_GUARD_FAILURE: fails ? '1' : '0' });
    assert.ifError(result.error);
    assert.equal(result.status, fails ? 42 : 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(await fsp.readFile(path.join(directory, 'guard-calls.txt'), 'utf8'), 'called\n');
    assert.equal((await fsp.readdir(directory)).some(name => name.endsWith('.tgz')), false);
  }
});
