(function initDetailPresentation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionDetailPresentation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function factValue(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function addFact(target, value) {
    const normalized = factValue(value);
    if (normalized) target.add(normalized);
  }

  const ENTRY_FACT_TARGET = Object.freeze({
    time: 'times',
    tool: 'toolNames',
    provider: 'providers',
    model: 'models',
    effort: 'efforts',
    attributionSkill: 'attributionSkills',
    exitCode: 'exitCodes',
    duration: 'durations',
    recordType: 'recordTypes',
    channel: 'channels',
    touchedFile: 'filePaths',
  });

  const METADATA_ITEM_FACT_TARGET = Object.freeze({
    time: 'times',
    tool: 'toolNames',
    provider: 'providers',
    model: 'models',
    effort: 'efforts',
    attributionSkill: 'attributionSkills',
    exitCode: 'exitCodes',
    duration: 'durations',
    recordType: 'recordTypes',
    channels: 'channels',
    touchedFiles: 'filePaths',
  });

  function collectStructuredDetailFacts(sections) {
    const facts = {
      times: new Set(),
      providers: new Set(),
      models: new Set(),
      efforts: new Set(),
      attributionSkills: new Set(),
      exitCodes: new Set(),
      durations: new Set(),
      recordTypes: new Set(),
      channels: new Set(),
      filePaths: new Set(),
      toolNames: new Set(),
    };

    function addEntries(entries) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const target = ENTRY_FACT_TARGET[entry?.fact];
        if (target) addFact(facts[target], entry.fact === 'touchedFile' ? entry.key : entry.value);
      }
    }

    function visit(section) {
      if (!section || typeof section !== 'object') return;
      switch (section.type) {
        case 'kv':
          addEntries(section.entries);
          break;
        case 'patch':
          for (const file of Array.isArray(section.files) ? section.files : []) {
            addFact(facts.filePaths, file?.path);
          }
          break;
        case 'token_usage':
        case 'usage_limits':
          break;
        case 'web_request':
          addEntries(section.options);
          for (const group of Array.isArray(section.groups) ? section.groups : []) {
            for (const item of Array.isArray(group?.items) ? group.items : []) addEntries(item?.entries);
          }
          break;
        case 'collaboration':
          addEntries(section.fields);
          break;
        case 'code_mode_trace':
          for (const phase of Array.isArray(section.phases) ? section.phases : []) addEntries(phase?.entries);
          break;
        case 'code_mode_tool_projection':
          addFact(facts.toolNames, section.toolName);
          for (const child of Array.isArray(section.requestSections) ? section.requestSections : []) visit(child);
          for (const child of Array.isArray(section.resultSections) ? section.resultSections : []) visit(child);
          break;
        default:
          break;
      }
    }

    for (const section of Array.isArray(sections) ? sections : []) visit(section);
    return facts;
  }

  function metadataItemIsRepresented(item, facts) {
    const candidates = [item?.value, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
      .map(factValue)
      .filter(Boolean);
    if (!candidates.length) return false;
    const targetName = METADATA_ITEM_FACT_TARGET[item.id];
    if (!targetName) return false;
    const target = facts[targetName];
    if (item.id === 'touchedFiles' || item.id === 'channels') {
      const values = (Array.isArray(item.sourceValues) ? item.sourceValues : []).map(factValue).filter(Boolean);
      return values.length > 0 && values.every((value) => target.has(value));
    }
    return candidates.some((value) => target.has(value));
  }

  function filterInspectorMetadata(items, sections) {
    const facts = collectStructuredDetailFacts(sections);
    return (Array.isArray(items) ? items : []).filter((item) => (
      item?.value != null
      && item.value !== ''
      && !metadataItemIsRepresented(item, facts)
    ));
  }

  return {
    collectStructuredDetailFacts,
    filterInspectorMetadata,
    metadataItemIsRepresented,
  };
}));
