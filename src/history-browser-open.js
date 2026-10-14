'use strict';

const { spawn } = require('node:child_process');

function invalidResponse() {
  return Object.assign(new Error('Expected a loopback viewer URL containing the verified evidence reference.'), { code: 'INVALID_RESPONSE' });
}

function validateViewerUrl(value, evidenceRef) {
  let url;
  try { url = new URL(value); } catch { throw invalidResponse(); }
  if (typeof evidenceRef !== 'string' || !/^er[12]\./u.test(evidenceRef) || evidenceRef.length > 8192
      || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || url.username || url.password || url.pathname !== '/' || url.search) throw invalidResponse();
  const params = new URLSearchParams(url.hash.slice(1));
  if ([...params].length !== 1 || params.get('ref') !== evidenceRef) throw invalidResponse();
  return url.href;
}

// URL data is passed as an argument or environment value, never interpolated
// into shell source. An exit of zero confirms invocation, not page navigation.
function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:SESSION_ANALYZER_VIEWER_URL -ErrorAction Stop'],
    env: { ...process.env, SESSION_ANALYZER_VIEWER_URL: url },
  };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  // gio acknowledges the launch request without waiting for the application
  // to exit. xdg-open may stay attached to a successfully launched browser.
  if (platform === 'linux') return { command: 'gio', args: ['open', url] };
  return { command: 'xdg-open', args: [url] };
}

async function openViewerBrowser(value, evidenceRef, options = {}) {
  const url = validateViewerUrl(value, evidenceRef);
  const { command, args, env } = browserCommand(url, options.platform);
  const spawnProcess = options.spawn || spawn;
  await new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    let child;
    try {
      child = spawnProcess(command, args, { shell: false, windowsHide: true, stdio: 'ignore', ...(env ? { env } : {}) });
    } catch (error) { done(error); return; }
    child.once('error', done);
    child.once('exit', (code, signal) => done(code === 0 ? null : new Error(`Browser opener exited with ${signal || code}.`)));
    timer = setTimeout(() => {
      child.kill();
      done(new Error('Browser opener timed out; use the returned URL.'));
    }, options.timeoutMs ?? 10000);
  });
}

module.exports = { browserCommand, openViewerBrowser, validateViewerUrl };
