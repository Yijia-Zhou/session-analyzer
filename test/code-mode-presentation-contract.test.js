'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODE_MODE_BADGE_IDENTITY,
  CODE_MODE_PRESENTATION_VARIANT,
  CODE_MODE_REQUEST_EVIDENCE,
  CODE_MODE_RESULT_ASSOCIATION,
  codeModeRequestEvidenceBadge,
  codeModeResultAssociationBadge,
  normalizeCodeModePresentationVariant,
  normalizeCodeModeRequestEvidence,
  normalizeCodeModeResultAssociation,
  sanitizeCodeModeDetailPresentationVocabulary,
} = require('../src/shared/code-mode-presentation-contract');
const { projectDeclaredCodeModeCalls } = require('../src/codex-code-mode-declared');
const { renderSection } = require('../src/browser/renderers');

test('Code Mode detail-presentation vocabulary admits supported and reserved values but rejects stale aliases', () => {
  assert.deepEqual(Object.values(CODE_MODE_PRESENTATION_VARIANT).sort(), [
    'multi_tool',
    'raw_code_mode',
    'single_tool',
  ]);
  assert.deepEqual(Object.values(CODE_MODE_REQUEST_EVIDENCE), ['declared_source']);
  assert.deepEqual(Object.values(CODE_MODE_RESULT_ASSOCIATION).sort(), ['bounded', 'exact', 'none']);

  for (const value of Object.values(CODE_MODE_PRESENTATION_VARIANT)) {
    assert.equal(normalizeCodeModePresentationVariant(value), value);
  }
  for (const value of Object.values(CODE_MODE_REQUEST_EVIDENCE)) {
    assert.equal(normalizeCodeModeRequestEvidence(value), value);
  }
  for (const value of Object.values(CODE_MODE_RESULT_ASSOCIATION)) {
    assert.equal(normalizeCodeModeResultAssociation(value), value);
  }

  assert.equal(normalizeCodeModePresentationVariant('single_request'), '');
  assert.equal(normalizeCodeModeRequestEvidence('observed_lifecycle'), '');
  assert.equal(normalizeCodeModeResultAssociation('exact_identity'), '');
  assert.equal(normalizeCodeModeResultAssociation('bounded_order'), '');
  assert.equal(sanitizeCodeModeDetailPresentationVocabulary({ variant: 'single_request' }), null);
  assert.deepEqual(sanitizeCodeModeDetailPresentationVocabulary({
    variant: CODE_MODE_PRESENTATION_VARIANT.SINGLE_TOOL,
    requestEvidence: 'observed_lifecycle',
    resultAssociation: 'exact_identity',
  }), {
    variant: CODE_MODE_PRESENTATION_VARIANT.SINGLE_TOOL,
    requestEvidence: '',
    resultAssociation: '',
  });
  assert.deepEqual(sanitizeCodeModeDetailPresentationVocabulary({
    variant: CODE_MODE_PRESENTATION_VARIANT.MULTI_TOOL,
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE,
    resultAssociation: CODE_MODE_RESULT_ASSOCIATION.EXACT,
  }), {
    variant: CODE_MODE_PRESENTATION_VARIANT.MULTI_TOOL,
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE,
    resultAssociation: CODE_MODE_RESULT_ASSOCIATION.EXACT,
  });
});

test('declared-call producer and browser renderer consume the shared evidence contract', () => {
  const bounded = projectDeclaredCodeModeCalls(
    'const result = await tools.get_goal({}); text(result);',
    { outputFragments: ['{"status":"complete"}'] },
  );
  const unassociated = projectDeclaredCodeModeCalls('await tools.get_goal({});');

  assert.equal(bounded.supported, true);
  assert.equal(bounded.calls[0].requestEvidence, CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE);
  assert.equal(bounded.calls[0].resultAssociation, CODE_MODE_RESULT_ASSOCIATION.BOUNDED);
  assert.equal(unassociated.supported, true);
  assert.equal(unassociated.calls[0].requestEvidence, CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE);
  assert.equal(unassociated.calls[0].resultAssociation, CODE_MODE_RESULT_ASSOCIATION.NONE);

  assert.deepEqual(codeModeRequestEvidenceBadge(CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE), {
    identity: CODE_MODE_BADGE_IDENTITY.DECLARED_REQUEST,
    className: 'declaredSource',
    labelKey: 'declaredRequest',
  });
  assert.deepEqual(codeModeResultAssociationBadge(CODE_MODE_RESULT_ASSOCIATION.EXACT), {
    identity: CODE_MODE_BADGE_IDENTITY.EXACT_RESULT,
    className: 'exactIdentity',
    labelKey: 'resultMatchedExactly',
  });
  assert.equal(codeModeRequestEvidenceBadge('observed_lifecycle'), null);
  assert.equal(codeModeResultAssociationBadge('exact_identity'), null);
  assert.equal(codeModeResultAssociationBadge(CODE_MODE_RESULT_ASSOCIATION.BOUNDED), null);
  assert.equal(codeModeResultAssociationBadge(CODE_MODE_RESULT_ASSOCIATION.NONE), null);

  const accepted = renderSection({
    type: 'code_mode_tool_projection',
    title: 'Accepted projection',
    requestEvidence: CODE_MODE_REQUEST_EVIDENCE.DECLARED_SOURCE,
    resultAssociation: CODE_MODE_RESULT_ASSOCIATION.EXACT,
    requestSections: [{ type: 'notice', title: 'Request', text: 'fixture' }],
  });
  const rejected = renderSection({
    type: 'code_mode_tool_projection',
    title: 'Rejected aliases',
    requestEvidence: 'observed_lifecycle',
    resultAssociation: 'exact_identity',
    requestSections: [{ type: 'notice', title: 'Request', text: 'fixture' }],
  });

  assert.match(accepted, /requestEvidence declaredSource">Declared request/);
  assert.match(accepted, /resultAssociation exactIdentity">Result matched exactly/);
  assert.doesNotMatch(rejected, /requestEvidence|resultAssociation/);
});
