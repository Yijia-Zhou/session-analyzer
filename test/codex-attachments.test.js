'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATTACHMENT_KIND,
  ATTACHMENT_SUMMARY_VERSION,
  DEFAULT_MAX_ATTACHMENTS,
  summarizeCodexAttachments,
  summarizeLegacyImageAttachments,
  summarizeResponseContentAttachments,
  summarizeResponsePayloadAttachments,
} = require('../src/codex-attachments');

test('response content preserves inline/file order, repeated file references, and detail hints without media leakage', () => {
  const summary = summarizeResponseContentAttachments([
    { type: 'input_text', text: 'Keep this text outside the attachment summary.' },
    { type: 'input_image', image_url: 'data:image/png;base64,SYNTHETIC_SECRET_A', detail: 'high' },
    { type: 'input_image', file_id: 'file_fixture_a', detail: 'low' },
    { type: 'input_image', file_id: 'file_fixture_a' },
    { type: 'input_image', image_url: 'https://fixture.invalid/image.png' },
  ]);

  assert.equal(summary.version, ATTACHMENT_SUMMARY_VERSION);
  assert.deepEqual(summary.attachments, [
    {
      position: 0,
      source: 'response_content',
      sourceIndex: 1,
      kind: ATTACHMENT_KIND.INLINE,
      detail: 'high',
    },
    {
      position: 1,
      source: 'response_content',
      sourceIndex: 2,
      kind: ATTACHMENT_KIND.FILE,
      fileId: 'file_fixture_a',
      detail: 'low',
    },
    {
      position: 2,
      source: 'response_content',
      sourceIndex: 3,
      kind: ATTACHMENT_KIND.FILE,
      fileId: 'file_fixture_a',
    },
    {
      position: 3,
      source: 'response_content',
      sourceIndex: 4,
      kind: ATTACHMENT_KIND.INLINE,
    },
  ]);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.inlineCount, 2);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.order.mode, 'content_array');
  assert.equal(summary.order.reliable, true);
  assert.match(summary.previewText, /2 file-backed images/);
  assert.match(summary.previewText, /no local preview/);
  assert.doesNotMatch(JSON.stringify(summary), /SYNTHETIC_SECRET_A|data:image|fixture\.invalid/);
});

test('file-only response content has a useful preview while keeping message body ownership separate', () => {
  const summary = summarizeResponsePayloadAttachments({
    type: 'function_call_output',
    output: [
      { type: 'input_image', file_id: 'file_only_fixture', detail: 'original' },
    ],
  });

  assert.equal(summary.totalCount, 1);
  assert.equal(summary.fileCount, 1);
  assert.equal(summary.inlineCount, 0);
  assert.match(summary.previewText, /only file references/);
  assert.match(summary.previewText, /no local preview/);
  assert.equal(Object.hasOwn(summary, 'text'), false);
  assert.equal(Object.hasOwn(summary, 'messageText'), false);
  assert.equal(summary.attachments[0].fileId, 'file_only_fixture');
  assert.equal(Object.hasOwn(summary.attachments[0], 'path'), false);
});

test('malformed response image items remain bounded invalid evidence and never echo either reference', () => {
  const summary = summarizeResponseContentAttachments([
    { type: 'input_image', image_url: 'data:image/png;base64,DUAL_SECRET', file_id: 'file_dual_fixture', detail: 42 },
    { type: 'input_image' },
    { type: 'input_image', image_url: '', file_id: 'file_valid_fixture' },
    { type: 'input_image', image_url: { url: 'data:image/png;base64,OBJECT_SECRET' } },
  ]);

  assert.equal(summary.totalCount, 4);
  assert.equal(summary.invalidCount, 3);
  assert.equal(summary.fileCount, 1);
  assert.deepEqual(summary.attachments.map((item) => item.kind), [
    ATTACHMENT_KIND.INVALID,
    ATTACHMENT_KIND.INVALID,
    ATTACHMENT_KIND.FILE,
    ATTACHMENT_KIND.INVALID,
  ]);
  assert.equal(summary.attachments[0].issue, 'multiple_image_references');
  assert.equal(summary.attachments[2].fileId, 'file_valid_fixture');
  assert.ok(summary.warnings.includes('multiple_image_references'));
  assert.ok(summary.warnings.includes('invalid_detail'));
  assert.equal(summary.identity.complete, false);
  assert.doesNotMatch(JSON.stringify(summary), /DUAL_SECRET|OBJECT_SECRET|data:image/);
});

test('legacy split arrays use complete image_order evidence and preserve repeated positions', () => {
  const summary = summarizeLegacyImageAttachments({
    images: ['inline_fixture_0', 'inline_fixture_1'],
    file_ids: ['file_fixture_0', 'file_fixture_0'],
    file_id_details: ['high', 'low'],
    image_order: ['file', 'inline', 'file', 'inline'],
  });

  assert.equal(summary.order.mode, 'image_order');
  assert.equal(summary.order.reliable, true);
  assert.equal(summary.order.reason, '');
  assert.deepEqual(summary.attachments.map(({ kind, sourceIndex, fileId, detail }) => ({
    kind,
    sourceIndex,
    ...(fileId ? { fileId } : {}),
    ...(detail ? { detail } : {}),
  })), [
    { kind: ATTACHMENT_KIND.FILE, sourceIndex: 0, fileId: 'file_fixture_0', detail: 'high' },
    { kind: ATTACHMENT_KIND.INLINE, sourceIndex: 0 },
    { kind: ATTACHMENT_KIND.FILE, sourceIndex: 1, fileId: 'file_fixture_0', detail: 'low' },
    { kind: ATTACHMENT_KIND.INLINE, sourceIndex: 1 },
  ]);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.inlineCount, 2);
  assert.equal(JSON.stringify(summary).includes('inline_fixture_0'), false);
});

test('legacy missing image_order uses compatibility order and exposes incomplete ordering evidence', () => {
  const summary = summarizeLegacyImageAttachments({
    images: ['inline_fixture_0', 'inline_fixture_1'],
    file_ids: ['file_fixture_0'],
    file_id_details: ['auto'],
  });

  assert.equal(summary.order.mode, 'compatibility_inline_then_file');
  assert.equal(summary.order.reliable, false);
  assert.equal(summary.order.reason, 'image_order_missing');
  assert.equal(summary.identity.complete, false);
  assert.deepEqual(summary.attachments.map(({ kind, sourceIndex }) => ({ kind, sourceIndex })), [
    { kind: ATTACHMENT_KIND.INLINE, sourceIndex: 0 },
    { kind: ATTACHMENT_KIND.INLINE, sourceIndex: 1 },
    { kind: ATTACHMENT_KIND.FILE, sourceIndex: 0 },
  ]);
  assert.match(summary.previewText, /order evidence is incomplete/);
});

test('legacy missing image_order is complete when only one storage array carries references', () => {
  const inline = summarizeLegacyImageAttachments({
    images: ['inline_fixture_0', 'inline_fixture_1'],
  });
  const files = summarizeLegacyImageAttachments({
    file_ids: ['file_fixture_0', 'file_fixture_0'],
  });

  for (const summary of [inline, files]) {
    assert.equal(summary.order.mode, 'single_kind_array');
    assert.equal(summary.order.reliable, true);
    assert.equal(summary.order.reason, '');
    assert.equal(summary.identity.complete, true);
  }
  assert.deepEqual(files.attachments.map((item) => item.fileId), ['file_fixture_0', 'file_fixture_0']);
});

test('invalid legacy image_order falls back without dropping or misindexing any attachment', () => {
  const summary = summarizeLegacyImageAttachments({
    images: ['inline_fixture_0', 'inline_fixture_1'],
    file_ids: ['file_fixture_0', 'file_fixture_1'],
    file_id_details: ['high', 'low'],
    image_order: ['file', 'unexpected'],
  });

  assert.equal(summary.order.mode, 'fallback_inline_then_file');
  assert.equal(summary.order.reliable, false);
  assert.equal(summary.order.reason, 'image_order_count_mismatch');
  assert.equal(summary.identity.complete, false);
  assert.equal(summary.order.expectedCount, 4);
  assert.equal(summary.order.observedCount, 2);
  assert.deepEqual(summary.attachments.map(({ kind, sourceIndex, fileId }) => ({
    kind,
    sourceIndex,
    ...(fileId ? { fileId } : {}),
  })), [
    { kind: ATTACHMENT_KIND.INLINE, sourceIndex: 0 },
    { kind: ATTACHMENT_KIND.INLINE, sourceIndex: 1 },
    { kind: ATTACHMENT_KIND.FILE, sourceIndex: 0, fileId: 'file_fixture_0' },
    { kind: ATTACHMENT_KIND.FILE, sourceIndex: 1, fileId: 'file_fixture_1' },
  ]);
  assert.ok(summary.warnings.includes('image_order_count_mismatch'));
});

test('same-length legacy order with wrong kind counts also falls back conservatively', () => {
  const summary = summarizeLegacyImageAttachments({
    images: ['inline_fixture_0'],
    file_ids: ['file_fixture_0', 'file_fixture_1'],
    image_order: ['inline', 'inline', 'inline'],
  });

  assert.equal(summary.order.reason, 'image_order_kind_counts_mismatch');
  assert.equal(summary.order.observedCount, 3);
  assert.deepEqual(summary.attachments.map((item) => item.kind), [
    ATTACHMENT_KIND.INLINE,
    ATTACHMENT_KIND.FILE,
    ATTACHMENT_KIND.FILE,
  ]);
});

test('legacy detail metadata is optional, bounded, and diagnosed independently of ordering', () => {
  const summary = summarizeLegacyImageAttachments({
    images: ['inline_fixture_0'],
    file_ids: ['file_fixture_0', 'file_fixture_1'],
    file_id_details: ['high'],
    image_order: ['inline', 'file', 'file'],
  });

  assert.equal(summary.order.reliable, true);
  assert.equal(summary.identity.complete, true);
  assert.equal(summary.attachments[1].detail, 'high');
  assert.equal(Object.hasOwn(summary.attachments[2], 'detail'), false);
  assert.ok(summary.warnings.includes('file_id_details_count_mismatch'));
});

test('summaries are bounded, retain totals, and treat file IDs as opaque values rather than paths', () => {
  const longId = `file_${'x'.repeat(500)}`;
  const summary = summarizeLegacyImageAttachments({
    images: [null, 'data:image/png;base64,INLINE_SECRET'],
    file_ids: [longId, 'C:\\fixture\\looks-like-a-path'],
    file_id_details: ['high', 'low'],
    image_order: ['inline', 'file', 'file', 'inline'],
  }, { maxAttachments: 3, maxReferenceChars: 12 });

  assert.equal(summary.totalCount, 4);
  assert.equal(summary.omittedCount, 1);
  assert.equal(summary.truncated, true);
  assert.equal(summary.attachments.length, 3);
  assert.equal(summary.invalidCount, 1);
  assert.equal(summary.attachments[1].fileId, 'file_xxxxxx…');
  assert.equal(summary.attachments[1].fileIdTruncated, true);
  assert.equal(summary.attachments[2].fileId, 'C:\\fixture\\…');
  assert.equal(Object.hasOwn(summary.attachments[1], 'path'), false);
  assert.doesNotMatch(JSON.stringify(summary), /INLINE_SECRET|data:image/);
});

test('attachment identity hashes complete opaque IDs and ordered repeats beyond the bounded display list', () => {
  const commonPrefix = 'file_same_prefix_';
  const first = summarizeResponseContentAttachments([
    { type: 'input_image', file_id: `${commonPrefix}A` },
    { type: 'input_image', file_id: `${commonPrefix}B` },
    { type: 'input_image', file_id: `${commonPrefix}A` },
  ], { maxAttachments: 1 });
  const reordered = summarizeResponseContentAttachments([
    { type: 'input_image', file_id: `${commonPrefix}A` },
    { type: 'input_image', file_id: `${commonPrefix}A` },
    { type: 'input_image', file_id: `${commonPrefix}B` },
  ], { maxAttachments: 1 });
  const longA = 'file_shared_prefix_' + 'x'.repeat(100) + 'A';
  const longB = 'file_shared_prefix_' + 'x'.repeat(100) + 'B';
  const prefixCollisionA = summarizeResponseContentAttachments([
    { type: 'input_image', file_id: longA },
  ], { maxReferenceChars: 16 });
  const prefixCollisionB = summarizeResponseContentAttachments([
    { type: 'input_image', file_id: longB },
  ], { maxReferenceChars: 16 });

  assert.equal(first.identity.complete, true);
  assert.equal(first.identity.count, 3);
  assert.notEqual(first.identity.digest, reordered.identity.digest);
  assert.equal(prefixCollisionA.attachments[0].fileId, prefixCollisionB.attachments[0].fileId);
  assert.notEqual(prefixCollisionA.identity.digest, prefixCollisionB.identity.digest);
  assert.equal(first.attachments.length, 1);
  assert.equal(first.omittedCount, 2);
});

test('externalized inline marker makes attachment identity incomplete instead of merging marker-only mirrors', () => {
  const summary = summarizeResponseContentAttachments([
    {
      type: 'input_image',
      image_url: '[embedded image payload externalized; open raw refs for source]',
    },
  ]);

  assert.equal(summary.totalCount, 1);
  assert.equal(summary.inlineCount, 1);
  assert.equal(summary.identity.complete, false);
  assert.equal(typeof summary.identity.digest, 'string');
  assert.equal(summary.identity.digest.length, 64);
  assert.doesNotMatch(JSON.stringify(summary), /base64|embedded image payload externalized/);
});

test('payload dispatcher accepts response content and legacy payloads without conflating their order contracts', () => {
  const response = summarizeCodexAttachments({
    type: 'message',
    content: [{ type: 'input_image', file_id: 'file_response_fixture' }],
  });
  const legacy = summarizeCodexAttachments({
    images: ['inline_legacy_fixture'],
    file_ids: ['file_legacy_fixture'],
    image_order: ['file', 'inline'],
  });

  assert.equal(response.order.source, 'response_content');
  assert.equal(response.order.mode, 'content_array');
  assert.equal(legacy.order.source, 'legacy_split_arrays');
  assert.equal(legacy.order.mode, 'image_order');
  assert.equal(response.attachments[0].fileId, 'file_response_fixture');
  assert.equal(legacy.attachments[0].fileId, 'file_legacy_fixture');
});

test('empty and non-array inputs are safe no-op summaries', () => {
  const empty = summarizeResponseContentAttachments([]);
  const invalid = summarizeCodexAttachments('not a payload');

  for (const summary of [empty, invalid]) {
    assert.deepEqual(summary.attachments, []);
    assert.equal(summary.totalCount, 0);
    assert.equal(summary.inlineCount, 0);
    assert.equal(summary.fileCount, 0);
    assert.equal(summary.invalidCount, 0);
    assert.equal(summary.previewText, '');
    assert.equal(summary.omittedCount, 0);
  }
  assert.equal(empty.order.mode, 'content_array');
  assert.equal(invalid.order.mode, 'none');
  assert.equal(DEFAULT_MAX_ATTACHMENTS > 0, true);
});
