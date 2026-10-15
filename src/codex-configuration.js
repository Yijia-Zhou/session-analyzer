'use strict';

const { buildRawTurnOwnershipIndex } = require('./codex-cache-observation');
const { rawRef } = require('./codex-source');

// Recorded evidence only. These tracks never establish backend-effective settings.
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value ? value : '';
const dictionary = () => Object.create(null);
const kinds = ['thread_settings', 'turn_context', 'effort_update'];
function field(node, key) {
  if (!object(node) || !Object.hasOwn(node, key)) return { state: 'missing' };
  const value = node[key];
  if (value === null) return { state: 'null' };
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value
    ? { state: 'value', value } : { state: 'invalid' };
}
function collaboration(node) {
  if (!object(node?.collaboration_mode?.settings)) return {};
  return { collaboration: { model: field(node.collaboration_mode.settings, 'model'),
    effort: field(node.collaboration_mode.settings, 'reasoning_effort') } };
}
function extractConfigurationFact(record) {
  const p = record?.payload;
  if (!object(p)) return null;
  if (record.type === 'turn_context') return { kind: 'turn_context', ownerId: identity(p.turn_id),
    model: field(p, 'model'), effort: field(p, 'effort'), ...collaboration(p) };
  if (record.type === 'event_msg' && p.type === 'thread_settings_applied') return {
    kind: 'thread_settings', ownerId: object(p.thread_settings) ? identity(p.thread_id) : '', model: field(p.thread_settings, 'model'),
    effort: field(p.thread_settings, 'reasoning_effort'), ...collaboration(p.thread_settings) };
  if (record.type === 'response_item' && p.type === 'configuration_update'
      && object(record.metadata) && record.metadata.harness_authored_configuration === true) {
    return { kind: 'effort_update', ownerId: '', effort: field(p.reasoning, 'effort') };
  }
  if (record.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'ContextCompaction'
      && identity(p.thread_id) && identity(p.turn_id) && identity(p.item.id)) {
    return { kind: 'compaction', ownerId: identity(p.thread_id) };
  }
  return null;
}
function validField(value) {
  return object(value) && (value.state === 'value'
    ? Object.keys(value).length === 2 && Boolean(identity(value.value))
    : Object.keys(value).length === 1 && ['missing', 'null', 'invalid'].includes(value.state));
}
function validConfigurationFact(fact) {
  if (!object(fact) || typeof fact.ownerId !== 'string' || (fact.ownerId && !identity(fact.ownerId))) return false;
  if (fact.kind === 'compaction') return Object.keys(fact).length === 2 && Boolean(fact.ownerId);
  if (!kinds.includes(fact.kind) || !validField(fact.effort)) return false;
  const expected = ['kind', 'ownerId', 'effort'];
  if (fact.kind !== 'effort_update') { expected.push('model'); if (!validField(fact.model)) return false; }
  else if (fact.ownerId !== '') return false;
  if (Object.hasOwn(fact, 'collaboration')) {
    if (fact.kind === 'effort_update' || !object(fact.collaboration) || Object.keys(fact.collaboration).length !== 2
        || !validField(fact.collaboration.model) || !validField(fact.collaboration.effort)) return false;
    expected.push('collaboration');
  }
  return Object.keys(fact).length === expected.length && Object.keys(fact).every(key => expected.includes(key));
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function sessionConfiguration(session) {
  const owned = raw => !raw.subagentInherited && session._forkSegmentsByRawId?.get(raw.rawId) !== 'inherited_context';
  // Retain excluded rows as discontinuities; filtering before walking could bridge inherited history.
  const ownership = buildRawTurnOwnershipIndex(session.rawEvents.filter(owned));
  const locations = new Map();
  for (const raw of session.rawEvents) {
    const key = JSON.stringify([raw.source.file.replace(/\\/g, '/'), raw.source.line]);
    locations.set(key, (locations.get(key) || 0) + 1);
  }
  const observations = [], evidence = [], byRawId = new Map(), events = dictionary();
  const active = { thread_settings: null, turn_context: null, effort_update: null };
  let owner = '', ownerRef = null, ownershipBroken = false;
  const candidate = raw => Boolean(identity(raw.turnId)) || ['turn_context', 'compacted'].includes(raw.recordType)
    || (raw.recordType === 'response_item' && raw.payloadType === 'configuration_update')
    || (raw.recordType === 'event_msg' && ['thread_settings_applied', 'task_started', 'turn_started',
      'task_complete', 'turn_complete', 'turn_aborted', 'thread_rolled_back', 'context_compacted', 'item_completed'].includes(raw.payloadType));
  function recordEvidence(raw) {
    if (!candidate(raw)) return;
    const ref = rawRef(raw);
    for (const index of Object.values(active)) if (index !== null) {
      const refs = evidence[index];
      if (refs.at(-1)?.rawId !== ref.rawId) refs.push(ref);
    }
  }
  function close(kind, raw, endReason) {
    const index = active[kind];
    if (index === null) return;
    const observation = observations[index];
    observation.endReason = endReason;
    if (raw) {
      observation.end = rawRef(raw);
      if (observation.start.rawId !== raw.rawId) observation.rawRefs.push(observation.end);
    }
    active[kind] = null;
  }
  const closeTurn = (raw, reason) => { close('turn_context', raw, reason); close('effort_update', raw, reason); };
  function open(fact, raw) {
    close(fact.kind, raw, fact.kind === 'effort_update' ? 'next_update' : 'next_snapshot');
    const start = rawRef(raw);
    const { ownerId: _ownerId, ...values } = fact;
    active[fact.kind] = observations.length;
    observations.push({ ...values, start, rawRefs: [start], endReason: 'snapshot_end' });
    evidence.push(ownerRef && fact.kind !== 'thread_settings' ? [ownerRef] : []);
  }
  for (const raw of session.rawEvents) {
    recordEvidence(raw);
    const location = JSON.stringify([raw.source.file.replace(/\\/g, '/'), raw.source.line]);
    if (!owned(raw) || locations.get(location) !== 1) {
      closeTurn(raw, 'ownership_gap'); close('thread_settings', raw, 'ownership_gap');
      owner = ''; ownerRef = null; ownershipBroken = true;
      byRawId.set(raw.rawId, []);
      continue;
    }
    const assigned = ownership.byRawId.get(raw.rawId);
    if (identity(raw.turnId)) ownershipBroken = false;
    const turnId = assigned?.conflictReason || assigned?.isTrailing || ownershipBroken ? '' : identity(assigned?.explicitTurnId);
    const started = raw.recordType === 'event_msg' && ['task_started', 'turn_started'].includes(raw.payloadType);
    const completed = raw.recordType === 'event_msg' && ['task_complete', 'turn_complete', 'turn_aborted'].includes(raw.payloadType);
    if (started) {
      closeTurn(raw, 'turn_boundary'); owner = turnId; ownerRef = turnId ? rawRef(raw) : null;
    } else if (turnId !== owner) {
      closeTurn(raw, assigned?.conflictReason || !turnId ? 'ownership_gap' : 'turn_boundary');
      owner = turnId; ownerRef = turnId ? rawRef(raw) : null;
    }
    const fact = raw.configurationFact || extractConfigurationFact(raw.parsed);
    if (fact?.kind === 'thread_settings') {
      // Even an unowned/malformed snapshot stops last-recorded defaults; it cannot seed them.
      close('thread_settings', raw, 'next_snapshot');
      if (fact.ownerId === session.id) open(fact, raw);
    } else if (fact?.kind === 'turn_context') {
      close('turn_context', raw, 'next_snapshot');
      if (fact.ownerId && fact.ownerId === turnId) open(fact, raw);
    } else if (fact?.kind === 'effort_update' && turnId) open(fact, raw);
    recordEvidence(raw);
    byRawId.set(raw.rawId, kinds.map(kind => active[kind]).filter(index => index !== null));
    if (raw.recordType === 'compacted' || (raw.recordType === 'event_msg' && raw.payloadType === 'context_compacted')
        || (fact?.kind === 'compaction' && fact.ownerId === session.id && turnId)) closeTurn(raw, 'compaction');
    if (completed) { closeTurn(raw, 'turn_boundary'); owner = ''; ownerRef = null; }
  }
  for (const event of session.logicalEvents) {
    if (event.layer === 'raw' || !event.rawRefs?.length) continue;
    const selected = new Set();
    const signatures = new Set();
    for (const ref of event.rawRefs) {
      const indices = byRawId.get(ref.rawId) || [];
      signatures.add(indices.join(','));
      for (const index of indices) selected.add(index);
    }
    if (!selected.size) continue;
    const indices = [...selected].sort((a, b) => a - b);
    events[event.id] = { indices: indices.slice(0, 8), mixed: signatures.size > 1, truncated: indices.length > 8 };
  }
  return { observations, evidence, events };
}
function createConfigurationBuilder() {
  const sessions = dictionary();
  return {
    addSession(session) { sessions[session.id] = sessionConfiguration(session); },
    finish() { return freeze({ schemaVersion: 1, sessions }); },
  };
}
function selection(index, sessionId, eventId) {
  if (index?.sourceKind !== 'codex') return null;
  const sessions = index.codexConfiguration?.sessions;
  const session = sessions && Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : null;
  const event = session && Object.hasOwn(session.events, eventId) ? session.events[eventId] : null;
  return event ? { session, event } : null;
}
function recordedConfigurationSection(index, sessionId, eventId) {
  const found = selection(index, sessionId, eventId);
  if (!found) return null;
  return { type: 'recorded_configuration', purpose: 'traceability',
    status: found.event.mixed ? 'mixed' : 'recorded',
    observations: found.event.indices.map(i => structuredClone(found.session.observations[i])),
    truncated: found.event.truncated };
}
function configurationEvidenceReferences(index, sessionId, eventId) {
  const found = selection(index, sessionId, eventId);
  if (!found) return [];
  const refs = new Map();
  for (const i of found.event.indices) for (const ref of [...found.session.observations[i].rawRefs, ...found.session.evidence[i]]) refs.set(ref.rawId, ref);
  return [...refs.values()].map(ref => structuredClone(ref));
}
function withRecordedConfiguration(index, session, detail) {
  if (!detail || detail.layer === 'raw') return detail;
  const section = recordedConfigurationSection(index, session.id, detail.id);
  return section ? { ...detail, inspectorSections: [section, ...detail.inspectorSections] } : detail;
}
module.exports = { extractConfigurationFact, validConfigurationFact, createConfigurationBuilder,
  recordedConfigurationSection, configurationEvidenceReferences, withRecordedConfiguration };
