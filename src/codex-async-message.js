'use strict';

// These values mirror the pinned Codex protocol wire shape at e269f2164cbb9f499e4f22301c393500e2a831f3:
// `codex-rs/protocol/src/protocol.rs::AgentMessageEvent` and
// `codex-rs/core/src/tools/handlers/request_user_input_async.rs` emit the
// legacy `event_msg.payload.type === "agent_message"`; paginated history uses
// `codex-rs/protocol/src/items.rs::AgentMessageItem`, serialized as
// `event_msg.payload.item.type === "AgentMessage"` inside `item_completed`.
const ASYNC_AGENT_MESSAGE_DELIVERY = 'async';
const ASYNC_AGENT_MESSAGE_ITEM_TYPE = 'AgentMessage';
const ASYNC_AGENT_MESSAGE_CONTENT_TYPE = 'Text';
const ASYNC_MESSAGE_TEXT_LIMIT = 16000;
const ASYNC_QUESTION_TITLE_LIMIT = 8000;
const ASYNC_QUESTION_OPTION_LIMIT = 4000;
const ASYNC_QUESTION_LIMIT = 32;
const ASYNC_QUESTION_OPTION_COUNT_LIMIT = 32;
const ASYNC_QUESTION_TOTAL_TEXT_LIMIT = 32000;
const ASYNC_ITEM_ID_LIMIT = 4096;

function boundedString(value, limit) {
  if (typeof value !== 'string') return '';
  return value.slice(0, limit);
}

function boundedIdentity(value) {
  if (typeof value !== 'string') return '';
  if (!value || value.length > ASYNC_ITEM_ID_LIMIT || /\s/.test(value)) return '';
  return value;
}

function normalizeQuestion(question, budget) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return null;
  const sourceTitle = typeof question.title === 'string' ? question.title.trim() : '';
  if (!sourceTitle || budget.remaining <= 0) return null;
  const title = sourceTitle.slice(0, Math.min(ASYNC_QUESTION_TITLE_LIMIT, budget.remaining));
  budget.remaining -= title.length;

  const normalized = { title };
  if (Array.isArray(question.options)) {
    const options = question.options
      .slice(0, ASYNC_QUESTION_OPTION_COUNT_LIMIT)
      .filter((option) => typeof option === 'string' && option.trim())
      .map((option) => option.trim())
      .map((option) => {
        if (budget.remaining <= 0) return '';
        const normalizedOption = option.slice(0, Math.min(ASYNC_QUESTION_OPTION_LIMIT, budget.remaining));
        budget.remaining -= normalizedOption.length;
        return normalizedOption;
      })
      .filter(Boolean);
    // Empty or malformed options are treated as free-text questions.  This
    // keeps a readable title without presenting a choice that was not validly
    // encoded in the source row.
    if (options.length) normalized.options = options;
  }
  return normalized;
}

function normalizeAsyncQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  const budget = { remaining: ASYNC_QUESTION_TOTAL_TEXT_LIMIT };
  return questions
    .slice(0, ASYNC_QUESTION_LIMIT)
    .map((question) => normalizeQuestion(question, budget))
    .filter(Boolean);
}

function textFromCanonicalContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part === 'object' && !Array.isArray(part)
      && part.type === ASYNC_AGENT_MESSAGE_CONTENT_TYPE
      && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .slice(0, ASYNC_MESSAGE_TEXT_LIMIT);
}

function metadataFor({ phase, itemId, questions }) {
  const metadata = { delivery: ASYNC_AGENT_MESSAGE_DELIVERY };
  const normalizedPhase = boundedString(phase, 100).trim();
  const normalizedItemId = boundedIdentity(itemId);
  if (normalizedPhase) metadata.phase = normalizedPhase;
  if (normalizedItemId) metadata.itemId = normalizedItemId;
  const normalizedQuestions = normalizeAsyncQuestions(questions);
  if (normalizedQuestions.length) metadata.questions = normalizedQuestions;
  return metadata;
}

function asyncAgentMessageFromRecord(record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  if (record?.type === 'event_msg' && payload.type === 'agent_message') {
    if (payload.delivery !== ASYNC_AGENT_MESSAGE_DELIVERY) return null;
    const metadata = metadataFor({
      phase: payload.phase,
      questions: payload.questions,
    });
    return {
      ...metadata,
      text: boundedString(payload.message, ASYNC_MESSAGE_TEXT_LIMIT),
      source: 'legacy',
    };
  }

  if (record?.type === 'event_msg'
      && payload.type === 'item_completed'
      && payload.item
      && typeof payload.item === 'object'
      && !Array.isArray(payload.item)
      && payload.item.type === ASYNC_AGENT_MESSAGE_ITEM_TYPE) {
    const item = payload.item;
    if (item.delivery !== ASYNC_AGENT_MESSAGE_DELIVERY) return null;
    const metadata = metadataFor({
      phase: item.phase,
      itemId: item.id,
      questions: item.questions,
    });
    return {
      ...metadata,
      text: textFromCanonicalContent(item.content),
      source: 'canonical',
    };
  }

  return null;
}

function asyncAgentMessageFromRaw(raw) {
  const parsed = raw?.parsed;
  const fromRecord = asyncAgentMessageFromRecord(parsed && typeof parsed === 'object'
    ? {
      ...parsed,
      type: parsed.type || raw?.recordType,
      payload: parsed.payload,
    }
    : {
      type: raw?.recordType,
      payload: null,
    });
  if (fromRecord) return fromRecord;

  const metadata = raw?.asyncMessage;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || metadata.delivery !== ASYNC_AGENT_MESSAGE_DELIVERY) return null;
  return {
    ...metadataFor(metadata),
    text: boundedString(raw.messageText, ASYNC_MESSAGE_TEXT_LIMIT),
    source: metadata.source === 'canonical' ? 'canonical' : 'legacy',
  };
}

function asyncMessageMetadata(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)
      || message.delivery !== ASYNC_AGENT_MESSAGE_DELIVERY) return null;
  return metadataFor(message);
}

function asyncMessageSearchText(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return '';
  const questionText = (Array.isArray(message.questions) ? message.questions : [])
    .flatMap((question) => [
      question?.title,
      ...(Array.isArray(question?.options) ? question.options : []),
    ])
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n');
  return [message.text, questionText].filter((part) => typeof part === 'string' && part.trim()).join('\n');
}

function asyncMessageIdentityMatches(left, right) {
  if (!left || !right) return false;
  const leftId = boundedIdentity(left.itemId);
  const rightId = boundedIdentity(right.itemId);
  // The legacy AgentMessageEvent has no ID, so equal text/questions alone are
  // deliberately insufficient evidence for a canonical/legacy merge.
  if (!leftId || !rightId || leftId !== rightId) return false;
  const leftText = typeof left.text === 'string' ? left.text : '';
  const rightText = typeof right.text === 'string' ? right.text : '';
  if (leftText !== rightText) return false;
  const leftQuestions = JSON.stringify(normalizeAsyncQuestions(left.questions));
  const rightQuestions = JSON.stringify(normalizeAsyncQuestions(right.questions));
  return leftQuestions === rightQuestions;
}

module.exports = {
  ASYNC_AGENT_MESSAGE_CONTENT_TYPE,
  ASYNC_AGENT_MESSAGE_DELIVERY,
  ASYNC_AGENT_MESSAGE_ITEM_TYPE,
  asyncAgentMessageFromRaw,
  asyncAgentMessageFromRecord,
  asyncMessageIdentityMatches,
  asyncMessageMetadata,
  asyncMessageSearchText,
  normalizeAsyncQuestions,
};
