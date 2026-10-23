'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupPiBranches } = require('../src/browser/pi-branches');

test('native pi grouping preserves canonical selection and visible branch order', () => {
  const a = Object.freeze({ id: 'canonical-a', sourceKind: 'pi', sourceSessionId: 'native', sourceDerivedId: 'leaf-a' });
  const b = Object.freeze({ id: 'canonical-b', sourceKind: 'pi', sourceSessionId: 'native', sourceDerivedId: 'leaf-b' });
  const c = { id: 'canonical-c', sourceKind: 'pi', sourceSessionId: 'other' };
  const otherSource = { id: 'codex', sourceKind: 'codex', sourceSessionId: 'native' };
  const groups = groupPiBranches(Object.freeze([a, c, otherSource, b]));
  assert.deepEqual(groups, [
    { sourceSessionId: 'native', branches: [a, b] },
    { sourceSessionId: 'other', branches: [c] },
    { session: otherSource },
  ]);
  assert.equal(groups[0].branches[0], a);
});

test('single branches and filtered subsets do not invent hidden siblings or provenance relationships', () => {
  const session = { id: 'canonical', sourceKind: 'pi', sourceSessionId: 'native', parentSession: 'another-native' };
  assert.deepEqual(groupPiBranches([session]), [{ sourceSessionId: 'native', branches: [session] }]);
  assert.deepEqual(groupPiBranches([]), []);
  const missing = { id: 'fallback', sourceKind: 'pi' };
  assert.deepEqual(groupPiBranches([missing]), [{ session: missing }]);
});
