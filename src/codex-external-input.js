'use strict';

const { isDeepStrictEqual } = require('node:util');

// Producer: app-server request_processors/turn_processor.rs, Codex e269f216.
// A source name is attribution, never execution or authorization evidence.
function externalToolInputFromRaw(raw) {
  if (raw?.recordType !== 'response_item' || raw.payloadType !== 'function_call_output') return null;
  const payload = raw.parsed?.payload;
  if (!payload || (Object.hasOwn(payload, 'call_id') && payload.call_id !== null)) return null;
  // A conflicting compatibility alias is not a missing identity.
  if (Object.hasOwn(payload, 'callId')) return null;
  if (typeof payload.name !== 'string' || !payload.name.trim()) return null;
  const output = payload.output;
  if (typeof output !== 'string' && !Array.isArray(output)) return null;
  if (Array.isArray(output) && !output.every(validOutputPart)) return null;
  let text = typeof output === 'string' ? output.slice(0, 16000) : '';
  const opaqueContent = new Set();
  if (Array.isArray(output)) {
    for (const part of output) {
      if (typeof part.text === 'string' && part.text && text.length < 16000) {
        text += `${text ? '\n' : ''}${part.text.slice(0, 16000 - text.length)}`;
      }
      if (part.type === 'input_audio' || part.type === 'encrypted_content') opaqueContent.add(part.type);
    }
  }
  return {
    name: payload.name.slice(0, 1000),
    namespace: typeof payload.namespace === 'string' ? payload.namespace.slice(0, 1000) : '',
    text: text.slice(0, 16000),
    ...(opaqueContent.size ? { opaqueContent: [...opaqueContent] } : {}),
  };
}

function validOutputPart(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
  if (part.type === 'input_text') return typeof part.text === 'string';
  if (part.type === 'input_image') {
    return (typeof part.file_id === 'string' && !!part.file_id && !Object.hasOwn(part, 'image_url'))
      || (typeof part.image_url === 'string' && !!part.image_url && !Object.hasOwn(part, 'file_id'));
  }
  if (part.type === 'input_audio') return typeof part.audio_url === 'string';
  if (part.type === 'encrypted_content') return typeof part.encrypted_content === 'string';
  return false;
}

function externalToolInputMirrorsMatch(left, right) {
  if (!externalToolInputFromRaw(left) || !externalToolInputFromRaw(right)) return false;
  const a = left.parsed.payload;
  const b = right.parsed.payload;
  if (a.name !== b.name || (a.namespace ?? null) !== (b.namespace ?? null)) return false;
  // Display text is bounded and omits opaque parts. Compare the entire source
  // output instead; a media placeholder cannot prove the original bytes equal.
  const marker = '[embedded image payload externalized; open raw refs for source]';
  if ([a.output, b.output].some((output) => JSON.stringify(output).includes(marker))) return false;
  return isDeepStrictEqual(a.output, b.output);
}

module.exports = { externalToolInputFromRaw, externalToolInputMirrorsMatch };
