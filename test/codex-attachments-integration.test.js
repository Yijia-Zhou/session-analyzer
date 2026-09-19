'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/codex');
const { materializeSessionForIndex } = require('../src/source-adapters');

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const INLINE_IMAGE = `data:image/png;base64,${TINY_PNG}`;
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORDERED_TEXT = 'ordered inline file inline repeated references';
const SAME_INLINE_TEXT = 'same text same inline image mirror';
const SAME_FILE_TEXT = 'same text different file image';
const LEGACY_FALLBACK_TEXT = 'legacy mixed attachment order fallback';
const LEGACY_INVALID_TEXT = 'legacy invalid attachment order fallback';

function timestampFor(line) {
  return `2026-09-18T10:00:${String(line).padStart(2, '0')}.000Z`;
}

function responseMessage(role, text, content) {
  return {
    timestamp: timestampFor(0),
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: [
        { type: 'input_text', text },
        ...content,
      ],
    },
  };
}

function eventUserMessage(text, fields = {}) {
  return {
    timestamp: timestampFor(0),
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message: text,
      ...fields,
    },
  };
}

async function makeFixture(t) {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-analyzer-attachments-'));
  t.after(() => fsp.rm(codexHome, { recursive: true, force: true }));
  const repoRoot = path.join(codexHome, 'repo');
  const orderedContent = [
    { type: 'input_image', image_url: INLINE_IMAGE, detail: 'high' },
    { type: 'input_image', file_id: 'file-repeat', detail: 'low' },
    { type: 'input_image', image_url: INLINE_IMAGE, detail: 'original' },
    { type: 'input_image', file_id: 'file-repeat', detail: 'auto' },
  ];
  const orderedPayload = responseMessage('user', ORDERED_TEXT, orderedContent).payload;
  const records = [
    {
      timestamp: timestampFor(1),
      type: 'session_meta',
      payload: { id: SESSION_ID, cwd: repoRoot },
    },
    { ...responseMessage('user', ORDERED_TEXT, orderedContent), timestamp: timestampFor(2) },
    {
      ...responseMessage('user', SAME_INLINE_TEXT, [
        { type: 'input_image', image_url: INLINE_IMAGE, detail: 'high' },
      ]),
      timestamp: timestampFor(3),
    },
    {
      ...eventUserMessage(SAME_INLINE_TEXT, { images: [INLINE_IMAGE] }),
      timestamp: timestampFor(4),
    },
    {
      ...responseMessage('user', SAME_FILE_TEXT, [
        { type: 'input_image', file_id: 'file-different-a' },
      ]),
      timestamp: timestampFor(5),
    },
    {
      ...eventUserMessage(SAME_FILE_TEXT, { file_ids: ['file-different-b'] }),
      timestamp: timestampFor(6),
    },
    {
      ...eventUserMessage(LEGACY_FALLBACK_TEXT, {
        images: [INLINE_IMAGE],
        file_ids: ['file-legacy-fallback'],
      }),
      timestamp: timestampFor(7),
    },
    {
      ...eventUserMessage(LEGACY_INVALID_TEXT, {
        images: [INLINE_IMAGE],
        file_ids: ['file-legacy-invalid'],
        image_order: ['file', 'unexpected'],
      }),
      timestamp: timestampFor(8),
    },
  ];
  const sourceFile = path.join(codexHome, 'sessions', `rollout-${SESSION_ID}.jsonl`);
  await fsp.mkdir(repoRoot, { recursive: true });
  await fsp.mkdir(path.dirname(sourceFile), { recursive: true });
  await fsp.writeFile(sourceFile, `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
  return {
    codexHome,
    repoRoot,
    sourceFile,
    orderedPayload,
    records,
  };
}

function assertCompactIndexHasNoMedia(index) {
  const encoded = JSON.stringify(index);
  assert.doesNotMatch(encoded, /data:image\/png;base64|iVBORw0KGgo/);
  assert.doesNotMatch(encoded, /"attachmentSummary"|"parsed"/);
}

function userEvents(session) {
  return session.logicalEvents.filter((event) => event.kind === 'user_message');
}

function eventForText(session, text) {
  const event = userEvents(session).find((candidate) => candidate.searchText.includes(text));
  assert.ok(event, `missing user event for ${text}`);
  return event;
}

async function assertHydratedAttachmentDetails(index, session, event) {
  for (const [locale, expectedTitle, expectedReferenceTitle, expectedEntries] of [
    ['en', 'Image attachments', 'Image references', ['Inline image', 'File reference', 'Inline image', 'File reference']],
    ['zh-CN', '图片附件', '图片引用', ['内嵌图片', '文件引用', '内嵌图片', '文件引用']],
  ]) {
    const detail = await codex.buildHydratedEventDetail(index, session, event.id, 'main', { locale });
    assert.deepEqual(detail.rawRefs, event.rawRefs);
    const attachmentSection = detail.timelineSections.find((section) => section.title === expectedTitle);
    assert.ok(attachmentSection, JSON.stringify(detail.timelineSections));
    assert.deepEqual(attachmentSection.entries.map((entry) => entry.value), expectedEntries);
    assert.ok(detail.inspectorSections.some((section) => section.title === expectedReferenceTitle));
    const references = JSON.stringify(detail.inspectorSections);
    assert.equal(references.match(/file-repeat/g)?.length, 2);
    assert.doesNotMatch(JSON.stringify(detail), /data:image\/png;base64|iVBORw0KGgo/);
  }
}

async function assertHydratedOrderNotice(index, session, event) {
  for (const [locale, expectedTitle] of [['en', 'Attachment order'], ['zh-CN', '附件顺序']]) {
    const detail = await codex.buildHydratedEventDetail(index, session, event.id, 'main', { locale });
    assert.ok(detail.timelineSections.some((section) => section.title === expectedTitle), JSON.stringify(detail.timelineSections));
  }
}

test('source-backed attachment semantics survive cold/warm materialization, raw reads, and bilingual details', async (t) => {
  const fixture = await makeFixture(t);
  let index = await codex.buildSourceBackedIndex({
    repoRoot: fixture.repoRoot,
    codexHome: fixture.codexHome,
  });
  assert.equal(index.totals.reusedFileCount, 0);
  assertCompactIndexHasNoMedia(index);

  for (let pass = 0; pass < 2; pass += 1) {
    const indexedSession = index.sessionsById.get(SESSION_ID);
    assert.ok(indexedSession);
    const session = await materializeSessionForIndex(index, indexedSession);
    const ordered = eventForText(session, ORDERED_TEXT);
    const inlineMirror = eventForText(session, SAME_INLINE_TEXT);
    const differentFileEvents = userEvents(session).filter((event) => event.searchText.includes(SAME_FILE_TEXT));
    const fallback = eventForText(session, LEGACY_FALLBACK_TEXT);
    const invalid = eventForText(session, LEGACY_INVALID_TEXT);

    assert.deepEqual(ordered.rawRefs.map((ref) => ref.line), [2]);
    assert.match(ordered.preview, /4 image attachments/);
    assert.deepEqual(inlineMirror.rawRefs.map((ref) => ref.line), [3, 4]);
    assert.equal(differentFileEvents.length, 2);
    assert.deepEqual(differentFileEvents.map((event) => event.rawRefs.map((ref) => ref.line)), [[5], [6]]);
    assert.deepEqual(fallback.rawRefs.map((ref) => ref.line), [7]);
    assert.deepEqual(invalid.rawRefs.map((ref) => ref.line), [8]);

    const orderedRaw = session.rawEvents.find((raw) => raw.line === 2);
    assert.ok(orderedRaw);
    assert.equal(Object.hasOwn(orderedRaw, 'attachmentSummary'), false);
    assert.equal(Object.hasOwn(orderedRaw, 'parsed'), false);
    assert.doesNotMatch(orderedRaw.searchText, /data:image\/png;base64|iVBORw0KGgo/);
    assert.equal(orderedRaw.rawId, `${SESSION_ID}:raw:2`);
    assert.equal(orderedRaw.sourceLocator.type, 'jsonl_line');
    assert.equal(orderedRaw.sourceLocator.line, 2);

    const fallbackRaw = session.rawEvents.find((raw) => raw.line === 7);
    const invalidRaw = session.rawEvents.find((raw) => raw.line === 8);
    assert.match(fallbackRaw.preview, /order evidence is incomplete/);
    assert.match(invalidRaw.preview, /order evidence is incomplete/);

    const exact = await codex.readIndexedCodexRawRecord(index, session, orderedRaw);
    assert.equal(exact.line, 2);
    assert.deepEqual(exact.parsed, fixture.records[1]);

    await assertHydratedAttachmentDetails(index, session, ordered);
    await assertHydratedOrderNotice(index, session, invalid);

    if (pass === 0) {
      index = await codex.buildSourceBackedIndex({
        repoRoot: fixture.repoRoot,
        codexHome: fixture.codexHome,
        previousIndex: index,
      });
      assert.equal(index.totals.reusedFileCount, 1);
      assertCompactIndexHasNoMedia(index);
    }
  }
});
