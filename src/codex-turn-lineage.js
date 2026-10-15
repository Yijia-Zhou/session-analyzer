'use strict';

const { buildRawTurnOwnershipIndex, turnOwnershipForEvent } = require('./codex-cache-observation');
const { rawRef } = require('./codex-source');

// This is an adapter index, never an alternative token-accounting model.
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value.trim() === value ? value : '';
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
const dictionary = () => Object.create(null);

function extractTurnLineageFact(record) {
  const p = record?.payload;
  if (!p) return null;
  const started = record.type === 'event_msg' && ['task_started', 'turn_started'].includes(p.type);
  if (!started && record.type !== 'turn_context'
      && !(record.type === 'event_msg' && ['task_complete', 'turn_complete', 'turn_aborted'].includes(p.type))) return null;
  if (started && !id(p.turn_id)) return null;
  const a = started ? p.turn_attribution : null;
  const roots = [id(p.root_turn_id)];
  if (a && a.turn_id === p.turn_id) roots.push(id(a.root_turn_id));
  if (!id(p.turn_id) && !roots.some(Boolean)) return null;
  return { turnId: id(p.turn_id), parent: id(a?.parent_turn_id),
    parentInvalid: Boolean(id(a?.parent_turn_id) && a.turn_id !== p.turn_id),
    roots: [...new Set(roots.filter(Boolean))] };
}

function validTurnLineageFact(fact) {
  return Boolean(fact && typeof fact === 'object' && !Array.isArray(fact)
    && Object.keys(fact).length === 4 && typeof fact.turnId === 'string' && (!fact.turnId || id(fact.turnId))
    && typeof fact.parent === 'string' && (!fact.parent || id(fact.parent))
    && typeof fact.parentInvalid === 'boolean' && Array.isArray(fact.roots)
    && fact.roots.length <= 2 && fact.roots.every(id));
}

function relation() { return { values: [], rawRefs: [], invalid: false, evidenceTruncated: false }; }
function observe(fact, value, ref, invalid = false) {
  if (!value) return;
  if (!fact.values.includes(value)) {
    if (fact.values.length < 16) fact.values.push(value);
    else fact.invalid = true;
  }
  fact.invalid ||= invalid;
  if (!fact.rawRefs.some((item) => item.rawId === ref.rawId)) {
    if (fact.rawRefs.length < 32) fact.rawRefs.push(ref);
    else fact.evidenceTruncated = true;
  }
}

function sessionTurnLineage(session) {
  const owned = session.rawEvents.filter((raw) => !raw.subagentInherited
    && session._forkSegmentsByRawId?.get(raw.rawId) !== 'inherited_context');
  const ownership = buildRawTurnOwnershipIndex(owned);
  const turns = dictionary();
  const events = dictionary();
  const ensure = (turnId) => turns[turnId] ||= { turnId, parent: relation(), root: relation(), anchor: null };
  for (const raw of owned) {
    const turnId = id(ownership.byRawId.get(raw.rawId)?.explicitTurnId);
    if (turnId) ensure(turnId);
    const fact = raw.turnLineageFact || extractTurnLineageFact(raw.parsed);
    if (!fact || !(fact.turnId || turnId)) continue;
    const turn = ensure(fact.turnId || turnId);
    const ref = rawRef(raw);
    observe(turn.parent, fact.parent, ref, fact.parentInvalid || fact.parent === fact.turnId);
    for (const root of fact.roots) observe(turn.root, root, ref);
  }
  for (const event of session.logicalEvents) {
    // A representative event.turnId must not hide cross-turn groups or unknown owners.
    if (!event.rawRefs.length || event.rawRefs.some((ref) => !ownership.byRawId.get(ref.rawId)?.explicitTurnId)) continue;
    const association = turnOwnershipForEvent(event, ownership, { preferExplicitTurnId: false });
    const turnId = id(association.explicitTurnId);
    if (!turnId || association.conflictReason) continue;
    events[event.id] = turnId;
    const turn = ensure(turnId);
    if (!turn.anchor || (turn.anchor.layer === 'protocol' && event.layer === 'main')) {
      turn.anchor = { eventId: event.id, layer: event.layer };
    }
  }
  return { turns, events };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function createTurnLineageBuilder() {
  const sessions = dictionary();
  return {
    addSession(session) { sessions[session.id] = sessionTurnLineage(session); },
    finish() {
      const targets = dictionary();
      for (const [sessionId, session] of Object.entries(sessions)) {
        for (const turnId of Object.keys(session.turns)) (targets[turnId] ||= []).push(sessionId);
      }
      // Iterative functional-graph walk: only unique, valid parent identities can prove a cycle.
      const done = new Set();
      for (const [sessionId, session] of Object.entries(sessions)) for (const initial of Object.values(session.turns)) {
        let cursor = { sessionId, turn: initial };
        const path = [], positions = new Map();
        while (cursor) {
          const key = JSON.stringify([cursor.sessionId, cursor.turn.turnId]);
          if (positions.has(key)) {
            for (const turn of path.slice(positions.get(key))) turn.parent.invalid = true;
            break;
          }
          if (done.has(key)) break;
          positions.set(key, path.length);
          path.push(cursor.turn);
          const parent = cursor.turn.parent;
          const matches = targets[parent.values[0]];
          cursor = !parent.invalid && parent.values.length === 1 && matches?.length === 1
            ? { sessionId: matches[0], turn: sessions[matches[0]].turns[parent.values[0]] } : null;
        }
        for (const key of positions.keys()) done.add(key);
      }
      return freeze({ schemaVersion: 1, sessions, targets });
    },
  };
}

function turnLineageSection(index, sessionId, eventId, indexRevision = 0) {
  if (index.sourceKind !== 'codex') return null;
  const directory = index.codexTurnLineage;
  const session = directory && own(directory.sessions, sessionId);
  const turnId = session && own(session.events, eventId);
  const turn = turnId && own(session.turns, turnId);
  if (!turn) return null;
  function resolve(fact, root) {
    const result = { values: [...fact.values], rawRefs: fact.rawRefs.map((ref) => structuredClone(ref)),
      status: 'unrecorded', evidenceTruncated: fact.evidenceTruncated };
    if (!fact.values.length) return result;
    if (fact.values.length > 1) return { ...result, status: 'conflict' };
    if (fact.invalid) return { ...result, status: 'invalid' };
    const targetTurnId = fact.values[0];
    if (root && targetTurnId === turnId) return { ...result, status: 'self' };
    const matches = own(directory.targets, targetTurnId) || [];
    if (matches.length !== 1) return { ...result, status: matches.length ? 'ambiguous' : 'missing' };
    const targetSession = index.sessionsById.get(matches[0]);
    if (!targetSession || targetSession.sourceKind !== 'codex') return { ...result, status: 'missing' };
    const anchor = directory.sessions[matches[0]].turns[targetTurnId].anchor;
    const displayName = String(targetSession.title || '').slice(0, 160);
    if (!anchor) return { ...result, status: 'no_anchor', displayName };
    return { ...result, status: 'resolved', displayName, target: {
      sourceKind: 'codex', repoRoot: index.repoRoot, indexRevision,
      sessionId: matches[0], turnId: targetTurnId, ...anchor,
    } };
  }
  return { type: 'turn_lineage', purpose: 'traceability', turnId,
    parent: resolve(turn.parent, false), root: resolve(turn.root, true) };
}

function withTurnLineage(index, session, detail, indexRevision = 0) {
  if (!detail || detail.layer === 'raw') return detail;
  const section = turnLineageSection(index, session.id, detail.id, indexRevision);
  return section ? { ...detail, inspectorSections: [section, ...detail.inspectorSections] } : detail;
}

module.exports = { createTurnLineageBuilder, extractTurnLineageFact, validTurnLineageFact,
  turnLineageSection, withTurnLineage };
