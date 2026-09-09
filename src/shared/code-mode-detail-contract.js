'use strict';

const CODE_MODE_DETAIL_SECTION_KEYS = Object.freeze({
  code_mode_trace: Object.freeze(['phases', 'expanded']),
  code_mode_source: Object.freeze(['code', 'language', 'expanded']),
  code_mode_tool_projection: Object.freeze([
    'toolName',
    'requestEvidence',
    'resultAssociation',
    'requestSections',
    'resultSections',
    'resultObserved',
    'sourceOrder',
  ]),
});

const CODE_MODE_DETAIL_RENDERER_TYPES = Object.freeze(Object.keys(CODE_MODE_DETAIL_SECTION_KEYS));

function validateCodeModeDetailSection(section, path, assertions) {
  const {
    assertAllowedKeys,
    assertArray,
    assertBoolean,
    assertFiniteNumber,
    assertRecord,
    assertString,
    commonSectionKeys,
    detailContractError,
    validateEntries,
    validateSection,
  } = assertions;
  const sectionKeys = CODE_MODE_DETAIL_SECTION_KEYS[section.type];
  if (!sectionKeys) return false;

  assertAllowedKeys(section, [...commonSectionKeys, ...sectionKeys], path);
  if (section.type === 'code_mode_source') {
    assertString(section.code, `${path}.code`);
    assertString(section.language, `${path}.language`, { optional: true });
    assertBoolean(section.expanded, `${path}.expanded`, { optional: true });
    return true;
  }

  if (section.type === 'code_mode_trace') {
    assertArray(section.phases, `${path}.phases`);
    section.phases.forEach((phase, index) => {
      const phasePath = `${path}.phases[${index}]`;
      assertRecord(phase, phasePath);
      assertAllowedKeys(phase, ['kind', 'poll', 'title', 'entries', 'output'], phasePath);
      assertString(phase.kind, `${phasePath}.kind`);
      assertFiniteNumber(phase.poll, `${phasePath}.poll`);
      assertString(phase.title, `${phasePath}.title`, { optional: true });
      validateEntries(phase.entries, `${phasePath}.entries`);
      assertString(phase.output, `${phasePath}.output`);
    });
    assertBoolean(section.expanded, `${path}.expanded`, { optional: true });
    return true;
  }

  if (section.purpose !== 'content') {
    throw detailContractError('Code Mode composite purpose must be content', `${path}.purpose`);
  }
  assertString(section.toolName, `${path}.toolName`);
  assertString(section.requestEvidence, `${path}.requestEvidence`);
  assertString(section.resultAssociation, `${path}.resultAssociation`);
  assertArray(section.requestSections, `${path}.requestSections`);
  assertArray(section.resultSections, `${path}.resultSections`);
  section.requestSections.forEach((child, index) => {
    const childPath = `${path}.requestSections[${index}]`;
    validateSection(child, childPath);
    if (child.purpose !== 'request') {
      throw detailContractError('Code Mode request child purpose must be request', `${childPath}.purpose`);
    }
  });
  section.resultSections.forEach((child, index) => {
    const childPath = `${path}.resultSections[${index}]`;
    validateSection(child, childPath);
    if (child.purpose !== 'result') {
      throw detailContractError('Code Mode result child purpose must be result', `${childPath}.purpose`);
    }
  });
  assertBoolean(section.resultObserved, `${path}.resultObserved`, { optional: true });
  assertFiniteNumber(section.sourceOrder, `${path}.sourceOrder`, { optional: true });
  return true;
}

module.exports = {
  CODE_MODE_DETAIL_RENDERER_TYPES,
  CODE_MODE_DETAIL_SECTION_KEYS,
  validateCodeModeDetailSection,
};
