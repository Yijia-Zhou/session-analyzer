'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { parseHistoryArgs, runHistoryCli } = require('../src/history-cli');
const { browserCommand, openViewerBrowser, validateViewerUrl } = require('../src/history-browser-open');

const evidenceRef = 'er2.synthetic-reference';
const url = `http://127.0.0.1:17892/#ref=${evidenceRef}`;

async function endpointFixture(t, extra = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ route: req.url, input: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ producer: 'session-analyzer', operation: 'history.open', schemaVersion: 1,
      targetVerified: true, viewerReady: true, browserOpenRequested: false, url, evidenceRef,
      target: { sessionId: 'synthetic', layer: 'main', eventId: 'event1' }, ...extra }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, calls };
}

test('open parses a single reference with an optional valueless no-browser flag', () => {
  const parsed = parseHistoryArgs(['open', '--no-browser', '--context', 'hc1.sample', '--ref', 'hr1.sample']);
  assert.equal(parsed.noBrowser, true);
  assert.deepEqual(parsed.input, { contextRef: 'hc1.sample', refs: ['hr1.sample'] });
  assert.equal(parseHistoryArgs(['open', '--ref', evidenceRef, '--no-browser']).noBrowser, true);
  for (const args of [
    ['open'], ['open', '--ref', 'a', '--ref', 'b'], ['search', '--no-browser'],
    ['open', '--ref', 'a', '--no-browser', '--no-browser'], ['open', '--ref', 'a', '--no-browser', 'true'],
    ['open', '--ref', 'a', '--query', 'phrase'], ['open', '--ref', 'a', '--presentation', 'compact'],
    ['open', '--ref', 'a', '--max-bytes', '8000'],
    ['open', '--input', '{"refs":[]}'],
  ]) assert.throws(() => parseHistoryArgs(args), { code: /INVALID_/ });
});

test('open --no-browser returns a verified link and does not call the platform opener', async (t) => {
  const fixture = await endpointFixture(t);
  let stdout = '';
  const code = await runHistoryCli(['open', '--endpoint', fixture.endpoint, '--ref', evidenceRef, '--no-browser'], {
    stdout: { write(value) { stdout += value; } }, openBrowser() { assert.fail('opener must not run'); },
  });
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.url, url);
  assert.equal(result.browserOpenRequested, false);
  assert.deepEqual(result.browser, { status: 'skipped' });
  assert.deepEqual(fixture.calls, [{ route: '/api/history/open', input: { refs: [evidenceRef] } }]);
});

test('open reports invocation separately and retains the URL on opener failure', async (t) => {
  const { endpoint } = await endpointFixture(t);
  for (const failed of [false, true]) {
    let stdout = '';
    let invocations = 0;
    const code = await runHistoryCli(['open', '--endpoint', endpoint, '--ref', evidenceRef], {
      stdout: { write(value) { stdout += value; } },
      async openBrowser(receivedUrl, ref) {
        invocations += 1;
        assert.equal(receivedUrl, url);
        assert.equal(ref, evidenceRef);
        if (failed) throw new Error('No desktop browser is configured.');
      },
    });
    const result = JSON.parse(stdout);
    assert.equal(invocations, 1);
    assert.equal(code, failed ? 1 : 0);
    assert.equal(result.targetVerified, true);
    assert.equal(result.viewerReady, true);
    assert.equal(result.url, url);
    assert.equal(result.browserOpenRequested, !failed);
    assert.equal(result.browser.status, failed ? 'failed' : 'requested');
    if (failed) assert.equal(result.browser.code, 'BROWSER_OPEN_FAILED');
  }
});

test('open never launches an unverified or foreign service URL', async (t) => {
  for (const extra of [{ targetVerified: false }, { viewerReady: false }, { url: 'https://example.com/' },
    { url: 'http://127.0.0.1:17892/#ref=er2.wrong' }, { error: { code: 'STALE_REFERENCE', message: 'Changed source.' } }]) {
    const { endpoint } = await endpointFixture(t, extra);
    let stdout = '';
    const code = await runHistoryCli(['open', '--endpoint', endpoint, '--ref', evidenceRef], {
      stdout: { write(value) { stdout += value; } }, openBrowser() { assert.fail('opener must not run'); },
    });
    assert.equal(code, 1);
    assert.ok(JSON.parse(stdout).error);
  }
});

test('viewer URL validation and platform commands keep reference data out of shell source', async () => {
  assert.equal(validateViewerUrl(url, evidenceRef), url);
  for (const bad of ['file:///etc/passwd', 'http://localhost:17892/#ref=er2.synthetic-reference',
    `http://user@127.0.0.1:17892/#ref=${evidenceRef}`, `${url}&action=execute`,
    `http://127.0.0.1:17892/other#ref=${evidenceRef}`, `http://127.0.0.1:17892/?x=1#ref=${evidenceRef}`]) {
    assert.throws(() => validateViewerUrl(bad, evidenceRef), { code: 'INVALID_RESPONSE' });
  }
  const windows = browserCommand(url, 'win32');
  assert.equal(windows.command, 'powershell.exe');
  assert.equal(windows.env.SESSION_ANALYZER_VIEWER_URL, url);
  assert.ok(!windows.args.some((arg) => arg.includes(evidenceRef)));
  assert.deepEqual(browserCommand(url, 'darwin'), { command: 'open', args: [url] });
  assert.deepEqual(browserCommand(url, 'linux'), { command: 'xdg-open', args: [url] });
  await openViewerBrowser(url, evidenceRef, { platform: 'linux', spawn(command, args, options) {
    assert.equal(command, 'xdg-open');
    assert.deepEqual(args, [url]);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  } });
  await assert.rejects(openViewerBrowser(url, evidenceRef, { spawn() {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    return child;
  } }), /ENOENT/);
  let killed = false;
  await assert.rejects(openViewerBrowser(url, evidenceRef, { timeoutMs: 5, spawn() {
    const child = new EventEmitter();
    child.kill = () => { killed = true; };
    return child;
  } }), /timed out/);
  assert.equal(killed, true);
});
