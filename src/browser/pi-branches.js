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

module.exports = { groupPiBranches };
