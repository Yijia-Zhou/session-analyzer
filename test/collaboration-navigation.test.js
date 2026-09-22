'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collaborationNavigation } = require('../src/shared/collaboration-navigation');
const { renderSection } = require('../src/browser/renderers');
const { validateLogicalDetailSection } = require('../src/shared/logical-detail-contract');

test('collaboration navigation requires exact identity and a confirmed owner in the current source index', () => {
  const owner = { id: 'parent', sourceKind: 'codex' };
  const child = { id: 'child', sourceSessionId: 'child', sourceKind: 'codex', parentSessionId: 'parent' };
  const index = { sourceKind: 'codex', repoRoot: '/synthetic/repo', sessions: [owner, child,
    { ...child, id: 'inferred', sourceSessionId: 'inferred', parentSessionInferred: true },
    { ...child, id: 'foreign', sourceSessionId: 'foreign', sourceKind: 'claude' },
    { ...child, id: 'unrelated', sourceSessionId: 'unrelated', parentSessionId: 'other' },
    { ...child, id: 'duplicate-1', sourceSessionId: 'duplicate' },
    { ...child, id: 'duplicate-2', sourceSessionId: 'duplicate' },
  ] };
  const section = { type: 'collaboration', purpose: 'content', fields: [], targets: ['child', 'missing', 'inferred', 'foreign', 'unrelated', 'duplicate', '/root/task'],
    statuses: [{ label: 'child', labelKind: 'agent', status: 'completed' }, { label: 'Status', labelKind: 'generic', status: 'running' }] };
  const detail = { timelineSections: [section], inspectorSections: [] };
  const result = collaborationNavigation(index, owner, detail, 3);
  const links = result.timelineSections[0].targetLinks;
  assert.deepEqual(links.map((item) => item.status), ['resolved', 'missing', 'unconfirmed', 'missing', 'unconfirmed', 'ambiguous', 'missing']);
  assert.deepEqual(links[0].target, { sourceKind: 'codex', repoRoot: '/synthetic/repo', indexRevision: 3, sessionId: 'child', layer: 'main' });
  assert.equal(section.targetLinks, undefined, 'do not mutate cached adapter details');
  validateLogicalDetailSection(result.timelineSections[0]);
  const html = renderSection(result.timelineSections[0]);
  assert.equal((html.match(/data-open-collaboration-session=/g) || []).length, 2, 'target and agent status have separate buttons');
  assert.match(html, /data-collaboration-action="target:0"/);
  assert.match(html, /data-collaboration-action="status:0"/);
  assert.match(html, /Ambiguous session identity/);
  assert.doesNotMatch(html, /data-open-collaboration-session="(?:missing|duplicate|unrelated)"/);
  assert.equal(collaborationNavigation({ ...index, sourceKind: 'claude' }, owner, detail), detail);
});

test('nested Code Mode collaboration uses the same links; unresolved targets cannot contain destinations', () => {
  const owner = { id: 'p', sourceKind: 'codex' };
  const index = { sourceKind: 'codex', repoRoot: '/repo', sessions: [{ id: 'c', sourceKind: 'codex', parentSessionId: 'p' }] };
  const detail = { timelineSections: [{ type: 'code_mode_tool_projection', requestSections: [{ type: 'collaboration', targets: ['c'] }] }], inspectorSections: [] };
  const result = collaborationNavigation(index, owner, detail);
  assert.equal(result.timelineSections[0].requestSections[0].targetLinks[0].status, 'resolved');
  assert.throws(() => validateLogicalDetailSection({ type: 'collaboration', purpose: 'content', targetLinks: [{ label: 'c', status: 'missing', target: {} }] }), /unresolved navigation target/);
});
