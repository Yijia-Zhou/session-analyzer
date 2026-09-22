'use strict';

// Codex rust-v0.155.0 (f0a1b8f): protocol/realtime.rs, protocol.rs,
// models/configuration_update.rs and history/rollout_payload.rs.
// Source-specific admission. Unknown fields stay in source-backed Raw; these
// projections contain only bounded display facts, never effective settings.
const { isDeepStrictEqual } = require('node:util');
const { rawForkSegment } = require('./codex-forks');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : '';
const scalar = (value) => value === null
  || (typeof value === 'string' && value.length <= 1000);

function factsFromRecord(record) {
  const p = record?.payload;
  if (!object(p)) return null;
  if (record.type === 'realtime_item') {
    if (!identity(p.id) || !identity(p.realtime_session_id)) return null;
    const facts = { type: p.type, itemId: p.id, realtimeSessionId: p.realtime_session_id };
    if (p.type === 'transcript_segment') {
      if (!['user', 'assistant'].includes(p.role) || typeof p.text !== 'string') return null;
      return { ...facts, role: p.role };
    }
    if (p.type === 'realtime_session_started') return facts;
    if (p.type === 'realtime_session_closed' && ['ended', 'failed'].includes(p.outcome)) {
      return { ...facts, outcome: p.outcome };
    }
    if (p.type === 'bem_item_promoted' && identity(p.turn_id) && identity(p.item_id) && object(p.presentation)) {
      const presentation = p.presentation.type;
      if (!['whole_item', 'inline_markdown', 'inline_visualization'].includes(presentation)) return null;
      if (presentation === 'inline_visualization' && (!Number.isSafeInteger(p.presentation.index) || p.presentation.index < 0 || p.presentation.index > 4294967295)) return null;
      return { ...facts, targetTurnId: p.turn_id, targetItemId: p.item_id, presentation,
        ...(presentation === 'inline_visualization' ? { visualizationIndex: p.presentation.index } : {}) };
    }
    return null;
  }
  if (record.type === 'event_msg' && p.type === 'thread_settings_applied') {
    if (!object(p.thread_settings)) return null;
    const s = p.thread_settings;
    if (typeof s.model !== 'string' || !s.model || !scalar(s.model)) return null;
    const values = {};
    for (const key of ['model', 'model_provider_id', 'service_tier', 'reasoning_effort', 'reasoning_summary', 'approvals_reviewer']) {
      if (Object.hasOwn(s, key) && scalar(s[key])) values[key] = s[key];
    }
    if (!Object.keys(values).length) return null;
    if (typeof s.approval_policy === 'string' && scalar(s.approval_policy)) values.approval_policy = s.approval_policy;
    if (object(s.collaboration_mode) && typeof s.collaboration_mode.mode === 'string' && scalar(s.collaboration_mode.mode)) {
      values.collaboration_mode = s.collaboration_mode.mode;
    } else if (s.collaboration_mode === null) values.collaboration_mode = null;
    if (object(s.permission_profile) && ['managed', 'disabled', 'external'].includes(s.permission_profile.type)) {
      values.permission_profile = s.permission_profile.type;
    }
    const facts = { type: p.type, values };
    if (Object.hasOwn(p, 'thread_id')) facts.threadId = identity(p.thread_id) || null;
    return facts;
  }
  if (record.type === 'response_item' && p.type === 'configuration_update'
      && object(p.reasoning) && typeof p.reasoning.effort === 'string' && p.reasoning.effort.length > 0
      && scalar(p.reasoning.effort)) {
    return { type: p.type, effort: p.reasoning.effort,
      harnessAuthored: object(record.metadata) && record.metadata.harness_authored_configuration === true };
  }
  return null;
}

function historyFacts(raw) {
  return raw?.parsed ? factsFromRecord(raw.parsed) : raw?.historyFacts || null;
}

// Reconstruct the admitted wire subset to validate compact/reuse projections.
function validHistoryFacts(f) {
  if (!object(f)) return false;
  let record;
  if (f.type === 'thread_settings_applied') {
    const values = { ...f.values };
    if (typeof values.collaboration_mode === 'string') values.collaboration_mode = { mode: values.collaboration_mode };
    if (typeof values.permission_profile === 'string') values.permission_profile = { type: values.permission_profile };
    record = { type: 'event_msg', payload: { type: f.type, thread_settings: values,
      ...(Object.hasOwn(f, 'threadId') ? { thread_id: f.threadId } : {}) } };
  } else if (f.type === 'configuration_update') {
    record = { type: 'response_item', payload: { type: f.type, reasoning: { effort: f.effort } }, metadata: { harness_authored_configuration: f.harnessAuthored } };
  } else {
    record = { type: 'realtime_item', payload: { type: f.type, id: f.itemId, realtime_session_id: f.realtimeSessionId,
      role: f.role, text: '', outcome: f.outcome, turn_id: f.targetTurnId, item_id: f.targetItemId,
      presentation: { type: f.presentation, index: f.visualizationIndex } } };
  }
  return isDeepStrictEqual(f, factsFromRecord(record));
}

function targetFromRecord(record) {
  const p = record?.payload;
  if (record?.type !== 'event_msg' || p?.type !== 'item_completed' || !object(p.item)
      || typeof p.item.type !== 'string' || !p.item.type
      || !identity(p.item.id) || !identity(p.turn_id) || !identity(p.thread_id)) return null;
  return { itemId: p.item.id, turnId: p.turn_id, threadId: p.thread_id };
}

function validHistoryTarget(value) {
  return object(value) && Object.keys(value).length === 3
    && ['itemId', 'turnId', 'threadId'].every((key) => identity(value[key]));
}

function realtimeIdentity(raw) {
  if (raw?.recordType !== 'realtime_item') return '';
  const p = raw.parsed?.payload;
  const item = p ? identity(p.id) : raw.historyFacts?.itemId;
  const realtime = p ? identity(p.realtime_session_id) : raw.historyFacts?.realtimeSessionId;
  return item && realtime ? JSON.stringify([raw.sessionId, realtime, item]) : '';
}

function isTransientRealtimeRecord(record) {
  return record?.type === 'event_msg' && [
    'realtime_conversation_started', 'realtime_conversation_realtime',
    'realtime_conversation_closed', 'realtime_conversation_sdp',
  ].includes(record.payload?.type);
}

function resolveHistoryReference(session, event) {
  const f = event?.historyFacts;
  if (f?.type !== 'bem_item_promoted') return null;
  if (event.rawRefs.some((ref) => rawForkSegment(session, ref.rawId) === 'inherited_context')) return null;
  const owner = historyOwner(session);
  if (!owner) return null;
  const matches = (session.rawEvents || []).filter((raw) => {
    const target = raw.historyTarget || targetFromRecord(raw.parsed);
    return target?.itemId === f.targetItemId && target.turnId === f.targetTurnId;
  });
  if (matches.length !== 1) return null;
  const raw = matches[0];
  const target = raw.historyTarget || targetFromRecord(raw.parsed);
  if (target.threadId !== owner || rawForkSegment(session, raw.rawId) === 'inherited_context') return null;
  const events = session.logicalEvents.filter((candidate) => candidate.rawRefs.some((ref) => ref.rawId === raw.rawId));
  if (events.length !== 1) return null;
  const semantic = events[0];
  return semantic.kind !== 'protocol'
    ? { id: semantic.id, label: semantic.label, kind: semantic.kind, status: '', layer: semantic.layer }
    : { id: raw.rawId, label: `Raw · ${f.targetItemId}`, kind: 'raw', status: '', layer: 'raw' };
}

function historyOwner(session) {
  const metadata = session.rawEvents?.find((raw) => raw.recordType === 'session_meta');
  return identity(metadata?.sessionMetaId || metadata?.parsed?.payload?.id);
}

module.exports = { factsFromRecord, historyFacts, validHistoryFacts, targetFromRecord, validHistoryTarget, resolveHistoryReference, realtimeIdentity, isTransientRealtimeRecord, historyOwner };
