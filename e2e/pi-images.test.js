'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createHistoryService } = require('../src/history-service');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const image = (data = png) => ({ type: 'image', mimeType: 'image/png', data });
const text = (value) => ({ type: 'text', text: value });

for (const width of [1440, 390]) test(`native pi saved images in source order (${width})`, { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-image-browser-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repo = path.join(home, 'project');
  const directory = path.join(home, 'sessions', 'synthetic');
  await fs.mkdir(repo);
  await fs.mkdir(directory, { recursive: true });
  const rows = [{ type: 'session', version: 3, id: 'native-images', cwd: repo }];
  let parentId = null;
  const add = (id, message) => { rows.push({ type: 'message', id, parentId, message }); parentId = id; };
  add('user', { role: 'user', content: [text('USER_BEFORE_IMAGE'), image(), text('USER_AFTER_IMAGE')] });
  add('assistant', { role: 'assistant', content: [text('ASSISTANT_BEFORE_IMAGE'), image(), text('ASSISTANT_AFTER_IMAGE')] });
  add('call', { role: 'assistant', content: [{ type: 'toolCall', id: 'saved-read', name: 'read', arguments: { path: 'saved-reference.png' } }] });
  add('result', { role: 'toolResult', toolName: 'read', toolCallId: 'saved-read', isError: false,
    content: [text('PAIRED_IMAGE_RECEIPT'), image()] });
  add('unsupported', { role: 'user', content: [image('https://example.invalid/never-fetch.png')] });
  const file = path.join(directory, 'images.jsonl');
  const rawLines = rows.map((row) => JSON.stringify(row));
  const original = rawLines.join('\n') + '\n';
  await fs.writeFile(file, original);
  const sessionId = 'pi:native-images:unsupported';
  const eventId = (line, suffix) => `${sessionId}:event:${line}:${suffix}`;
  const userImageId = eventId(2, 'pi_content_image_1');
  const assistantImageId = eventId(3, 'pi_content_image_1');
  const callId = eventId(4, 'block:0');
  const unsupportedId = eventId(6, 'pi_content_image_0');
  const service = await createHistoryService({ repo, source: 'pi', piHome: home });
  t.after(() => service.close());
  const server = service.createViewerServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 900 } });
  const errors = [];
  const imageResponses = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (request.url().startsWith('https://example.invalid/')) externalRequests.push(request.url()); });
  page.on('response', (response) => { if (response.url().includes('/image-previews/')) imageResponses.push(response); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await page.locator(`#timeline .event[data-event-id="${unsupportedId}"]`).waitFor({ state: 'attached' });
  assert.equal(await page.locator('#layerSelect').inputValue(), 'main');
  const order = await page.locator('#timeline .event[data-event-id]').evaluateAll((elements) => elements.map((element) => element.dataset.eventId));
  assert.deepEqual(order, [eventId(2, 'block:0'), userImageId, eventId(2, 'block:2'),
    eventId(3, 'block:0'), assistantImageId, eventId(3, 'block:2'), callId, unsupportedId]);
  await page.locator('[data-main-presentation="trajectory"]').click();

  const open = async (id) => {
    if (width < 760) await page.locator('button[data-mobile-view="events"]').click();
    const target = page.locator(`[data-trajectory-event-id="${id}"]`).first();
    if (!(await target.count())) {
      for (const summary of await page.locator('details[data-trajectory-tool-group-id]:not([open]) > summary').all()) await summary.click();
    }
    await target.click();
    if (width < 760) await page.locator('button[data-mobile-view="detail"]').click();
  };
  for (const [id, previewId] of [[userImageId, 'image-2-1'], [assistantImageId, 'image-3-1'], [callId, 'image-5-1']]) {
    await open(id);
    const preview = page.locator(`#detail .imagePreviewGrid img[src$="/${previewId}"]`);
    await preview.waitFor();
    await preview.scrollIntoViewIfNeeded();
    await page.waitForFunction((suffix) => {
      const image = [...document.querySelectorAll('#detail .imagePreviewGrid img')].find((item) => item.src.endsWith(suffix));
      return image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1;
    }, `/${previewId}`);
    assert.equal(await preview.getAttribute('loading'), 'lazy');
    assert.equal((await page.locator('#detail').innerText()).includes(png), false, 'ordinary Detail omits media bytes');
    if (id === callId) assert.match(await page.locator('#detail').innerText(), /PAIRED_IMAGE_RECEIPT/);
  }

  await open(unsupportedId);
  await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('unsupported, malformed or too large'));
  assert.equal(await page.locator('#detail .imagePreviewGrid img').count(), 0);
  assert.deepEqual(externalRequests, []);

  await open(userImageId);
  await page.locator('#detail .imagePreviewGrid img').waitFor();
  await page.locator('#detail [data-detail-action="raw"]').click();
  await page.waitForFunction(() => document.querySelector('#detail .rawRefsView')?.textContent.includes('USER_BEFORE_IMAGE'));
  assert.match(await page.locator('#detail .rawRefsView').innerText(), /USER_BEFORE_IMAGE/);
  assert.match(await page.locator('#detail .rawRefsView').innerText(), /saved image payload omitted/);
  const rawId = `${sessionId}:raw:2`;
  const rawResponse = await page.request.get(`http://127.0.0.1:${server.address().port}/api/sessions/${encodeURIComponent(sessionId)}/raw/${encodeURIComponent(rawId)}`);
  assert.equal(rawResponse.status(), 200);
  assert.equal((await rawResponse.json()).raw, rawLines[1], 'physical Raw readback retains the exact original image record');
  for (const response of imageResponses) {
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'image/png');
  }
  assert.ok(imageResponses.length >= 3);
  assert.deepEqual(errors, []);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
