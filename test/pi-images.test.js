'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildPiIndex, snapshotForSession } = require('../src/pi');
const { materializeSessionForIndex } = require('../src/source-adapters');
const { disposeProjectQueryStore } = require('../src/project-query-store');
const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');
const { piImagePreviewSection, readPiImagePreview, sanitizePiImageRecord, SAVED_IMAGE_MARKER,
  IMAGE_PREVIEW_MAX_ENCODED_CHARS, IMAGE_PREVIEW_MAX_DECODED_BYTES } = require('../src/pi-images');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6MsAAAAASUVORK5CYII=';
const image = (extra = {}) => ({ type: 'image', mimeType: 'image/png', data: png, ...extra });
const text = (value) => ({ type: 'text', text: value });
const timestamp = '2026-10-23T10:00:00.000Z';
const entry = (id, parentId, type, extra) => ({ type, id, parentId, timestamp, ...extra });
const message = (id, parentId, role, content, extra = {}) => entry(id, parentId, 'message', {
  message: { role, content, timestamp: Date.parse(timestamp), ...extra },
});

async function fixture(t, rows) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-images-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const repoRoot = path.join(home, 'project');
  await fs.mkdir(repoRoot);
  await fs.mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', 'saved.jsonl');
  const original = [{ type: 'session', version: 3, id: 'image-session', cwd: repoRoot, timestamp }, ...rows]
    .map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, original);
  const index = await buildPiIndex({ sourceHome: home, repoRoot });
  t.after(() => disposeProjectQueryStore(index.projectQueryStore));
  const sessions = await Promise.all(index.sessions.map((stored) => materializeSessionForIndex(index, stored)));
  return { home, file, original, index, sessions, session: sessions[0] };
}

function singleImage(block) {
  const record = message('image-entry', null, 'user', [block]);
  const event = { id: 'saved-event', subtype: 'pi_content_image_0', layer: 'protocol',
    rawRefs: [{ rawId: 'saved-raw', file: 'saved.jsonl', line: 1 }] };
  return { event, snapshot: { lines: [JSON.stringify(record)] }, session: {
    id: 'saved-session', sourceFile: 'saved.jsonl', logicalEvents: [event], rawEvents: [{
      rawId: 'saved-raw', entryId: 'image-entry', sessionId: 'saved-session', line: 1,
      source: { file: 'saved.jsonl', line: 1 },
    }],
  } };
}

test('pi saved images preserve block order and identity across user, assistant and both custom shapes', async (t) => {
  const f = await fixture(t, [
    message('user', null, 'user', [text('USER_TEXT'), image(), text('Between'), image()]),
    message('assistant', 'user', 'assistant', [image(), text('ASSISTANT_TEXT'), image()], { stopReason: 'stop' }),
    entry('custom', 'assistant', 'custom_message', { customType: 'saved-notice', display: true,
      content: [image(), text('CUSTOM_TEXT'), image()] }),
    message('custom-role', 'custom', 'custom', [text('ROLE_CUSTOM_TEXT'), image()], { customType: 'role', display: true }),
  ]);
  for (const raw of f.session.rawEvents) assert.equal(raw.searchText.includes(png), false);
  for (const event of f.session.logicalEvents) assert.equal(event.searchText.includes(png), false);
  const snapshot = await snapshotForSession(f.index, f.session);
  const sections = f.session.logicalEvents.map((event) => ({ event, section: piImagePreviewSection(f.session, event, snapshot) }))
    .filter(({ section }) => section);
  assert.equal(sections.length, 6);
  const user = f.session.logicalEvents.filter((event) => event.rawRefs[0].line === 2);
  assert.deepEqual(user.map((event) => event.pi.blockIndex), [0, 1, 2, 3]);
  assert.deepEqual(user.map((event) => event.layer), ['main', 'main', 'main', 'main']);
  assert.equal(user[1].kind, 'user_message');
  assert.equal(user[1].role, 'user');
  assert.equal(user[1].id, `${f.session.id}:event:2:pi_content_image_1`, 'previous physical image identity is retained');
  const assistantImage = sections.find(({ event }) => event.rawRefs[0].line === 3).event;
  assert.equal(assistantImage.layer, 'main');
  assert.equal(assistantImage.kind, 'assistant_message');
  assert.equal(assistantImage.searchText, '');
  assert.equal(sections.find(({ event }) => event.subtype === 'pi_custom_message').event.layer, 'protocol');
  assert.deepEqual(sections.map(({ section }) => section.images.map((item) => item.previewId)), [
    ['image-2-1'], ['image-2-3'], ['image-3-0'], ['image-3-2'], ['image-4-0', 'image-4-2'], ['image-5-1'],
  ]);
  for (const { event, section } of sections) {
    validateLogicalDetailSection(section);
    assert.doesNotMatch(JSON.stringify(section), new RegExp(png));
    for (const item of section.images) {
      assert.match(item.src, /^\/api\/sessions\/[^/?#]+\/events\/[^/?#]+\/image-previews\/[^/?#]+$/);
      const decoded = await readPiImagePreview(f.index, f.session, event.id, item.previewId);
      assert.equal(decoded.mimeType, 'image/png');
      assert.deepEqual(decoded.bytes, Buffer.from(png, 'base64'));
    }
  }
  const first = sections[0];
  const foreign = sections[1].section.images[0].previewId;
  assert.equal((await readPiImagePreview(f.index, f.session, first.event.id, foreign)).statusCode, 404);
  assert.equal((await readPiImagePreview(f.index, f.session, 'missing', first.section.images[0].previewId)).statusCode, 404);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.original);
});

test('paired tool images belong to their exact call/result on each selected branch', async (t) => {
  const f = await fixture(t, [
    message('user', null, 'user', 'Run the saved tool'),
    message('call', 'user', 'assistant', [image(), { type: 'toolCall', id: 'call-id', name: 'read', arguments: { path: 'reference-only.png' } }]),
    message('alpha', 'call', 'toolResult', [text('ALPHA_OUTPUT'), image(), image()], { toolCallId: 'call-id', toolName: 'read', isError: false }),
    message('beta', 'call', 'toolResult', [image({ mimeType: 'image/gif', data: 'R0lGODlh' })], { toolCallId: 'call-id', toolName: 'read', isError: false }),
  ]);
  const calls = [];
  for (const session of f.sessions) {
    const snapshot = await snapshotForSession(f.index, session);
    const call = session.logicalEvents.find((event) => event.kind === 'other_tool_call');
    const section = piImagePreviewSection(session, call, snapshot);
    assert.equal(section.images.length, session.sourceDerivedId === 'alpha' ? 2 : 1);
    assert.deepEqual(section.images.map((item) => item.previewId), session.sourceDerivedId === 'alpha'
      ? ['image-4-1', 'image-4-2'] : ['image-5-0']);
    assert.equal(section.images.some((item) => item.previewId === 'image-3-0'), false, 'request sibling image is a separate event');
    const first = section.images[0];
    const decoded = await readPiImagePreview(f.index, session, call.id, first.previewId);
    assert.equal(decoded.mimeType, session.sourceDerivedId === 'alpha' ? 'image/png' : 'image/gif');
    const siblingId = session.sourceDerivedId === 'alpha' ? 'image-5-0' : 'image-4-1';
    assert.equal((await readPiImagePreview(f.index, session, call.id, siblingId)).statusCode, 404);
    calls.push({ session, call, snapshot });
  }
  const { session, call, snapshot } = calls[0];
  assert.equal(piImagePreviewSection(session, { ...call, pi: { ...call.pi, callId: 'wrong-call' } }, snapshot), null);
});

test('unpaired, ambiguous and invalid-tree evidence does not acquire tool image previews', async (t) => {
  const f = await fixture(t, [
    message('call', null, 'assistant', [{ type: 'toolCall', id: 'duplicate', name: 'other', arguments: {} }]),
    message('result-a', 'call', 'toolResult', [image()], { toolCallId: 'duplicate', toolName: 'other', isError: false }),
    message('result-b', 'result-a', 'toolResult', [image()], { toolCallId: 'duplicate', toolName: 'other', isError: false }),
  ]);
  const snapshot = await snapshotForSession(f.index, f.session);
  for (const event of f.session.logicalEvents) assert.equal(piImagePreviewSection(f.session, event, snapshot), null);
  const invalid = singleImage(image());
  invalid.session.logicalEvents.push({ subtype: 'pi_branch', pi: { invalidTree: true } });
  assert.equal(piImagePreviewSection(invalid.session, invalid.event, invalid.snapshot), null);
});

test('image presentation caps at eight blocks without collapsing identical saved images', async (t) => {
  const f = await fixture(t, [entry('many', null, 'custom_message', { customType: 'many', display: true,
    content: Array.from({ length: 11 }, () => image()) })]);
  const event = f.session.logicalEvents.find((candidate) => candidate.subtype === 'pi_custom_message');
  const section = piImagePreviewSection(f.session, event, await snapshotForSession(f.index, f.session));
  assert.equal(section.images.length, 8);
  assert.equal(new Set(section.images.map((item) => item.src)).size, 8);
  assert.match(section.notice, /3 additional saved image blocks/);
});

test('only supported inline MIME/base64 is previewed; data URLs, paths, URLs and malformed blocks remain Raw evidence', () => {
  for (const block of [image({ mimeType: 'image/svg+xml' }), image({ data: 'https://example.invalid/image.png' }),
    image({ data: '/tmp/reference.png' }), image({ data: `data:image/png;base64,${png}` }),
    image({ data: 'abc' }), image({ data: 'ab=c' }), image({ data: '' }), image({ data: {} }), image({ mimeType: {} })]) {
    const f = singleImage(block);
    const section = piImagePreviewSection(f.session, f.event, f.snapshot);
    assert.deepEqual(section.images, []);
    assert.match(section.notice, /unsupported, malformed or too large/);
  }
  const f = singleImage(image({ mimeType: 'IMAGE/PNG', data: `\n${png.slice(0, 12)}\r\n${png.slice(12)}\t` }));
  const section = piImagePreviewSection(f.session, f.event, f.snapshot);
  assert.equal(section.images[0].mimeType, 'image/png');
  assert.equal(section.images[0].estimatedBytes, Buffer.from(png, 'base64').length);
});

test('image size bounds apply before decoding and count whitespace in the input budget', () => {
  assert.equal(IMAGE_PREVIEW_MAX_DECODED_BYTES, 12 * 1024 * 1024);
  const exact = singleImage(image({ data: 'A'.repeat(IMAGE_PREVIEW_MAX_ENCODED_CHARS) }));
  assert.equal(piImagePreviewSection(exact.session, exact.event, exact.snapshot).images[0].estimatedBytes,
    IMAGE_PREVIEW_MAX_DECODED_BYTES);
  for (const data of ['A'.repeat(IMAGE_PREVIEW_MAX_ENCODED_CHARS + 4), ' '.repeat(IMAGE_PREVIEW_MAX_ENCODED_CHARS) + png]) {
    const f = singleImage(image({ data }));
    assert.equal(piImagePreviewSection(f.session, f.event, f.snapshot).images.length, 0);
  }
});

test('image readback rejects malformed and oversized inline payloads without returning bytes', async (t) => {
  const f = await fixture(t, [entry('invalid', null, 'custom_message', { customType: 'invalid', display: true, content: [
    image({ mimeType: 'image/svg+xml' }), image({ data: 'https://example.invalid/image.png' }),
    image({ data: 'A'.repeat(IMAGE_PREVIEW_MAX_ENCODED_CHARS + 4) }),
  ] })]);
  const event = f.session.logicalEvents.find((candidate) => candidate.subtype === 'pi_custom_message');
  for (const [blockIndex, statusCode] of [[0, 422], [1, 422], [2, 413]]) {
    const result = await readPiImagePreview(f.index, f.session, event.id, `image-2-${blockIndex}`);
    assert.equal(result.statusCode, statusCode);
    assert.equal(Object.hasOwn(result, 'bytes'), false);
  }
});

test('display image sanitization omits inline payload without modifying source content or search text', () => {
  for (const record of [message('u', null, 'user', [text('READABLE'), image()]),
    message('a', null, 'assistant', [image()]), message('t', null, 'toolResult', [image()]),
    message('c', null, 'custom', [image()]), entry('custom', null, 'custom_message', { content: [image()] })]) {
    const original = JSON.stringify(record);
    const sanitized = sanitizePiImageRecord(record);
    const content = sanitized.message?.content || sanitized.content;
    assert.equal(content.find((block) => block.type === 'image').data, SAVED_IMAGE_MARKER);
    assert.equal(JSON.stringify(record), original);
    assert.equal(JSON.stringify(sanitized).includes(png), false);
  }
});

test('image readback retains accepted snapshot and fails on mutation, truncation, replacement and root escape', async (t) => {
  const f = await fixture(t, [message('user', null, 'user', [image()])]);
  const event = f.session.logicalEvents.find((candidate) => candidate.subtype === 'pi_content_image_0');
  const read = () => readPiImagePreview(f.index, f.session, event.id, 'image-2-0');
  await fs.appendFile(f.file, JSON.stringify(message('append', 'user', 'user', [image()])) + '\n');
  assert.deepEqual((await read()).bytes, Buffer.from(png, 'base64'));
  assert.equal((await readPiImagePreview(f.index, f.session, event.id, 'image-3-0')).statusCode, 404);
  await fs.writeFile(f.file, f.original.replace('iVBOR', 'jVBOR'));
  assert.equal((await read()).code, 'INDEXED_SOURCE_STALE');
  await fs.writeFile(f.file, f.original.slice(0, -2));
  assert.equal((await read()).statusCode, 409);
  await fs.writeFile(f.file, f.original);
  const backup = `${f.file}.backup`;
  await fs.rename(f.file, backup);
  await fs.writeFile(f.file, f.original);
  assert.equal((await read()).statusCode, 409, 'same bytes in a replaced inode are stale');
  await fs.rm(f.file);
  const external = path.join(f.home, 'outside.jsonl');
  await fs.writeFile(external, f.original);
  await fs.symlink(external, f.file);
  assert.equal((await read()).statusCode, 409);
  await fs.rm(f.file);
  assert.equal((await read()).statusCode, 409);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readPiImagePreview(f.index, f.session, event.id, 'image-2-0', { signal: controller.signal }), { name: 'AbortError' });
});
