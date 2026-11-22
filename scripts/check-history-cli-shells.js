#!/usr/bin/env node
'use strict';

// This check calls npm's installed shell entries, not Node with an argv array.
// Its loopback service only echoes synthetic inputs; it never indexes a source.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHistoryServer } = require('../src/history-server');

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const shQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const shPath = (value) => process.platform === 'win32'
  ? value.replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/') : value;

async function runShell(shell, script, cwd) {
  const args = shell.kind === 'powershell'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
    : [shPath(script)];
  return new Promise((resolve, reject) => {
    const child = spawn(shell.exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        cleanup.on('error', () => child.kill('SIGKILL'));
      } else child.kill('SIGKILL');
    }, 60000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || code !== 0) reject(new Error(`${shell.id} failed (${timedOut ? 'timeout' : code || signal}): ${stderr}\n${stdout}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function check({ binDir, output, shells }) {
  const packageRoot = path.resolve(binDir, '..', 'session-analyzer');
  const installedCli = path.join(packageRoot, 'src', 'history-cli.js');
  assert.ok(fs.statSync(installedCli).isFile(), 'Use the .bin directory of an installed session-analyzer package.');
  const tempParent = await fsp.realpath(os.tmpdir());
  const temp = await fsp.mkdtemp(path.join(tempParent, 'history-cli-shells-'));
  const cases = [];
  const calls = [];
  const server = createHistoryServer({ async execute(operation, input) {
    calls.push({ operation, input });
    return { producer: 'session-analyzer', schemaVersion: 1, operation: `history.${operation}`, received: input };
  } });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const inputFile = path.join(temp, '输入 file.json');
    const jsonInput = { queries: ['中文 "quotes" \\path\n$HOME $(literal) `text`', "apostrophe ' and 😀"], exclude: ['--help'], limit: 3 };
    await fsp.writeFile(inputFile, '\ufeff' + JSON.stringify(jsonInput), 'utf8');
    const flagsInput = { refs: ['er2.synthetic'], contextRef: 'hc1.synthetic', aroundHit: { before: 0, after: 1499 } };
    const backwardInput = { refs: ['er2.synthetic'], mode: 'content', parts: ['projection'], endOffset: 180, length: 42 };
    const rawInput = { refs: ['er2.synthetic'], parts: ['raw'], rawOffset: 7 };
    const ordinaryInput = { queries: ['中文 two words'], exclude: ['--help'] };
    const expectations = [flagsInput, backwardInput, rawInput, ordinaryInput, jsonInput, jsonInput];
    for (const shell of shells) {
      const powershell = shell.kind === 'powershell';
      const quote = powershell ? psQuote : shQuote;
      const entry = path.join(binDir, powershell ? 'session-analyzer.ps1' : 'session-analyzer');
      assert.ok(fs.statSync(entry).isFile(), `Missing installed entry ${entry}`);
      const command = (...args) => [powershell ? '&' : '', quote(powershell ? entry : shPath(entry)),
        ...args.map(quote)].filter(Boolean).join(' ');
      const base = (operation) => ['history', operation, '--endpoint', endpoint];
      const lines = powershell ? [
        "$ErrorActionPreference = 'Stop'",
        '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
        '$OutputEncoding = [Console]::OutputEncoding',
        "Write-Output ('__SHELL_VERSION__' + $PSVersionTable.PSVersion.ToString())",
      ] : ['set -eu', "printf '__SHELL_VERSION__%s\\n' \"${BASH_VERSION:-POSIX sh}\""];
      const append = (line) => {
        lines.push(line);
        if (powershell) lines.push('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }');
      };
      append(command(...base('read'), '--ref', 'er2.synthetic', '--context', 'hc1.synthetic', '--around-hit-before', '0', '--around-hit-after', '1499'));
      append(command(...base('read'), '--ref', 'er2.synthetic', '--mode', 'content', '--parts', 'projection', '--end-offset', '180', '--length', '42'));
      append(command(...base('read'), '--ref', 'er2.synthetic', '--parts', 'raw', '--raw-offset', '7'));
      append(command(...base('search'), '--query', '中文 two words', '--exclude', '--help'));
      append(command(...base('search'), '--input-file', inputFile.replace(/\\/g, '/')));
      append(powershell
        ? `Get-Content -LiteralPath ${quote(inputFile)} -Encoding UTF8 -Raw | ${command(...base('search'), '--input-file', '-')}`
        : `${command(...base('search'), '--input-file', '-')} < ${quote(shPath(inputFile))}`);
      const script = path.join(temp, shell.id + (powershell ? '.ps1' : '.sh'));
      await fsp.writeFile(script, (powershell ? '\ufeff' : '') + lines.join('\n') + '\n', 'utf8');
      const result = await runShell(shell, script, temp);
      const outputLines = result.stdout.trim().split(/\r?\n/);
      assert.match(outputLines.shift(), /^__SHELL_VERSION__/);
      assert.equal(outputLines.length, expectations.length, `${shell.id}: number of actual CLI results`);
      outputLines.forEach((line, index) => assert.deepEqual(JSON.parse(line).received, expectations[index], `${shell.id}: case ${index + 1}`));
      cases.push({ shell: shell.id, executable: shell.exe, entry, cases: expectations.length,
        version: result.stdout.match(/__SHELL_VERSION__([^\r\n]+)/)?.[1], pass: true, stderr: result.stderr });
    }
    assert.equal(calls.length, expectations.length * shells.length);
    const report = { observedAt: new Date().toISOString(), node: process.version, platform: process.platform,
      installedPackage: packageRoot, installedCliSha256: crypto.createHash('sha256').update(fs.readFileSync(installedCli)).digest('hex'),
      evidence: 'Actual installed CLI shell entries against a synthetic loopback echo service; no source indexing or model run.',
      cases, calls: calls.length, passed: true };
    if (output) await fsp.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), tempParent, 'Cleanup must stay in the allocated temporary parent.');
    assert.match(path.basename(resolved), /^history-cli-shells-/);
    await fsp.rm(resolved, { recursive: true, force: true });
  }
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--bin-dir', '--output', '--powershell', '--pwsh', '--sh'].includes(args[i]) && args[i + 1], 'Use --bin-dir DIR [--output FILE] [--powershell EXE] [--pwsh EXE] [--sh EXE]');
    assert.equal(options[args[i]], undefined, 'Options must not be repeated');
    options[args[i]] = args[i + 1];
  }
  assert.ok(options['--bin-dir'], '--bin-dir is required');
  const shells = process.platform === 'win32' ? [
    { id: 'windows-powershell', kind: 'powershell', exe: options['--powershell'] || path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
    { id: 'powershell-7', kind: 'powershell', exe: options['--pwsh'] || 'pwsh.exe' },
    { id: 'git-bash', kind: 'sh', exe: options['--sh'] || path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') },
  ] : [{ id: 'posix-sh', kind: 'sh', exe: options['--sh'] || '/bin/sh' }];
  return check({ binDir: path.resolve(options['--bin-dir']), output: options['--output'], shells });
}

if (require.main === module) main(process.argv.slice(2)).then((report) => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { check };
