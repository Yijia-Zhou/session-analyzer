#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const packageMetadata = require('../package.json');

const repoRoot = path.join(__dirname, '..');
const packageRegistry = packageMetadata.publishConfig?.registry;
if (!packageRegistry) {
  throw new Error('package publishConfig.registry is required for package smoke');
}
const npmCommand = process.platform === 'win32'
  ? { command: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'npm'] }
  : { command: 'npm', prefixArgs: [] };

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    shell: options.shell || false,
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

function normalizePackManifest(manifest) {
  const entries = Array.isArray(manifest)
    ? manifest
    : manifest && typeof manifest === 'object'
      ? Object.values(manifest)
      : [];
  if (entries.length !== 1 || !entries[0] || typeof entries[0].filename !== 'string') {
    throw new TypeError('npm pack --json must describe exactly one package artifact');
  }
  return entries[0];
}

function binCommand(bin, args) {
  if (process.platform !== 'win32') {
    return { command: bin, args, options: {} };
  }
  const quotePowerShellArg = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const commandLine = ['&', quotePowerShellArg(bin), ...args.map(quotePowerShellArg)].join(' ');
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      commandLine,
    ],
    options: {},
  };
}

async function removeTree(target) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fsp.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code) || attempt === 19) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function stopChild(child) {
  if (!child) return;
  if (process.platform === 'win32') {
    childProcess.spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  } else {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function launchPackagedServer(packagedServer, smokeRoot, serverArgs) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const port = await freePort();
    const child = childProcess.spawn(process.execPath, [
      packagedServer,
      ...serverArgs,
      '--port', String(port),
    ], {
      cwd: smokeRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

    try {
      await waitForHttp(`http://127.0.0.1:${port}/`);
      return { child, port };
    } catch (error) {
      lastError = error;
      await stopChild(child);
    }
  }
  throw lastError;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForHttp(url, timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.setTimeout(1000, () => {
        req.destroy(new Error('request timed out'));
      });
      req.on('error', retry);
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 250);
    };

    attempt();
  });
}

function requestText(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out requesting ${url}`));
    });
    req.on('error', reject);
  });
}

async function requestJson(url) {
  const response = await requestText(url);
  return {
    ...response,
    json: JSON.parse(response.body),
  };
}

function isPackageStatePayload(response) {
  const sourceKind = response?.json?.sourceKind;
  const sourcePresentationShape = sourceKind === 'codex'
    ? Array.isArray(response.json.codeModeRequests)
    : (sourceKind === 'claude-code' || sourceKind === 'deepseek-harness')
      && !Object.hasOwn(response.json, 'codeModeRequests');
  return response.statusCode === 200
    && response.json
    && ['codex', 'claude-code', 'deepseek-harness'].includes(sourceKind)
    && response.json.totals
    && Array.isArray(response.json.supportedLocales)
    && response.json.eventKinds
    && sourcePresentationShape
    && response.json.projectSelected === true;
}

function summarizeResponse(response) {
  if (!response) return 'no response';
  const body = response.body || JSON.stringify(response.json || {});
  return `${response.statusCode} ${body.slice(0, 500)}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPackageState(baseUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const pollIntervalMs = options.pollIntervalMs || 100;
  const requestJsonImpl = options.requestJson || requestJson;
  const started = Date.now();
  let lastState = null;
  let jobId = '';

  while (Date.now() - started <= timeoutMs) {
    lastState = await requestJsonImpl(`${baseUrl}/api/state`);
    if (isPackageStatePayload(lastState)) return lastState;

    const job = lastState.json?.job;
    if (lastState.statusCode === 202 && job && typeof job.id === 'string') {
      jobId = job.id;
      if (job.status === 'failed') {
        throw new Error(`Indexing job failed during package smoke: ${job.error || 'unknown error'}`);
      }
      if (job.status === 'cancelled') {
        throw new Error(`Indexing job was cancelled during package smoke: ${job.error || 'cancelled'}`);
      }
    } else if (jobId) {
      const status = await requestJsonImpl(`${baseUrl}/api/project/status?jobId=${encodeURIComponent(jobId)}`);
      const statusJob = status.json?.job;
      if (statusJob?.status === 'failed') {
        throw new Error(`Indexing job failed during package smoke: ${statusJob.error || 'unknown error'}`);
      }
      if (statusJob?.status === 'cancelled') {
        throw new Error(`Indexing job was cancelled during package smoke: ${statusJob.error || 'cancelled'}`);
      }
      if (statusJob?.status === 'succeeded' && status.json.state) {
        const stateResponse = {
          statusCode: 200,
          headers: status.headers,
          body: JSON.stringify(status.json.state),
          json: status.json.state,
        };
        if (isPackageStatePayload(stateResponse)) return stateResponse;
      }
    }

    await wait(pollIntervalMs);
  }

  throw new Error(`/api/state did not reach the expected package smoke JSON shape within ${timeoutMs}ms; last response: ${summarizeResponse(lastState)}`);
}

async function main() {
  let cacheDir = null;
  let smokeRoot = null;
  let tarballPath = null;
  let child = null;

  try {
    cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-npm-cache-'));
    smokeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'session analyzer package smoke-'));

    const pack = run(npmCommand.command, [...npmCommand.prefixArgs, 'pack', '--json'], {
      env: {
        npm_config_cache: cacheDir,
        npm_config_dry_run: 'false',
        npm_config_registry: packageRegistry,
      },
    });
    const manifest = normalizePackManifest(JSON.parse(pack.stdout));
    tarballPath = path.join(repoRoot, manifest.filename);

    const projectDir = path.join(smokeRoot, 'project');
    const codexHome = path.join(smokeRoot, 'codex-home');
    const claudeHome = path.join(smokeRoot, 'claude-home');
    const dshHome = path.join(smokeRoot, 'dsh-sessions');
    const claudeContainer = path.join(claudeHome, 'projects', '-package-smoke');
    const claudeSessionId = '11111111-1111-4111-8111-111111111111';
    await fsp.mkdir(projectDir, { recursive: true });
    await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
    await fsp.mkdir(claudeContainer, { recursive: true });
    const dshSessionDir = path.join(dshHome, '-package-smoke-project-', 'session-package-smoke');
    await fsp.mkdir(dshSessionDir, { recursive: true });
    const claudeBase = {
      isSidechain: false,
      userType: 'external',
      entrypoint: 'cli',
      cwd: projectDir,
      sessionId: claudeSessionId,
      version: '2.1.220',
      gitBranch: 'main',
    };
    const claudeRecords = [
      {
        ...claudeBase,
        parentUuid: null,
        type: 'mode',
        mode: 'normal',
        uuid: 'package-smoke-mode',
        timestamp: '2026-08-03T00:00:00.000Z',
      },
      {
        ...claudeBase,
        parentUuid: 'package-smoke-mode',
        promptId: 'package-smoke-prompt',
        type: 'user',
        message: { role: 'user', content: 'Verify the installed Claude Code adapter.' },
        uuid: 'package-smoke-user',
        timestamp: '2026-08-03T00:00:01.000Z',
      },
    ];
    await fsp.writeFile(
      path.join(claudeContainer, `${claudeSessionId}.jsonl`),
      `${claudeRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
      'utf8',
    );
    const dshSessionId = 'session-package-smoke';
    const dshRecords = [
      {
        type: 'session', version: 0, id: dshSessionId, createdAt: 1,
        cwd: projectDir, delegationDepth: 0,
      },
      { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 3, data: { turn: 1, step: 1 } },
      {
        type: 'user/message', seq: 2, time: 4, surfaceOp: 'append',
        data: {
          role: 'user', source: { kind: 'user' },
          id: 'package-smoke-user-message',
          content: [{ type: 'text', text: 'Verify the installed DeepSeek Harness adapter.' }],
        },
      },
      {
        type: 'assistant/message', seq: 3, time: 5, surfaceOp: 'append',
        data: {
          turn: 1, step: 1,
          message: {
            role: 'assistant',
            source: { kind: 'model', provider: 'smoke', model: 'smoke-model' },
            id: 'package-smoke-assistant-message',
            content: [{ type: 'text', text: 'DeepSeek Harness package smoke passed.' }],
          },
        },
      },
      { type: 'step/end', seq: 4, time: 6, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
    ];
    await fsp.writeFile(
      path.join(dshSessionDir, 'session.jsonl'),
      `${dshRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
      'utf8',
    );
    await fsp.writeFile(path.join(smokeRoot, 'package.json'), JSON.stringify({
      name: 'session-analyzer-package-smoke',
      version: '0.0.0',
      private: true,
    }, null, 2), 'utf8');

    run(npmCommand.command, [...npmCommand.prefixArgs, 'install', '--omit=dev', '--no-audit', '--no-fund', '--prefix', smokeRoot, tarballPath], {
      cwd: smokeRoot,
      env: {
        npm_config_cache: cacheDir,
        npm_config_dry_run: 'false',
        npm_config_registry: packageRegistry,
      },
    });

    const bin = process.platform === 'win32'
      ? path.join(smokeRoot, 'node_modules', '.bin', 'session-analyzer.cmd')
      : path.join(smokeRoot, 'node_modules', '.bin', 'session-analyzer');
    const helpCommand = binCommand(bin, ['--help']);
    const help = run(helpCommand.command, helpCommand.args, {
      cwd: smokeRoot,
      ...helpCommand.options,
    });
    if (!help.stdout.includes('session-analyzer [--repo <repo-path>]')) {
      throw new Error('Installed CLI help did not include the expected usage line');
    }
    if (!help.stdout.includes('--source <source>')) {
      throw new Error('Installed CLI help did not include transcript source selection');
    }

    const packagedServer = path.join(smokeRoot, 'node_modules', 'session-analyzer', 'server.js');
    let launched = await launchPackagedServer(packagedServer, smokeRoot, [
      '--repo', projectDir,
      '--codex-home', codexHome,
    ]);
    child = launched.child;
    let baseUrl = `http://127.0.0.1:${launched.port}`;
    const codexState = await waitForPackageState(baseUrl);
    if (codexState.json.sourceKind !== 'codex') {
      throw new Error(`Installed Codex package smoke reported unexpected sourceKind: ${codexState.json.sourceKind}`);
    }
    let html = await requestText(`${baseUrl}/`);
    if (html.statusCode !== 200 || !html.body.includes('src="/assets/app.js"')) {
      throw new Error('Installed Codex root HTML did not reference the generated browser bundle');
    }

    await stopChild(child);
    child = null;
    launched = await launchPackagedServer(packagedServer, smokeRoot, [
      '--source', 'claude-code',
      '--repo', projectDir,
      '--claude-home', claudeHome,
    ]);
    child = launched.child;
    baseUrl = `http://127.0.0.1:${launched.port}`;
    const claudeState = await waitForPackageState(baseUrl);
    if (claudeState.json.sourceKind !== 'claude-code') {
      throw new Error(`Installed Claude package smoke reported unexpected sourceKind: ${claudeState.json.sourceKind}`);
    }
    if (claudeState.json.totals.sessionCount !== 1) {
      throw new Error(`Installed Claude package smoke expected one indexed Session, received: ${claudeState.json.totals.sessionCount}`);
    }
    html = await requestText(`${baseUrl}/`);
    if (html.statusCode !== 200 || !html.body.includes('src="/assets/app.js"')) {
      throw new Error('Installed Claude root HTML did not reference the generated browser bundle');
    }

    await stopChild(child);
    child = null;
    launched = await launchPackagedServer(packagedServer, smokeRoot, [
      '--source', 'deepseek-harness',
      '--repo', projectDir,
      '--dsh-home', dshHome,
    ]);
    child = launched.child;
    baseUrl = `http://127.0.0.1:${launched.port}`;
    const dshState = await waitForPackageState(baseUrl);
    if (dshState.json.sourceKind !== 'deepseek-harness') {
      throw new Error(`Installed DeepSeek Harness package smoke reported unexpected sourceKind: ${dshState.json.sourceKind}`);
    }
    if (dshState.json.totals.sessionCount !== 1) {
      throw new Error(`Installed DeepSeek Harness package smoke expected one indexed Session, received: ${dshState.json.totals.sessionCount}`);
    }
    html = await requestText(`${baseUrl}/`);
    if (html.statusCode !== 200 || !html.body.includes('src="/assets/app.js"')) {
      throw new Error('Installed DeepSeek Harness root HTML did not reference the generated browser bundle');
    }
    console.log('Codex, Claude Code, and DeepSeek Harness package smoke passed.');
  } finally {
    await stopChild(child);
    if (tarballPath) {
      await fsp.rm(tarballPath, { force: true });
    }
    if (smokeRoot) await removeTree(smokeRoot);
    if (cacheDir) await removeTree(cacheDir);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  isPackageStatePayload,
  normalizePackManifest,
  packageRegistry,
  waitForPackageState,
};
