(function initCodeModePresentationContract(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionCodeModePresentationContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCodeModePresentationContractApi() {
  'use strict';

  const CODE_MODE_PRESENTATION_VARIANT = Object.freeze({
    SINGLE_TOOL: 'single_tool',
    MULTI_TOOL: 'multi_tool',
    RAW_CODE_MODE: 'raw_code_mode',
  });
  const CODE_MODE_REQUEST_EVIDENCE = Object.freeze({
    DECLARED_SOURCE: 'declared_source',
  });
  const CODE_MODE_RESULT_ASSOCIATION = Object.freeze({
    EXACT: 'exact',
    BOUNDED: 'bounded',
    NONE: 'none',
  });
  const CODE_MODE_BADGE_IDENTITY = Object.freeze({
    DECLARED_REQUEST: 'declared_request',
    EXACT_RESULT: 'exact_result',
  });

  const PRESENTATION_VARIANTS = new Set(Object.values(CODE_MODE_PRESENTATION_VARIANT));
  const REQUEST_EVIDENCE_VALUES = new Set(Object.values(CODE_MODE_REQUEST_EVIDENCE));
  const RESULT_ASSOCIATION_VALUES = new Set(Object.values(CODE_MODE_RESULT_ASSOCIATION));

  const DECLARED_REQUEST_BADGE = Object.freeze({
    identity: CODE_MODE_BADGE_IDENTITY.DECLARED_REQUEST,
    className: 'declaredSource',
    labelKey: 'declaredRequest',
  });
  const EXACT_RESULT_BADGE = Object.freeze({
    identity: CODE_MODE_BADGE_IDENTITY.EXACT_RESULT,
    className: 'exactIdentity',
    labelKey: 'resultMatchedExactly',
  });

  function normalizedMember(value, members) {
    return typeof value === 'string' && members.has(value) ? value : '';
  }

  function normalizeCodeModePresentationVariant(value) {
    return normalizedMember(value, PRESENTATION_VARIANTS);
  }

  function normalizeCodeModeRequestEvidence(value) {
    return normalizedMember(value, REQUEST_EVIDENCE_VALUES);
  }

  function normalizeCodeModeResultAssociation(value) {
    return normalizedMember(value, RESULT_ASSOCIATION_VALUES);
  }

  function isCodeModePresentationVariant(value) {
    return Boolean(normalizeCodeModePresentationVariant(value));
  }

  function sanitizeCodeModeDetailPresentationVocabulary(presentation) {
    if (!presentation || typeof presentation !== 'object') return null;
    const variant = normalizeCodeModePresentationVariant(presentation.variant);
    if (!variant) return null;
    return {
      variant,
      requestEvidence: normalizeCodeModeRequestEvidence(presentation.requestEvidence),
      resultAssociation: normalizeCodeModeResultAssociation(presentation.resultAssociation),
    };
  }

  function codeModeRequestEvidenceBadge(value) {
    return value === CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE ? DECLARED_REQUEST_BADGE : null;
  }

  function codeModeResultAssociationBadge(value) {
    return value === CODE_MODE_RESULT_ASSOCIATION.EXACT ? EXACT_RESULT_BADGE : null;
  }

  return {
    CODE_MODE_BADGE_IDENTITY,
    CODE_MODE_PRESENTATION_VARIANT,
    CODE_MODE_REQUEST_EVIDENCE,
    CODE_MODE_RESULT_ASSOCIATION,
    codeModeRequestEvidenceBadge,
    codeModeResultAssociationBadge,
    isCodeModePresentationVariant,
    normalizeCodeModePresentationVariant,
    normalizeCodeModeRequestEvidence,
    normalizeCodeModeResultAssociation,
    sanitizeCodeModeDetailPresentationVocabulary,
  };
}));
