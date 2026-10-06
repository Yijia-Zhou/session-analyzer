'use strict';

// Source contract: DeepSeek 639ed015 shell/bash/pwsh renderers. Callers prove
// unique direct/PTC ownership before interpreting this model-facing result.
function deepSeekShellResult(name, args, content, isError = false) {
  if (!['bash', 'pwsh'].includes(name) || !args || typeof args.command !== 'string'
      || !Array.isArray(content) || content.length !== 1
      || content[0]?.type !== 'text' || typeof content[0].text !== 'string' || isError) return null;
  const text = content[0].text;
  if (args.run_in_background === true) return { status: 'incomplete' };
  const promoted = /(?:^|\n)\[still running after \d+ms; moved to background job [^\]\n]+\]\nThe command keeps running in the background\. You will be notified when it finishes; read newer output with job_output, stop it with job_kill\.$/;
  if (promoted.test(text)) return { status: 'incomplete' };

  // Only the terminal suffix is the renderer's status grammar. Never scan
  // arbitrary body text or trim away a newline that changes its meaning.
  let body = text;
  let status = text ? 'success' : 'completed';
  let exitCode;
  const exit = /\n\[exit code: (-?\d+)\]$/.exec(body);
  const signal = /\n\[killed by signal: [^\]\n]+\]$/.exec(body);
  if (exit) {
    const code = Number(exit[1]);
    if (!Number.isSafeInteger(code) || String(code) !== exit[1]) return { status: 'completed' };
    exitCode = code;
    status = code === 0 ? 'success' : 'failed';
    body = body.slice(0, exit.index);
  } else if (signal) {
    status = 'failed';
    body = body.slice(0, signal.index);
  } else if (/\n\[exit code: [^\]\n]+\]$/.test(body)) {
    status = 'completed';
    body = body.slice(0, body.lastIndexOf('\n'));
  }
  const stopped = /\n\[stopped: [^\]\n]+\]$/.exec(body);
  if (stopped) { status = 'interrupted'; body = body.slice(0, stopped.index); }
  // A command can trap termination and exit zero after its timeout.
  if (/\n\[timed out after \d+ms\]$/.test(body) && !stopped) status = 'failed';
  return { status, ...(exitCode !== undefined ? { exitCode } : {}) };
}

module.exports = { deepSeekShellResult };
