'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detailNavigation } = require('../src/shared/detail-navigation');

test('detail navigation resolves exact layers without scanning ordinary details or guessing ambiguous identities', () => {
  const ordinary = { layer: 'main', timelineSections: [], inspectorSections: [] };
  detailNavigation({ get logicalEvents() { throw new Error('unnecessary scan'); } }, ordinary, 'en');
  const session = { logicalEvents: [{ id: 'main', layer: 'main' }, { id: 'protocol', layer: 'protocol' },
    { id: 'ambiguous', layer: 'main' }, { id: 'ambiguous', layer: 'protocol' }], rawEvents: [{ rawId: 'raw' }] };
  const detail = { ...ordinary, inspectorSections: [{ type: 'event_refs', items: ['main', 'protocol', 'raw', 'missing', 'ambiguous'].map((id) => ({ id })) }] };
  assert.deepEqual(detailNavigation(session, detail, 'en').inspectorSections[0].items.map((item) => item.layer), ['main', 'protocol', 'raw', undefined, undefined]);
  assert.equal(detail.inspectorSections[0].items[0].layer, undefined);
});

test('raw detail navigation lists all exact owners, reuses existing links and explicitly handles no owner', () => {
  const detail = { id: 'r', layer: 'raw', timelineSections: [], inspectorSections: [] };
  const session = { rawEvents: [{ rawId: 'r' }], logicalEvents: [
    { id: 'one', layer: 'main', label: 'Operation', rawRefs: [{ rawId: 'r' }] },
    { id: 'two', layer: 'protocol', label: 'Evidence', rawRefs: [{ rawId: 'r' }] },
    { id: 'other', layer: 'main', rawRefs: [{ rawId: 'another' }] },
  ] };
  const linked = detailNavigation(session, detail, 'zh-CN');
  assert.equal(linked.inspectorSections[0].title, '引用此原始记录的逻辑事件');
  assert.deepEqual(linked.inspectorSections[0].items.map((item) => item.id), ['one', 'two']);
  assert.equal(detailNavigation(session, linked, 'zh-CN').inspectorSections.length, 1);
  const unowned = detailNavigation({ ...session, logicalEvents: [] }, detail, 'en');
  assert.match(unowned.inspectorSections[0].text, /No Logical Event/);
});
