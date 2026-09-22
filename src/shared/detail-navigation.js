'use strict';

const i18n = require('./i18n');
const { sanitizeLogicalDetailValue } = require('./logical-detail-sanitizer');

// Only exact recorded identities are navigable; proximity and path similarity are not relations.
function detailNavigation(session, detail, locale) {
  if (!detail) return detail;
  let targets;
  const targetLayer = (id) => {
    if (!targets) {
      targets = new Map();
      const add = (key, layer) => targets.set(key, targets.has(key) ? null : layer);
      for (const event of session.logicalEvents || []) add(event.id, event.layer);
      for (const raw of session.rawEvents || []) add(raw.rawId, 'raw');
    }
    return targets.get(id);
  };
  const visit = (section) => {
    if (section.type === 'event_refs') return { ...section, title: i18n.sectionTitle(section.title, locale), items: section.items.map((item) => (
      item.layer || !targetLayer(item.id) ? item : { ...item, layer: targetLayer(item.id) }
    )) };
    if (section.type === 'code_mode_tool_projection') return { ...section,
      requestSections: (section.requestSections || []).map(visit), resultSections: (section.resultSections || []).map(visit) };
    return section;
  };
  const inspectorSections = (detail.inspectorSections || []).map(visit);
  if (detail.layer === 'raw') {
    const owners = (session.logicalEvents || []).filter((event) =>
      event.rawRefs?.some((ref) => ref.rawId === detail.id));
    const existing = new Set(inspectorSections.filter((section) => section.type === 'event_refs')
      .flatMap((section) => section.items.map((item) => item.id)));
    const items = owners.filter((event) => !existing.has(event.id)).map((event) => ({
      id: event.id, layer: event.layer, kind: event.kind, status: event.status,
      label: sanitizeLogicalDetailValue(i18n.knownLabel(event.label, locale) || event.label || event.id),
    }));
    if (items.length) inspectorSections.push({ purpose: 'traceability', type: 'event_refs',
      title: i18n.sectionTitle('Logical events using this record', locale), items });
    if (!owners.length) inspectorSections.push({ purpose: 'traceability', type: 'notice', level: 'info',
      text: i18n.t(locale, 'ui', 'rawNoRecordedOwner') });
  }
  return { ...detail, timelineSections: (detail.timelineSections || []).map(visit), inspectorSections };
}

module.exports = { detailNavigation };
