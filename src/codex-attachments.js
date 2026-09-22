'use strict';

const crypto = require('node:crypto');

// Codex image-reference compatibility helpers.
//
// The response wire shape is the `input_image` content item from
// codex-rs/protocol/src/models.rs: an untagged ImageReference has either an
// `image_url` or a `file_id`, plus an optional `detail`.  Legacy
// UserMessageEvent stores inline references in `images`, file references in
// `file_ids`, optional details in `file_id_details`, and the optional
// `image_order` split-array reconstruction hint.  These helpers intentionally
// retain only bounded metadata; they never retain image URLs or media bytes.

const ATTACHMENT_SUMMARY_VERSION = 1;
const DEFAULT_MAX_ATTACHMENTS = 32;
const MAX_MAX_ATTACHMENTS = 256;
const DEFAULT_MAX_REFERENCE_CHARS = 256;
const MAX_REFERENCE_CHARS = 1024;
const DEFAULT_MAX_DETAIL_CHARS = 32;
const MAX_DETAIL_CHARS = 128;
const MAX_PREVIEW_TEXT_CHARS = 512;
const MAX_WARNING_COUNT = 16;
const EXTERNALIZED_IMAGE_MARKER = '[embedded image payload externalized; open raw refs for source]';

const ATTACHMENT_KIND = Object.freeze({
  INLINE: 'inline',
  FILE: 'file',
  INVALID: 'invalid',
});

function boundedPositiveInteger(value, fallback, maximum) {
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function boundedString(value, maximum) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length <= maximum) return { value: text, truncated: false };
  if (maximum <= 1) return { value: text.slice(0, maximum), truncated: true };
  return { value: `${text.slice(0, maximum - 1)}…`, truncated: true };
}

function boundedOpaqueString(value, maximum) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.length <= maximum) return { value, truncated: false };
  if (maximum <= 1) return { value: value.slice(0, maximum), truncated: true };
  return { value: `${value.slice(0, maximum - 1)}…`, truncated: true };
}

function normalizeOptions(options = {}) {
  return {
    maxAttachments: boundedPositiveInteger(
      options.maxAttachments,
      DEFAULT_MAX_ATTACHMENTS,
      MAX_MAX_ATTACHMENTS,
    ),
    maxReferenceChars: boundedPositiveInteger(
      options.maxReferenceChars,
      DEFAULT_MAX_REFERENCE_CHARS,
      MAX_REFERENCE_CHARS,
    ),
    maxDetailChars: boundedPositiveInteger(
      options.maxDetailChars,
      DEFAULT_MAX_DETAIL_CHARS,
      MAX_DETAIL_CHARS,
    ),
  };
}

function normalizeDetail(value, options) {
  if (value == null) return { value: '', warning: '' };
  const bounded = boundedString(value, options.maxDetailChars);
  if (!bounded) return { value: '', warning: 'invalid_detail' };
  return {
    value: bounded.value,
    warning: '',
    truncated: bounded.truncated,
  };
}

function addCandidateWarning(candidate, warning) {
  if (!warning) return candidate;
  return {
    ...candidate,
    warnings: [...(candidate.warnings || []), warning],
  };
}

function responseImageCandidate(item, sourceIndex, options) {
  const hasInline = typeof item?.image_url === 'string' && Boolean(item.image_url.trim());
  const hasFile = typeof item?.file_id === 'string' && Boolean(item.file_id.trim());
  const detail = normalizeDetail(item?.detail, options);
  const inlineIdentityComplete = hasInline && item.image_url !== EXTERNALIZED_IMAGE_MARKER;

  // ImageReference is an untagged union. A dual-valued item is malformed;
  // keep one bounded invalid slot as evidence instead of inventing two images
  // or choosing one reference by precedence.
  if (hasInline && hasFile) {
    return addCandidateWarning(addCandidateWarning({
      kind: ATTACHMENT_KIND.INVALID,
      source: 'response_content',
      sourceIndex,
      issue: 'multiple_image_references',
      detail,
      identityComplete: false,
    }, 'multiple_image_references'), detail.warning);
  }
  if (hasInline) {
    return addCandidateWarning({
      kind: ATTACHMENT_KIND.INLINE,
      source: 'response_content',
      sourceIndex,
      detail,
      identityToken: inlineIdentityComplete ? item.image_url : '',
      identityComplete: inlineIdentityComplete,
    }, detail.warning);
  }
  if (hasFile) {
    const fileId = boundedOpaqueString(item.file_id, options.maxReferenceChars);
    return addCandidateWarning({
      kind: ATTACHMENT_KIND.FILE,
      source: 'response_content',
      sourceIndex,
      fileId: fileId.value,
      fileIdTruncated: fileId.truncated,
      detail,
      identityToken: item.file_id,
      identityComplete: true,
    }, detail.warning);
  }
  return addCandidateWarning(addCandidateWarning({
    kind: ATTACHMENT_KIND.INVALID,
    source: 'response_content',
    sourceIndex,
    issue: 'missing_image_reference',
    detail,
    identityComplete: false,
  }, 'missing_image_reference'), detail.warning);
}

function responseContentCandidates(content, options) {
  if (!Array.isArray(content)) return { candidates: [], warning: '' };
  return {
    candidates: (function* responseCandidates() {
      for (let index = 0; index < content.length; index += 1) {
        const item = content[index];
        if (!item || typeof item !== 'object' || Array.isArray(item) || item.type !== 'input_image') continue;
        yield responseImageCandidate(item, index, options);
      }
    }()),
    warning: '',
  };
}

function legacyImageCandidate(kind, value, sourceIndex, detailValue, options) {
  const detail = normalizeDetail(detailValue, options);
  if (kind === ATTACHMENT_KIND.INLINE) {
    const bounded = boundedString(value, options.maxReferenceChars);
    if (bounded) {
      const identityComplete = value !== EXTERNALIZED_IMAGE_MARKER;
      return addCandidateWarning({
        kind,
        source: 'legacy_images',
        sourceIndex,
        detail,
        identityToken: identityComplete ? value : '',
        identityComplete,
      }, detail.warning);
    }
    return addCandidateWarning(addCandidateWarning({
      kind: ATTACHMENT_KIND.INVALID,
      source: 'legacy_images',
      sourceIndex,
      issue: 'invalid_inline_reference',
      detail,
      identityComplete: false,
    }, 'invalid_inline_reference'), detail.warning);
  }

  const fileId = boundedOpaqueString(value, options.maxReferenceChars);
  if (fileId) {
    return addCandidateWarning({
      kind,
      source: 'legacy_file_ids',
      sourceIndex,
      fileId: fileId.value,
      fileIdTruncated: fileId.truncated,
      detail,
      identityToken: value,
      identityComplete: true,
    }, detail.warning);
  }
  return addCandidateWarning(addCandidateWarning({
    kind: ATTACHMENT_KIND.INVALID,
    source: 'legacy_file_ids',
    sourceIndex,
    issue: 'invalid_file_id',
    detail,
    identityComplete: false,
  }, 'invalid_file_id'), detail.warning);
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.hasOwn(value, key));
}

function arrayField(payload, key, warnings) {
  if (!hasOwn(payload, key)) return [];
  if (Array.isArray(payload[key])) return payload[key];
  warnings.push(`${key}_not_array`);
  return [];
}

function legacyOrderPlan(payload, images, fileIds, warnings) {
  const total = images.length + fileIds.length;
  const hasOrder = hasOwn(payload, 'image_order');
  const imageOrder = payload?.image_order;
  const malformedStorageField = warnings.some((warning) => (
    warning === 'images_not_array' || warning === 'file_ids_not_array'
  ));

  if (!hasOrder) {
    const singleStorageKind = images.length === 0 || fileIds.length === 0;
    return {
      mode: !total ? 'none' : singleStorageKind && !malformedStorageField
        ? 'single_kind_array'
        : 'compatibility_inline_then_file',
      reliable: singleStorageKind && !malformedStorageField,
      reason: total && (!singleStorageKind || malformedStorageField) ? 'image_order_missing' : '',
      expectedCount: total,
      observedCount: 0,
      sequence: (function* compatibilitySequence() {
        for (let index = 0; index < images.length; index += 1) {
          yield { kind: ATTACHMENT_KIND.INLINE, sourceIndex: index };
        }
        for (let index = 0; index < fileIds.length; index += 1) {
          yield { kind: ATTACHMENT_KIND.FILE, sourceIndex: index };
        }
      }()),
    };
  }

  if (!Array.isArray(imageOrder)) {
    warnings.push('image_order_not_array');
    return fallbackLegacyOrder(images, fileIds, total, 'image_order_not_array');
  }

  const inlineCount = imageOrder.filter((kind) => kind === 'inline').length;
  const fileCount = imageOrder.filter((kind) => kind === 'file').length;
  const hasInvalidValue = imageOrder.some((kind) => kind !== 'inline' && kind !== 'file');
  if (imageOrder.length !== total) {
    warnings.push('image_order_count_mismatch');
    return fallbackLegacyOrder(images, fileIds, total, 'image_order_count_mismatch', imageOrder.length);
  }
  if (hasInvalidValue) {
    warnings.push('image_order_value_invalid');
    return fallbackLegacyOrder(images, fileIds, total, 'image_order_value_invalid', imageOrder.length);
  }
  if (inlineCount !== images.length || fileCount !== fileIds.length) {
    warnings.push('image_order_kind_counts_mismatch');
    return fallbackLegacyOrder(images, fileIds, total, 'image_order_kind_counts_mismatch', imageOrder.length);
  }

  return {
    mode: 'image_order',
    reliable: true,
    reason: '',
    expectedCount: total,
    observedCount: imageOrder.length,
    sequence: (function* orderedSequence() {
      let inlineIndex = 0;
      let fileIndex = 0;
      for (const kind of imageOrder) {
        if (kind === 'inline') {
          yield { kind: ATTACHMENT_KIND.INLINE, sourceIndex: inlineIndex };
          inlineIndex += 1;
        } else {
          yield { kind: ATTACHMENT_KIND.FILE, sourceIndex: fileIndex };
          fileIndex += 1;
        }
      }
    }()),
  };
}

function fallbackLegacyOrder(images, fileIds, total, reason, observedCount = 0) {
  return {
    mode: total ? 'fallback_inline_then_file' : 'none',
    reliable: false,
    reason: total ? reason : '',
    expectedCount: total,
    observedCount,
    sequence: (function* fallbackSequence() {
      for (let index = 0; index < images.length; index += 1) {
        yield { kind: ATTACHMENT_KIND.INLINE, sourceIndex: index };
      }
      for (let index = 0; index < fileIds.length; index += 1) {
        yield { kind: ATTACHMENT_KIND.FILE, sourceIndex: index };
      }
    }()),
  };
}

function legacyCandidates(payload, options) {
  const warnings = [];
  const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const images = arrayField(value, 'images', warnings);
  const fileIds = arrayField(value, 'file_ids', warnings);
  const fileIdDetails = arrayField(value, 'file_id_details', warnings);
  if (hasOwn(value, 'file_id_details') && fileIdDetails.length !== fileIds.length) {
    warnings.push('file_id_details_count_mismatch');
  }
  const plan = legacyOrderPlan(value, images, fileIds, warnings);
  return {
    warnings,
    order: plan,
    candidates: (function* legacySequence() {
      for (const item of plan.sequence) {
        const detail = item.kind === ATTACHMENT_KIND.FILE ? fileIdDetails[item.sourceIndex] : undefined;
        yield legacyImageCandidate(item.kind, item.kind === ATTACHMENT_KIND.INLINE
          ? images[item.sourceIndex]
          : fileIds[item.sourceIndex], item.sourceIndex, detail, options);
      }
    }()),
  };
}

function collectWarnings(warnings, candidate) {
  for (const warning of candidate?.warnings || []) {
    if (!warnings.includes(warning) && warnings.length < MAX_WARNING_COUNT) warnings.push(warning);
  }
}

function updateAttachmentIdentity(hash, candidate) {
  const kind = typeof candidate?.kind === 'string' ? candidate.kind : '';
  const token = typeof candidate?.identityToken === 'string' ? candidate.identityToken : '';
  // Length-prefix each component so concatenation cannot create ambiguous
  // identities. The complete input token is hashed and then discarded. Image
  // detail is a rendering hint, so it is intentionally excluded from image
  // identity and mirror ownership.
  hash.update(`${kind.length}:${kind}|${token.length}:${token}\n`, 'utf8');
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function previewTextFor(summary) {
  if (!summary.totalCount) return '';
  const parts = [];
  if (summary.inlineCount) {
    parts.push(`${summary.inlineCount} inline ${pluralize(summary.inlineCount, 'image')}`);
  }
  if (summary.fileCount) {
    parts.push(`${summary.fileCount} file-backed ${pluralize(summary.fileCount, 'image')}`);
  }
  if (summary.invalidCount) {
    parts.push(`${summary.invalidCount} ${pluralize(summary.invalidCount, 'image reference')} could not be summarized`);
  }
  let preview = `${summary.totalCount} ${pluralize(summary.totalCount, 'image attachment')}`;
  if (parts.length) preview += `: ${parts.join(', ')}`;
  if (summary.fileCount && summary.inlineCount === 0 && summary.invalidCount === 0) {
    preview += '; the transcript contains only file references, so no local preview is available';
  } else if (summary.fileCount) {
    preview += '; file references have no local preview';
  }
  if (!summary.order.reliable && summary.totalCount > 1) preview += '; attachment order evidence is incomplete';
  if (summary.omittedCount) preview += `; ${summary.omittedCount} more omitted from this bounded summary`;
  return preview.slice(0, MAX_PREVIEW_TEXT_CHARS);
}

function summarizeCandidates(candidates, options, metadata = {}) {
  const attachments = [];
  const warnings = [...(metadata.warnings || [])];
  const identityHash = crypto.createHash('sha256');
  let totalCount = 0;
  let inlineCount = 0;
  let fileCount = 0;
  let invalidCount = 0;
  let identityComplete = metadata.identityComplete !== false;

  identityHash.update('codex-attachments-v1\n', 'utf8');

  for (const candidate of candidates || []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const position = totalCount;
    totalCount += 1;
    updateAttachmentIdentity(identityHash, candidate);
    if (candidate.identityComplete !== true) identityComplete = false;
    if (candidate.kind === ATTACHMENT_KIND.INLINE) inlineCount += 1;
    else if (candidate.kind === ATTACHMENT_KIND.FILE) fileCount += 1;
    else invalidCount += 1;
    collectWarnings(warnings, candidate);

    if (attachments.length >= options.maxAttachments) continue;
    const attachment = {
      position,
      source: typeof candidate.source === 'string' ? candidate.source : '',
      sourceIndex: Number.isSafeInteger(candidate.sourceIndex) ? candidate.sourceIndex : null,
      kind: candidate.kind,
    };
    if (candidate.kind === ATTACHMENT_KIND.FILE) {
      attachment.fileId = candidate.fileId || '';
      if (candidate.fileIdTruncated) attachment.fileIdTruncated = true;
    }
    if (candidate.detail?.value) {
      attachment.detail = candidate.detail.value;
      if (candidate.detail.truncated) attachment.detailTruncated = true;
    }
    if (candidate.kind === ATTACHMENT_KIND.INVALID) attachment.issue = candidate.issue || 'invalid_reference';
    attachments.push(attachment);
  }

  const summary = {
    version: ATTACHMENT_SUMMARY_VERSION,
    attachments,
    totalCount,
    inlineCount,
    fileCount,
    invalidCount,
    omittedCount: Math.max(0, totalCount - attachments.length),
    truncated: totalCount > attachments.length,
    hasFileReferences: fileCount > 0,
    identity: {
      algorithm: 'sha256',
      complete: identityComplete,
      digest: identityHash.digest('hex'),
      count: totalCount,
    },
    order: {
      source: metadata.order?.source || 'unknown',
      mode: metadata.order?.mode || 'none',
      reliable: metadata.order?.reliable === true,
      reason: metadata.order?.reason || '',
      expectedCount: Number.isSafeInteger(metadata.order?.expectedCount)
        ? metadata.order.expectedCount
        : totalCount,
      observedCount: Number.isSafeInteger(metadata.order?.observedCount)
        ? metadata.order.observedCount
        : totalCount,
    },
    warnings: warnings.slice(0, MAX_WARNING_COUNT),
  };
  summary.previewText = previewTextFor(summary);
  return summary;
}

function summarizeResponseContentAttachments(content, options = {}) {
  const normalized = normalizeOptions(options);
  const source = responseContentCandidates(content, normalized);
  return summarizeCandidates(source.candidates, normalized, {
    order: {
      source: 'response_content',
      mode: Array.isArray(content) ? 'content_array' : 'none',
      reliable: Array.isArray(content),
      reason: '',
    },
    warnings: source.warning ? [source.warning] : [],
  });
}

function summarizeLegacyImageAttachments(payload, options = {}) {
  const normalized = normalizeOptions(options);
  const source = legacyCandidates(payload, normalized);
  return summarizeCandidates(source.candidates, normalized, {
    order: {
      source: 'legacy_split_arrays',
      mode: source.order.mode,
      reliable: source.order.reliable,
      reason: source.order.reason,
      expectedCount: source.order.expectedCount,
      observedCount: source.order.observedCount,
    },
    warnings: source.warnings,
    identityComplete: source.order.reliable,
  });
}

function responseContentFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Array.isArray(payload.content)) return payload.content;
  if (Array.isArray(payload.output)) return payload.output;
  return null;
}

function summarizeResponsePayloadAttachments(payload, options = {}) {
  const content = responseContentFromPayload(payload);
  return summarizeResponseContentAttachments(content, options);
}

function summarizeCodexAttachments(value, options = {}) {
  if (Array.isArray(value)) return summarizeResponseContentAttachments(value, options);
  if (!value || typeof value !== 'object') return summarizeResponseContentAttachments(null, options);
  if (Array.isArray(value.content) || Array.isArray(value.output)) {
    return summarizeResponsePayloadAttachments(value, options);
  }
  if (['images', 'file_ids', 'file_id_details', 'image_order'].some((key) => hasOwn(value, key))) {
    return summarizeLegacyImageAttachments(value, options);
  }
  return summarizeResponseContentAttachments(null, options);
}

module.exports = {
  ATTACHMENT_KIND,
  ATTACHMENT_SUMMARY_VERSION,
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_REFERENCE_CHARS,
  summarizeCodexAttachments,
  summarizeLegacyImageAttachments,
  summarizeResponseContentAttachments,
  summarizeResponsePayloadAttachments,
};
