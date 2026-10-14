'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { openViewerBrowser } = require('../src/history-browser-open');
const { runHistoryCli } = require('../src/history-cli');

const evidenceRef = 'er2.synthetic-running-browser';
const url = `http://127.0.0.1:17892/#ref=${evidenceRef}`;
const browserPath = path.join(__dirname, 'fixtures/history-browser-open/browser.cjs');
const launcherPath = path.join(__dirname, 'fixtures/history-browser-open/launcher.cjs');

async function browserFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'history-browser-open-'));
  const receiptPath = path.join(directory, 'receipt.json');
  let receipt;
  const readReceipt = async () => {
    try { receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return receipt;
  };
  t.after(async () => {
    const received = await readReceipt();
    if (received) {
      assert.ok(Number.isSafeInteger(received.pid) && received.pid > 0);
      try { process.kill(received.pid); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    directory, receiptPath,
    async received() {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const received = await readReceipt();
        if (received) return received;
        await delay(20);
      }
      assert.fail('Synthetic browser did not receive the URL.');
    },
  };
}

async function invokeCli(t, spawnProcess) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      producer: 'session-analyzer', operation: 'history.open', schemaVersion: 1,
      targetVerified: true, viewerReady: true, browserOpenRequested: false, url, evidenceRef,
      target: { sessionId: 'synthetic', layer: 'main', eventId: 'event1' },
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  let stdout = '';
  const code = await runHistoryCli(['open', '--endpoint', `http://127.0.0.1:${server.address().port}`, '--ref', evidenceRef], {
    stdout: { write(value) { stdout += value; } },
    openBrowser(value, ref) { return openViewerBrowser(value, ref, { platform: 'linux', spawn: spawnProcess }); },
  });
  return { code, result: JSON.parse(stdout) };
}

function assertRequested(response, received) {
  assert.equal(received.url, url);
  assert.doesNotThrow(() => process.kill(received.pid, 0), 'Browser must still be running when CLI reports success.');
  assert.equal(response.code, 0);
  assert.equal(response.result.browserOpenRequested, true);
  assert.deepEqual(response.result.browser, { status: 'requested' });
  assert.equal(response.result.url, url);
}

test('CLI reports delivery while a real synthetic browser continues running', { timeout: 20000 }, async t => {
  const fixture = await browserFixture(t);
  const response = await invokeCli(t, (command, args, options) => {
    assert.equal(command, 'gio');
    assert.deepEqual(args, ['open', url]);
    return spawn(process.execPath, [launcherPath, browserPath, fixture.receiptPath, url], options);
  });
  assertRequested(response, await fixture.received());
});

async function linuxDesktop(t, withHandler) {
  const fixture = await browserFixture(t);
  const data = path.join(fixture.directory, 'data');
  const config = path.join(fixture.directory, 'config');
  const applications = path.join(data, 'applications');
  await fs.mkdir(applications, { recursive: true });
  await fs.mkdir(config);
  const id = 'session-analyzer-synthetic-browser.desktop';
  const associations = `[Default Applications]\nx-scheme-handler/http=${id};\n[Added Associations]\nx-scheme-handler/http=${id};\n`;
  await fs.writeFile(path.join(config, 'mimeapps.list'), associations, 'utf8');
  await fs.writeFile(path.join(applications, 'mimeapps.list'), associations, 'utf8');
  if (withHandler) {
    const quote = value => `"${value.replace(/["\\`$]/gu, '\\$&')}"`.replaceAll('\\', '\\\\');
    await fs.writeFile(path.join(applications, id), [
      '[Desktop Entry]', 'Type=Application', 'Name=Synthetic browser', 'Terminal=false',
      `Exec=${[process.execPath, browserPath, fixture.receiptPath].map(quote).join(' ')} %u`,
      'MimeType=x-scheme-handler/http;', '',
    ].join('\n'), 'utf8');
  }
  return {
    ...fixture,
    spawn(command, args, options) {
      return spawn(command, args, { ...options, env: {
        ...process.env, XDG_DATA_HOME: data, XDG_DATA_DIRS: data,
        XDG_CONFIG_HOME: config, XDG_CONFIG_DIRS: config,
        XDG_CURRENT_DESKTOP: 'SessionAnalyzerTest', GTK_USE_PORTAL: '0',
        // The synthetic handler does not connect to a display; this also lets
        // the previous xdg-open path reproduce its attached .desktop launch.
        DISPLAY: ':session-analyzer-test', WAYLAND_DISPLAY: '',
      } });
    },
  };
}

test('Linux gio returns successful delivery before the .desktop handler exits', {
  skip: process.platform !== 'linux', timeout: 20000,
}, async t => {
  const desktop = await linuxDesktop(t, true);
  const response = await invokeCli(t, desktop.spawn);
  assertRequested(response, await desktop.received());
});

test('Linux gio reports a missing default handler and retains the verified URL', {
  skip: process.platform !== 'linux', timeout: 20000,
}, async t => {
  const desktop = await linuxDesktop(t, false);
  const { code, result } = await invokeCli(t, desktop.spawn);
  assert.equal(code, 1);
  assert.equal(result.targetVerified, true);
  assert.equal(result.viewerReady, true);
  assert.equal(result.url, url);
  assert.equal(result.browserOpenRequested, false);
  assert.equal(result.browser.status, 'failed');
  assert.equal(result.browser.code, 'BROWSER_OPEN_FAILED');
  assert.match(result.browser.message, /Browser opener exited with [1-9]/u);
});
