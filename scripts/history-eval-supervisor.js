'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { identifier, privateTarget } = require('./history-eval-common');

// This owns only children started through start(). It neither starts a service in
// advance nor treats a disappearing process as proof of sandbox cleanup.
function createSupervisor({ directory, identity = null, journalName = 'lifecycle.jsonl', cleanupTimeoutMs = 5000 }) {
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) throw new Error('Invalid cleanup timeout');
  directory = privateTarget(directory);
  fs.mkdirSync(directory, { recursive: true });
  if (path.basename(journalName) !== journalName) throw new Error('Journal name must be a basename');
  const journalPath = privateTarget(path.join(directory, journalName));
  const journal = fs.openSync(journalPath, 'wx');
  const owned = new Map();
  const began = performance.now();
  let closed = false;
  let closing = null;
  const write = (event, id = null, detail = {}) => {
    if (closed) throw new Error('Supervisor is closed');
    fs.writeSync(journal, `${JSON.stringify({ schemaVersion: 1, identity, at: new Date().toISOString(),
      elapsedMs: performance.now() - began, event, id, ...detail })}\n`);
  };
  write('supervisor_started', null, { pid: process.pid, platform: process.platform, node: process.version });

  function start({ id, command, args = [], cwd = process.cwd(), env = process.env,
    input, timeoutMs = null, onStdout, onStderr }) {
    if (closed || closing || !identifier(id) || owned.has(id)) throw new Error('Supervisor requires an open instance and a fresh process id');
    if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('Invalid child command');
    if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw new Error('Invalid child timeout');
    const stdoutPath = privateTarget(path.join(directory, `${id}.stdout`));
    const stderrPath = privateTarget(path.join(directory, `${id}.stderr`));
    const stdoutFd = fs.openSync(stdoutPath, 'wx');
    let stderrFd;
    try { stderrFd = fs.openSync(stderrPath, 'wx'); } catch (error) { fs.closeSync(stdoutFd); throw error; }
    const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
    const counts = { stdout: 0, stderr: 0 };
    const started = performance.now();
    const state = { child: null, completed: null, exited: false, settled: false, timer: null,
      timedOut: false, stopReason: null, spawnError: null, captureError: null, cleanupError: null, stdoutPath, stderrPath };
    owned.set(id, state);
    write('start_requested', id, { command, args, cwd: path.resolve(cwd), timeoutMs,
      parentPid: process.pid, stdin: input === undefined ? 'open_pipe' : 'provided_then_closed',
      stdoutPath, stderrPath });
    let resolveCompleted;
    state.completed = new Promise((resolve) => { resolveCompleted = resolve; });
    const finish = (exitCode, signal) => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(state.timer);
      fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
      const result = { id, pid: state.child?.pid ?? null, exitCode, signal, elapsedMs: performance.now() - started,
        timedOut: state.timedOut, stopReason: state.stopReason, spawnError: state.spawnError, captureError: state.captureError, cleanupError: state.cleanupError,
        stdoutPath, stderrPath, stdoutBytes: counts.stdout, stderrBytes: counts.stderr,
        stdoutSha256: hashes.stdout.digest('hex'), stderrSha256: hashes.stderr.digest('hex'),
        captureComplete: !state.spawnError && !state.captureError && !state.cleanupError };
      write('closed', id, result);
      resolveCompleted(result);
    };
    try {
      state.child = spawn(command, args, { cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      state.spawnError = { code: error.code || null, message: error.message };
      write('spawn_error', id, { error: state.spawnError });
      finish(null, null);
      return state;
    }
    const child = state.child;
    state.finish = finish;
    child.once('spawn', () => write('started', id, { pid: child.pid }));
    child.on('error', (error) => {
      if (state.settled) return;
      state.spawnError = { code: error.code || null, message: error.message };
      write('process_error', id, { error: state.spawnError });
    });
    child.stdin.on('error', (error) => { if (!state.settled) write('stdin_error', id, { code: error.code || null, message: error.message }); });
    for (const [name, fd, callback] of [['stdout', stdoutFd, onStdout], ['stderr', stderrFd, onStderr]]) {
      child[name].on('data', (bytes) => {
        if (state.settled) return;
        try {
          fs.writeSync(fd, bytes); hashes[name].update(bytes); counts[name] += bytes.length;
          if (callback) callback(bytes);
        } catch (error) {
          state.captureError = { stream: name, code: error.code || null, message: error.message };
          write('capture_error', id, { error: state.captureError });
          void stop(id, 'capture_error');
        }
      });
      child[name].on('error', (error) => {
        if (state.settled) return;
        state.captureError = { stream: name, code: error.code || null, message: error.message };
        write('capture_error', id, { error: state.captureError });
        void stop(id, 'capture_error');
      });
    }
    child.once('exit', (exitCode, signal) => {
      state.exited = true;
      if (state.settled) return;
      write('exited', id, { exitCode, signal, elapsedMs: performance.now() - started,
        stopReason: state.stopReason, cause: state.stopReason || 'not_inferred' });
    });
    child.once('close', finish);
    if (input !== undefined) child.stdin.end(input);
    if (timeoutMs !== null) state.timer = setTimeout(() => {
      state.timedOut = true;
      write('timeout', id, { timeoutMs });
      void stop(id, 'timeout');
    }, timeoutMs);
    return state;
  }

  function mark(id, event, details = {}) {
    const state = owned.get(id);
    if (!state || state.settled || !['ready', 'indexing_complete', 'scope_verified', 'first_evidence'].includes(event)) throw new Error('Invalid lifecycle mark');
    write(event, id, { details });
  }

  async function stop(id, reason = 'cleanup') {
    const state = owned.get(id);
    if (!state) throw new Error('Cannot stop an unowned process');
    if (state.stopping) return state.stopping;
    if (state.settled) return state.completed;
    state.stopReason = reason;
    write('cleanup_requested', id, { pid: state.child?.pid ?? null, reason });
    state.stopping = (async () => {
      const pid = state.child?.pid;
      // Do not signal an already exited PID: Windows may have reused it. The
      // exited parent's descendants cannot be identified reliably afterward.
      if (pid && !state.exited) {
        if (process.platform === 'win32') {
          const result = await new Promise((resolve) => {
            const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore', timeout: cleanupTimeoutMs });
            killer.once('error', (error) => resolve({ exitCode: null, error: error.message }));
            killer.once('close', (exitCode) => resolve({ exitCode }));
          });
          write('cleanup_signal', id, { method: 'taskkill-owned-tree', ...result });
          if (result.exitCode !== 0 && !state.exited) state.child.kill();
        } else {
          try { process.kill(-pid, 'SIGKILL'); write('cleanup_signal', id, { method: 'owned-process-group', signal: 'SIGKILL' }); }
          catch (error) { write('cleanup_signal', id, { method: 'owned-process-group', error: error.message }); if (!state.exited) state.child.kill('SIGKILL'); }
        }
      }
      let cleanupTimer;
      const settled = await Promise.race([state.completed.then(() => true), new Promise((resolve) => {
        cleanupTimer = setTimeout(() => resolve(false), cleanupTimeoutMs);
      })]);
      clearTimeout(cleanupTimer);
      if (!settled) {
        state.cleanupError = { code: 'CLEANUP_UNCONFIRMED', message: 'Owned process or inherited pipes did not close within cleanup deadline; descendants are not assumed reaped.' };
        write('cleanup_unconfirmed', id, { error: state.cleanupError, exited: state.exited });
        state.child.stdin.destroy(); state.child.stdout.destroy(); state.child.stderr.destroy();
        state.child.unref();
        state.finish(state.child.exitCode, state.child.signalCode);
      }
      return state.completed;
    })();
    return state.stopping;
  }

  function close(reason = 'supervisor_close') {
    if (closing) return closing;
    if (closed) return Promise.resolve();
    closing = (async () => {
      await Promise.all([...owned.keys()].map((id) => stop(id, reason)));
      write('supervisor_closed');
      closed = true;
      fs.closeSync(journal);
    })();
    return closing;
  }

  return { start, mark, stop, close, journalPath };
}

module.exports = { createSupervisor };
