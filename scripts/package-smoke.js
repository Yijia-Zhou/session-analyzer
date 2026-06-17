#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
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

async function launchPackagedServer(packagedServer, projectDir, codexHome, smokeRoot) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const port = await freePort();
    const child = childProcess.spawn(process.execPath, [
      packagedServer,
      '--repo', projectDir,
      '--codex-home', codexHome,
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
  return response.statusCode === 200
    && response.json
    && response.json.totals
    && Array.isArray(response.json.supportedLocales)
    && response.json.eventKinds
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
      env: { npm_config_cache: cacheDir },
    });
    const manifest = JSON.parse(pack.stdout);
    tarballPath = path.join(repoRoot, manifest[0].filename);

    const projectDir = path.join(smokeRoot, 'project');
    const codexHome = path.join(smokeRoot, 'codex-home');
    await fsp.mkdir(projectDir, { recursive: true });
    await fsp.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
    await fsp.writeFile(path.join(smokeRoot, 'package.json'), JSON.stringify({
      name: 'session-analyzer-package-smoke',
      version: '0.0.0',
      private: true,
    }, null, 2), 'utf8');

    run(npmCommand.command, [...npmCommand.prefixArgs, 'install', '--omit=dev', '--no-audit', '--no-fund', '--prefix', smokeRoot, tarballPath], {
      cwd: smokeRoot,
      env: { npm_config_cache: cacheDir },
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

    const packagedServer = path.join(smokeRoot, 'node_modules', 'session-analyzer', 'server.js');
    const launched = await launchPackagedServer(packagedServer, projectDir, codexHome, smokeRoot);
    child = launched.child;
    const baseUrl = `http://127.0.0.1:${launched.port}`;
    await waitForPackageState(baseUrl);
    const html = await requestText(`${baseUrl}/`);
    if (html.statusCode !== 200 || !html.body.includes('src="/assets/app.js"')) {
      throw new Error('Root HTML did not reference the generated browser bundle');
    }
    console.log('Package smoke passed.');
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
  waitForPackageState,
};
