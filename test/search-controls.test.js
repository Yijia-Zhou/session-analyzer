'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const searchControls = require('../src/browser/search-controls');

test('structured search key ignores free text and tracks structural filters', () => {
  const base = searchControls.structuredSearchKey({ q: 'alpha' }, 'main', 'mtime-desc');

  assert.equal(searchControls.structuredSearchKey({ q: 'beta' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchControls.structuredSearchKey({ q: 'alpha', kind: 'command' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchControls.structuredSearchKey({ q: 'alpha', status: 'failed' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchControls.structuredSearchKey({ q: 'alpha', file: 'src/app.js' }, 'main', 'mtime-desc'), base);
  assert.notEqual(searchControls.structuredSearchKey({ q: 'alpha' }, 'protocol', 'mtime-desc'), base);
  assert.notEqual(searchControls.structuredSearchKey({ q: 'alpha' }, 'main', 'start-asc'), base);
});

test('active filter entries and summaries keep file-kind-status order', () => {
  const filters = { status: 'failed', file: 'src/app.js', kind: 'command' };
  const labels = { file: 'File', kind: 'Kind', status: 'Status' };

  assert.deepEqual(searchControls.activeFilterEntries(filters, labels), [
    { key: 'file', value: 'src/app.js', label: 'File' },
    { key: 'kind', value: 'command', label: 'Kind' },
    { key: 'status', value: 'failed', label: 'Status' },
  ]);
  assert.equal(searchControls.filterSummary(filters, labels), 'File: src/app.js · Kind: command · Status: failed');
});

test('search metrics model distinguishes idle, loading, session, and project states', () => {
  assert.deepEqual(searchControls.searchMetricsModel({ scope: 'session' }), { scope: 'session', mode: 'idle' });
  assert.deepEqual(searchControls.searchMetricsModel({ scope: 'project', active: true, loading: true }), {
    scope: 'project', mode: 'loading',
  });
  assert.deepEqual(searchControls.searchMetricsModel({
    scope: 'session', active: true, currentIndex: 2, jumpTargetCount: 12, fullTextCount: 48,
  }), {
    scope: 'session', mode: 'ready', current: 3, jumpTotal: 12, fullTextTotal: 48,
  });
  assert.deepEqual(searchControls.searchMetricsModel({
    scope: 'project', active: true, projectSessionCount: 4, projectEventCount: 11,
  }), {
    scope: 'project', mode: 'ready', sessions: 4, events: 11,
  });
});
