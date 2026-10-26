'use strict';

// Presentation only: canonical IDs, order within a native session and source
// objects remain unchanged. The first visible member determines group order.
function groupPiBranches(sessions) {
  const groups = [];
  const nativeGroups = new Map();
  for (const session of sessions) {
    if (session.sourceKind !== 'pi' || !session.sourceSessionId) {
      groups.push({ session });
      continue;
    }
    let group = nativeGroups.get(session.sourceSessionId);
    if (!group) {
      group = { sourceSessionId: session.sourceSessionId, branches: [] };
      nativeGroups.set(session.sourceSessionId, group);
      groups.push(group);
    }
    group.branches.push(session);
  }
  return groups;
}

function piSessionTitle(session) {
  return String(session?.title || '').replace(/^\[branch [^\]]*\]\s*/u, '') || session?.sourceSessionId || '';
}

function piPreview(value) {
  if (typeof value === 'string') return value;
  return value?.preview || value?.text || value?.title || '';
}

module.exports = { groupPiBranches, piSessionTitle, piPreview };
