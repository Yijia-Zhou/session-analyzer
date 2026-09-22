'use strict';

// Resolve only identities already exposed by the adapter, inside this index.
// Names, task paths, temporal proximity and raw activity fields are not evidence.
function collaborationNavigation(index, owner, detail, indexRevision = 0) {
  if (!detail || index.sourceKind !== 'codex' || owner.sourceKind !== 'codex') return detail;
  let changed = false;
  function resolve(label) {
    const matches = index.sessions.filter((session) => session.sourceKind === owner.sourceKind
      && (session.id === label || session.sourceSessionId === label));
    if (matches.length > 1) return { label, status: 'ambiguous' };
    const target = matches[0];
    if (!target) return { label, status: 'missing' };
    if (target.id === owner.id || target.parentSessionId !== owner.id || target.parentSessionInferred) {
      return { label, status: 'unconfirmed' };
    }
    return {
      label, status: 'resolved',
      target: { sourceKind: owner.sourceKind, repoRoot: index.repoRoot, indexRevision,
        sessionId: target.id, layer: 'main' },
    };
  }
  function visit(section) {
    if (section.type === 'collaboration') {
      changed = true;
      const labels = [...(section.targets || []), ...(section.statuses || [])
        .filter((item) => item.labelKind === 'agent').map((item) => item.label)];
      return { ...section, targetLinks: [...new Set(labels)].map(resolve) };
    }
    if (section.type === 'code_mode_tool_projection') {
      return { ...section, requestSections: (section.requestSections || []).map(visit),
        resultSections: (section.resultSections || []).map(visit) };
    }
    return section;
  }
  const timelineSections = detail.timelineSections.map(visit);
  const inspectorSections = detail.inspectorSections.map(visit);
  return changed ? { ...detail, timelineSections, inspectorSections } : detail;
}

module.exports = { collaborationNavigation };
