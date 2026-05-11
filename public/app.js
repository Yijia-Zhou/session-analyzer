'use strict';

const rendererApi = window.sessionRenderers || {};

const escapeHtml = rendererApi.escapeHtml || ((value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[ch])));

const renderSections = rendererApi.renderSections || (() => '');
const searchQuery = window.sessionSearchQuery || {
  parseSearchInput: (input) => ({ q: String(input || '').trim(), file: '', kind: '', status: '', layer: '', tokens: [] }),
  removeFreeText: () => '',
  removeOperator: (input) => String(input || ''),
  upsertOperator: (input) => String(input || '').trim(),
};

const NAVIGATION_PAGE_LIMIT = 500;
const KIND_LABELS = {
  user_message: 'User message',
  assistant_message: 'Assistant message',
  command: 'Command',
  patch: 'Patch',
  mcp: 'MCP',
  js_repl: 'JS REPL',
  tool_operation: 'Tool op',
  plan_artifact: 'Plan',
  protocol: 'Protocol',
  error: 'Error',
  compaction: 'Compaction',
  web_search: 'Web search',
};
const STATUS_LABELS = {
  failed: 'Failed',
  success: 'Success',
  completed: 'Completed',
};
const LAYER_LABELS = {
  main: 'Main timeline',
  protocol: 'Protocol layer',
  raw: 'Raw records',
};
const NAVIGATION_CATEGORIES = [
  { id: 'user_messages', label: 'User messages', matches: (event) => event.kind === 'user_message' },
  { id: 'assistant_messages', label: 'Assistant messages', matches: (event) => event.kind === 'assistant_message' },
  { id: 'update_plan', label: 'update_plan calls', matches: isUpdatePlanEvent },
  { id: 'plans', label: 'Plans / update_plan', matches: (event) => event.kind === 'plan_artifact' || isUpdatePlanEvent(event) },
  { id: 'failed_commands', label: 'Failed commands', matches: (event) => event.kind === 'command' && event.status === 'failed' },
  { id: 'commands', label: 'Commands', matches: (event) => event.kind === 'command' },
  { id: 'patch_applied', label: 'Patch applied', matches: (event) => event.kind === 'patch' && event.status === 'success' },
  { id: 'patch_failed', label: 'Patch failed', matches: (event) => event.kind === 'patch' && event.status === 'failed' },
  { id: 'patches', label: 'All patches', matches: (event) => event.kind === 'patch' },
  { id: 'errors_warnings', label: 'Errors / warnings', matches: (event) => event.severity !== 'normal' || event.status === 'failed' || ['error', 'abort', 'rollback', 'compaction'].includes(event.kind) },
  { id: 'mcp_calls', label: 'MCP calls', matches: (event) => event.kind === 'mcp' || String(event.toolName || '').startsWith('mcp__') },
  { id: 'web_searches', label: 'Web searches', matches: (event) => event.kind === 'web_search' },
];

const state = {
  sessions: [],
  selectedSessionId: '',
  selectedEventId: '',
  offset: 0,
  limit: 150,
  sessionGrandTotal: 0,
  sessionTotal: 0,
  timelineTotal: 0,
  currentEvents: [],
  fileSuggestions: [],
  profiles: [],
  profileId: localStorage.getItem('sessionAnalyzer.profile') || 'narrative',
  layerId: localStorage.getItem('sessionAnalyzer.layer') || 'main',
  overrides: JSON.parse(localStorage.getItem('sessionAnalyzer.overrides') || '{}'),
  detailCache: {},
  detailErrors: {},
  detailPending: {},
  detailViewportTimer: 0,
  detailSelectionKey: '',
  navigationCategoryId: '',
  navigationCache: { key: '', events: [], total: 0, pending: null },
  mobileView: 'sessions',
};

const el = {
  stateLine: document.getElementById('stateLine'),
  searchInput: document.getElementById('searchInput'),
  searchAssist: document.getElementById('searchAssist'),
  searchAssistChips: document.getElementById('searchAssistChips'),
  searchField: document.querySelector('.searchField'),
  searchKindSelect: document.getElementById('searchKindSelect'),
  searchStatusSelect: document.getElementById('searchStatusSelect'),
  searchLayerSelect: document.getElementById('searchLayerSelect'),
  searchFileInput: document.getElementById('searchFileInput'),
  searchFileSuggestions: document.getElementById('searchFileSuggestions'),
  profileSelect: document.getElementById('profileSelect'),
  layerSelect: document.getElementById('layerSelect'),
  kindFilter: document.getElementById('kindFilter'),
  statusFilter: document.getElementById('statusFilter'),
  sortSelect: document.getElementById('sortSelect'),
  sessionList: document.getElementById('sessionList'),
  sessionHeader: document.getElementById('sessionHeader'),
  analysisPanel: document.getElementById('analysisPanel'),
  timeline: document.getElementById('timeline'),
  detail: document.getElementById('detail'),
  resetFoldsBtn: document.getElementById('resetFoldsBtn'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  resultSummary: document.getElementById('resultSummary'),
  mobileViewButtons: document.querySelectorAll('[data-mobile-view]'),
};

function setMobileView(view, options = {}) {
  if (!['sessions', 'events', 'detail'].includes(view)) return;
  const changed = state.mobileView !== view;
  state.mobileView = view;
  document.body.dataset.mobileView = view;
  for (const button of el.mobileViewButtons) {
    const active = button.dataset.mobileView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (view === 'events') queueVisibleDetailLoad();
  if (changed && options.scroll !== false && window.matchMedia('(max-width: 760px)').matches) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function api(path) {
  return fetch(path).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n > 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function parsedSearchInput() {
  return searchQuery.parseSearchInput(el.searchInput.value);
}

function currentSearchState() {
  const parsed = parsedSearchInput();
  return {
    q: parsed.q,
    file: parsed.file,
    kind: parsed.kind || el.kindFilter.value,
    status: parsed.status || el.statusFilter.value,
    layer: parsed.layer || state.layerId || 'main',
    parsed,
  };
}

function activeLayerId() {
  return currentSearchState().layer || 'main';
}

function currentQuery(extra = {}) {
  const params = new URLSearchParams();
  const filters = currentSearchState();
  if (filters.q) params.set('q', filters.q);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.status) params.set('status', filters.status);
  if (filters.file) params.set('file', filters.file);
  if (filters.layer) params.set('layer', filters.layer);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== '' && value != null) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function detailKey(sessionId, layerId, eventId) {
  return `${sessionId}:${layerId}:${eventId}`;
}

function resetDetailPane() {
  state.detailSelectionKey = '';
  state.selectedEventId = '';
  state.navigationCategoryId = '';
  el.detail.innerHTML = '<div class="emptyDetail"><h2>Event inspector</h2><p>Select a timeline event to inspect its summary, metadata, and structured detail. Use Raw refs to verify the underlying JSONL rows.</p></div>';
  updateSelectedTimelineEvent();
}

function sourceRefs(event) {
  const refs = event.rawRefs?.length ? event.rawRefs : [event.source];
  return refs.filter((ref) => ref && ref.file && ref.line != null);
}

function sourceLabel(ref) {
  return ref && ref.file && ref.line != null ? `${ref.file}:${ref.line}` : '';
}

function renderChips(values) {
  return values.filter(Boolean).map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join('');
}

function formatList(values, limit = 6) {
  const items = (values || []).filter(Boolean);
  if (!items.length) return '';
  const visible = items.slice(0, limit).join(', ');
  return items.length > limit ? `${visible}, +${items.length - limit} more` : visible;
}

function shortId(value) {
  return String(value || '').slice(0, 8);
}

function sessionRelationshipLabel(session) {
  if (!session.parentSessionId) return '';
  const nickname = session.agentNickname ? ` ${session.agentNickname}` : '';
  const parent = shortId(session.parentSessionId);
  return parent ? `Subagent${nickname} of ${parent}` : `Subagent${nickname}`;
}

function isUpdatePlanEvent(event) {
  return event.toolName === 'update_plan' || event.subtype === 'update_plan' || event.label === 'update_plan';
}

function metadataRow(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderInspectorMetadata(event, refs) {
  return [
    metadataRow('Time', fmtDate(event.timestamp)),
    metadataRow('Source', sourceLabel(event.source || refs[0])),
    metadataRow('Raw refs', refs.length ? String(refs.length) : 'None'),
    metadataRow('Tool', event.toolName),
    metadataRow('Record type', event.recordType),
    metadataRow('Channels', formatList(event.channels)),
    metadataRow('Touched files', formatList(event.touchedFiles)),
  ].join('');
}

function renderInspectorDetail(event) {
  const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
  const detail = state.detailCache[key];
  const error = state.detailErrors[key];
  if (detail) {
    return `<section class="inspectorSection">
      <h3>Structured detail</h3>
      <div class="inspectorDetailBody">${renderSections(detail.sections)}</div>
    </section>`;
  }
  if (error) {
    return `<section class="inspectorSection">
      <h3>Structured detail</h3>
      <div class="notice error"><p>${escapeHtml(error)}</p></div>
      <button class="smallBtn" type="button" data-detail-action="retry-detail">Retry detail</button>
    </section>`;
  }
  return `<section class="inspectorSection">
    <h3>Structured detail</h3>
    <div class="notice info"><p>Loading structured detail...</p></div>
  </section>`;
}

function selectedOptionText(select) {
  return select.selectedOptions[0]?.textContent?.trim() || '';
}

function optionText(select, value, fallback = {}) {
  const option = [...select.options].find((item) => item.value === value);
  return fallback[value] || option?.textContent?.trim() || value;
}

function activeFilters() {
  const filters = [];
  const search = currentSearchState();
  if (search.q) filters.push({ key: 'q', label: `Search: ${search.q}` });
  if (search.kind) filters.push({ key: 'kind', label: `Kind: ${optionText(el.kindFilter, search.kind, KIND_LABELS)}` });
  if (search.status) filters.push({ key: 'status', label: `Status: ${optionText(el.statusFilter, search.status, STATUS_LABELS)}` });
  if (search.file) filters.push({ key: 'file', label: `File: ${search.file}` });
  if (search.layer !== 'main') filters.push({ key: 'layer', label: `Layer: ${optionText(el.layerSelect, search.layer, LAYER_LABELS)}` });
  return filters;
}

function filterChipMarkup(filter) {
  return `<button class="filterChip" type="button" data-clear-filter="${escapeHtml(filter.key)}" aria-label="Clear ${escapeHtml(filter.label)}">
      <span>${escapeHtml(filter.label)}</span><span aria-hidden="true">&times;</span>
    </button>`;
}

function renderFilterChips(filters) {
  return filters.map(filterChipMarkup).join('');
}

function renderSearchAssistChips(filters = activeFilters()) {
  if (!el.searchAssistChips) return;
  if (!filters.length) {
    el.searchAssistChips.innerHTML = '<span class="searchAssistEmpty">None</span>';
    return;
  }
  el.searchAssistChips.innerHTML = `${renderFilterChips(filters)}<button class="clearFiltersBtn" type="button" data-clear-filter="all">Clear all</button>`;
}

function setSelectIfOption(select, value) {
  if (!select) return;
  const hasOption = [...select.options].some((option) => option.value === value);
  select.value = hasOption ? value : '';
}

function syncSearchAssistControls() {
  const search = currentSearchState();
  setSelectIfOption(el.searchKindSelect, search.kind);
  setSelectIfOption(el.searchStatusSelect, search.status);
  setSelectIfOption(el.searchLayerSelect, search.parsed.layer);
  if (el.searchFileInput) el.searchFileInput.value = search.file;
}

function showSearchAssist() {
  if (!el.searchAssist) return;
  el.searchAssist.hidden = false;
  el.searchInput.setAttribute('aria-expanded', 'true');
  syncSearchAssistControls();
  renderSearchAssistChips();
}

function hideSearchAssist() {
  if (!el.searchAssist) return;
  el.searchAssist.hidden = true;
  el.searchInput.setAttribute('aria-expanded', 'false');
}

function focusSearchEnd() {
  el.searchInput.focus();
  const end = el.searchInput.value.length;
  el.searchInput.setSelectionRange(end, end);
}

function applySearchExpression(expression) {
  const text = String(expression || '').trim();
  const parsed = searchQuery.parseSearchInput(text);
  const operatorTokens = parsed.tokens.filter((token) => token.valid);
  if (operatorTokens.length === 1 && !parsed.q) {
    const token = operatorTokens[0];
    if (token.empty) {
      el.searchInput.value = [searchQuery.removeOperator(el.searchInput.value, token.operator), `${token.operator}:`].filter(Boolean).join(' ').trim();
    } else {
      el.searchInput.value = searchQuery.upsertOperator(el.searchInput.value, token.operator, token.value);
    }
  } else {
    el.searchInput.value = text;
  }
  showSearchAssist();
  focusSearchEnd();
  renderSearchAssistChips();
  loadSessions().catch(showError);
}

function applySearchOperator(operator, value) {
  if (!operator) return;
  if (value) {
    el.searchInput.value = searchQuery.upsertOperator(el.searchInput.value, operator, value);
  } else {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, operator);
  }
  syncSearchAssistControls();
  renderSearchAssistChips();
  focusSearchEnd();
  loadSessions().catch(showError);
}

function renderFileSuggestions() {
  if (!el.searchFileSuggestions) return;
  el.searchFileSuggestions.innerHTML = state.fileSuggestions.map((item) => (
    `<option value="${escapeHtml(item.file)}"></option>`
  )).join('');
}

function isSuggestedFile(value) {
  const text = String(value || '').trim();
  return !!text && state.fileSuggestions.some((item) => item.file === text);
}

function renderResultSummary() {
  if (!el.resultSummary) return;
  const filters = activeFilters();
  renderSearchAssistChips(filters);
  if (!filters.length) {
    el.resultSummary.replaceChildren();
    return;
  }
  const sessionTotal = state.sessionGrandTotal || state.sessionTotal;
  const sessionText = sessionTotal
    ? `Sessions: ${state.sessionTotal} match (${sessionTotal} total)`
    : `Sessions: ${state.sessionTotal} match`;
  const eventText = state.selectedSessionId
    ? `Events: ${state.timelineTotal} match${state.offset < state.timelineTotal ? ` (${state.offset} loaded)` : ''}`
    : 'Events: select a session';
  const filterText = renderFilterChips(filters) + '<button class="clearFiltersBtn" type="button" data-clear-filter="all">Clear all</button>';
  el.resultSummary.innerHTML = `<div class="resultCounts">${escapeHtml(sessionText)} · ${escapeHtml(eventText)}</div><div class="activeFilters" aria-label="Active filters">${filterText}</div>`;
}

function clearActiveFilter(key) {
  if (key === 'all') {
    el.searchInput.value = '';
    el.kindFilter.value = '';
    el.statusFilter.value = '';
    state.layerId = 'main';
    el.layerSelect.value = state.layerId;
    localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  } else if (key === 'q') {
    el.searchInput.value = searchQuery.removeFreeText(el.searchInput.value);
  } else if (key === 'file') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'file');
  } else if (key === 'kind') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'kind');
    el.kindFilter.value = '';
  } else if (key === 'status') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'status');
    el.statusFilter.value = '';
  } else if (key === 'layer') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'layer');
    state.layerId = 'main';
    el.layerSelect.value = state.layerId;
    localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  }
  syncSearchAssistControls();
  renderSearchAssistChips();
  loadSessions().catch(showError);
}

function resetTimelineScroll() {
  const pane = el.timeline.closest('.timelinePane');
  if (pane) pane.scrollTop = 0;
}

function clearCurrentSessionOverrides() {
  if (!state.selectedSessionId || !state.overrides[state.selectedSessionId]) return;
  delete state.overrides[state.selectedSessionId];
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
}

async function init() {
  setMobileView(state.mobileView, { scroll: false });
  const [appState, suggestionState] = await Promise.all([
    api('/api/state'),
    api('/api/file-suggestions'),
  ]);
  state.profiles = appState.foldingProfiles || [];
  state.fileSuggestions = suggestionState.files || [];
  state.sessionGrandTotal = appState.totals.sessionCount || 0;
  el.stateLine.textContent = `${appState.repoRoot} | ${appState.totals.sessionCount} sessions | ${appState.totals.eventCount} logical events | ${appState.totals.rawEventCount} raw records`;
  el.profileSelect.innerHTML = state.profiles.map((profile) => (
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`
  )).join('');
  el.profileSelect.value = state.profileId;
  if (!el.profileSelect.value) {
    state.profileId = 'narrative';
    el.profileSelect.value = state.profileId;
  }
  el.layerSelect.value = state.layerId;
  renderFileSuggestions();
  resetDetailPane();
  await loadSessions();
}

async function loadSessions() {
  const data = await api(`/api/sessions${currentQuery({ sort: el.sortSelect.value })}`);
  state.sessions = data.sessions;
  state.sessionTotal = data.total;
  renderSessions();
  if (!state.selectedSessionId && data.sessions[0]) {
    await selectSession(data.sessions[0].id);
  } else if (state.selectedSessionId && !data.sessions.some((session) => session.id === state.selectedSessionId)) {
    state.selectedSessionId = '';
    state.offset = 0;
    state.timelineTotal = 0;
    state.currentEvents = [];
    el.timeline.innerHTML = '';
    el.analysisPanel.innerHTML = '';
    el.loadMoreBtn.disabled = true;
    el.loadMoreBtn.textContent = 'Load more';
    el.sessionHeader.innerHTML = '<h2>No matching session</h2><p>Adjust the search or filters.</p>';
    resetDetailPane();
    renderResultSummary();
  } else if (state.selectedSessionId) {
    await selectSession(state.selectedSessionId);
  } else {
    renderResultSummary();
  }
}

function renderSessions() {
  el.sessionList.innerHTML = state.sessions.map((session) => {
    const active = session.id === state.selectedSessionId ? ' active' : '';
    const relationship = sessionRelationshipLabel(session);
    return `<button class="sessionItem${active}" type="button" data-session-id="${escapeHtml(session.id)}">
      <span class="sessionTitle">${escapeHtml(session.title)}</span>
      <span class="meta">${escapeHtml(fmtDate(session.updatedAt || session.startedAt))} | ${escapeHtml(fmtBytes(session.bytes))}</span>
      <span class="chips">
        ${relationship ? `<span class="chip">${escapeHtml(relationship)}</span>` : ''}
        <span class="chip">${session.counts.messages} msgs</span>
        <span class="chip">${session.counts.toolCalls} tools</span>
        <span class="chip">${session.counts.failedCommands} failed</span>
        <span class="chip">${session.protocolCount} protocol</span>
      </span>
    </button>`;
  }).join('');
}

async function selectSession(sessionId, options = {}) {
  state.selectedSessionId = sessionId;
  state.offset = 0;
  state.currentEvents = [];
  invalidateNavigationCache();
  renderSessions();
  resetDetailPane();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (session) {
    const relationship = sessionRelationshipLabel(session);
    el.sessionHeader.innerHTML = `<h2>${escapeHtml(session.title)}</h2>
      <p>${relationship ? `${escapeHtml(relationship)} | ` : ''}${escapeHtml(session.sourceFile)} | ${escapeHtml(fmtDate(session.startedAt))} - ${escapeHtml(fmtDate(session.updatedAt))}</p>`;
  }
  await Promise.all([loadAnalysis(sessionId), loadTimeline(false)]);
  if (options.mobileView) setMobileView(options.mobileView);
}

async function loadAnalysis(sessionId) {
  const analysis = await api(`/api/sessions/${encodeURIComponent(sessionId)}/analysis`);
  el.analysisPanel.innerHTML = [
    metric('Turns', analysis.counts.turns),
    metric('Messages', analysis.counts.messages),
    metric('Failed commands', analysis.counts.failedCommands),
    metric('Patched files', analysis.patchedFiles.length),
    metric('Protocol', analysis.counts.protocol),
    metric('Plans', analysis.counts.planArtifacts),
  ].join('');
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

async function loadTimeline(append) {
  if (!state.selectedSessionId) return;
  const data = await api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}/timeline${currentQuery({
    offset: append ? state.offset : 0,
    limit: state.limit,
  })}`);
  if (append) {
    state.currentEvents = state.currentEvents.concat(data.events);
  } else {
    state.currentEvents = data.events;
  }
  state.offset = state.currentEvents.length;
  state.timelineTotal = data.total;
  renderTimeline();
  if (!append) resetTimelineScroll();
  el.loadMoreBtn.disabled = state.offset >= data.total;
  el.loadMoreBtn.textContent = state.offset >= data.total ? `Loaded ${state.offset}` : `Load more (${state.offset}/${data.total})`;
  renderResultSummary();
}

function displayState(event) {
  const sessionOverrides = state.overrides[state.selectedSessionId] || {};
  if (sessionOverrides[event.id]) return sessionOverrides[event.id];
  const layer = activeLayerId();

  if (layer === 'protocol') {
    return event.kind === 'protocol' ? 'summary' : 'collapsed';
  }
  if (layer === 'raw') {
    return ['event_msg', 'response_item'].includes(event.recordType) ? 'collapsed' : 'summary';
  }

  const q = currentSearchState().q;
  const profile = q && state.profileId !== 'compact' ? 'search' : state.profileId;

  if (profile === 'compact') return 'collapsed';
  if (profile === 'search') return event.hasSearchHit ? 'expanded' : importantEvent(event) ? 'summary' : 'hidden';
  if (profile === 'conversation') {
    if (['user_message', 'assistant_message', 'plan_artifact'].includes(event.kind)) return 'expanded';
    if (['error', 'abort', 'rollback', 'compaction'].includes(event.kind)) return 'summary';
    return 'hidden';
  }
  if (profile === 'debug') {
    if (event.severity === 'error' || event.status === 'failed') return 'expanded';
    if (['command', 'patch', 'mcp', 'js_repl', 'tool_operation', 'error', 'abort', 'rollback'].includes(event.kind)) return 'summary';
    return 'collapsed';
  }
  if (profile === 'changes') {
    if (['patch', 'plan_artifact'].includes(event.kind)) return 'expanded';
    if (event.kind === 'command' && /\b(test|build|lint|typecheck|git|diff|status)\b/i.test(event.preview)) return 'summary';
    if (event.touchedFiles && event.touchedFiles.length) return 'summary';
    if (['user_message', 'assistant_message'].includes(event.kind)) return 'collapsed';
    return 'hidden';
  }
  if (profile === 'tools') {
    if (['command', 'patch', 'mcp', 'js_repl', 'tool_operation', 'web_search'].includes(event.kind)) return 'summary';
    if (event.severity !== 'normal') return 'summary';
    return 'collapsed';
  }
  if (profile === 'context') {
    if (['token', 'compaction', 'rollback', 'subagent', 'turn', 'abort'].includes(event.kind)) return 'summary';
    return 'hidden';
  }
  if (importantEvent(event)) return 'expanded';
  if (event.kind === 'reasoning' || event.kind === 'token') return 'collapsed';
  return 'summary';
}

function importantEvent(event) {
  return ['user_message', 'assistant_message', 'patch', 'error', 'abort', 'rollback', 'compaction', 'plan_artifact'].includes(event.kind)
    || event.severity !== 'normal'
    || event.status === 'failed';
}

function renderEventBody(event, display) {
  if (display !== 'expanded') return '';
  const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
  const detail = state.detailCache[key];
  const error = state.detailErrors[key];
  if (detail) {
    return `<div class="eventBody">${renderSections(detail.sections)}</div>`;
  }
  if (error) {
    return `<div class="eventBody"><div class="notice error"><p>${escapeHtml(error)}</p></div><button class="smallBtn" type="button" data-action="retry-detail">Retry detail</button></div>`;
  }
  return '<div class="eventBody"><div class="notice info"><p>Loading structured detail...</p></div></div>';
}

function renderEventPreview(event, display) {
  if (display === 'expanded') return '';
  const preview = event.snippet || event.preview || event.label;
  return `<div class="eventPreview">${escapeHtml(preview)}</div>`;
}

function renderTimeline() {
  el.timeline.innerHTML = state.currentEvents.map((event) => {
    const ds = displayState(event);
    const classes = ['event', ds, event.severity, event.id === state.selectedEventId ? 'selected' : '', event.hasSearchHit ? 'searchHit' : '', ds === 'hidden' ? 'hiddenByProfile' : ''].filter(Boolean).join(' ');
    const chips = [
      event.layer ? `<span class="chip">${escapeHtml(event.layer)}</span>` : '',
      event.status ? `<span class="chip">${escapeHtml(event.status)}</span>` : '',
      event.toolName ? `<span class="chip">${escapeHtml(event.toolName)}</span>` : '',
      event.touchedFiles?.length ? `<span class="chip">${event.touchedFiles.length} files</span>` : '',
      event.rawRefs?.length ? `<span class="chip">${event.rawRefs.length} raw</span>` : '',
      event.channels?.length ? `<span class="chip">${escapeHtml(event.channels.join(','))}</span>` : '',
    ].join('');
    const sourceText = event.source ? `${event.source.file}:${event.source.line}` : '';
    return `<article class="${classes}" data-event-id="${escapeHtml(event.id)}">
      <div class="eventHeader">
        <span class="eventKind">${escapeHtml(event.label)}</span>
        <span class="chips">${chips}</span>
        <span class="eventTime">${escapeHtml(fmtDate(event.timestamp))}</span>
      </div>
      ${renderEventPreview(event, ds)}
      ${renderEventBody(event, ds)}
      <div class="eventTools">
        <button class="smallBtn" type="button" data-action="toggle">${ds === 'expanded' ? 'Collapse' : 'Expand'}</button>
        <button class="smallBtn" type="button" data-action="raw">Raw refs</button>
        <span class="rawMeta">${escapeHtml(sourceText)}</span>
      </div>
    </article>`;
  }).join('');
  queueVisibleDetailLoad();
}

function setOverride(eventId, value) {
  if (!state.overrides[state.selectedSessionId]) state.overrides[state.selectedSessionId] = {};
  state.overrides[state.selectedSessionId][eventId] = value;
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
}

function loadEventDetail(event) {
  const layer = activeLayerId();
  const key = detailKey(state.selectedSessionId, layer, event.id);
  if (state.detailCache[key] || state.detailErrors[key]) return Promise.resolve();
  if (!state.detailPending[key]) {
    state.detailPending[key] = api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}/events/${encodeURIComponent(event.id)}/detail?layer=${encodeURIComponent(layer)}`)
      .then((detail) => {
        state.detailCache[key] = detail;
        delete state.detailErrors[key];
      })
      .catch((error) => {
        state.detailErrors[key] = error.message;
      })
      .finally(() => {
        delete state.detailPending[key];
      });
  }
  return state.detailPending[key];
}

function ensureEventDetail(event) {
  const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
  if (state.detailCache[key] || state.detailErrors[key]) return;
  loadEventDetail(event).then(() => renderTimeline());
}

function isInScrollport(element) {
  const rect = element.getBoundingClientRect();
  const scroller = element.closest('.timelinePane');
  const bounds = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  return rect.bottom >= bounds.top && rect.top <= bounds.bottom;
}

function loadVisibleExpandedDetails() {
  state.detailViewportTimer = 0;
  for (const article of el.timeline.querySelectorAll('.event.expanded[data-event-id]')) {
    if (!isInScrollport(article)) continue;
    const item = state.currentEvents.find((candidate) => candidate.id === article.dataset.eventId);
    if (item) ensureEventDetail(item);
  }
}

function queueVisibleDetailLoad() {
  if (state.detailViewportTimer) cancelAnimationFrame(state.detailViewportTimer);
  state.detailViewportTimer = requestAnimationFrame(loadVisibleExpandedDetails);
}

function updateSelectedTimelineEvent() {
  for (const article of el.timeline.querySelectorAll('.event[data-event-id]')) {
    article.classList.toggle('selected', article.dataset.eventId === state.selectedEventId);
  }
}

function navigationCacheKey() {
  const search = currentSearchState();
  return JSON.stringify({
    sessionId: state.selectedSessionId,
    layer: search.layer,
    q: search.q,
    kind: search.kind,
    status: search.status,
    file: search.file,
  });
}

function invalidateNavigationCache() {
  state.navigationCache = { key: '', events: [], total: 0, pending: null };
}

function currentNavigationCache() {
  const key = navigationCacheKey();
  return state.navigationCache.key === key && !state.navigationCache.pending ? state.navigationCache : null;
}

function ensureNavigationEvents() {
  const key = navigationCacheKey();
  if (state.navigationCache.key === key && state.navigationCache.pending) return state.navigationCache.pending;
  if (state.navigationCache.key === key && state.navigationCache.events.length === state.navigationCache.total) {
    return Promise.resolve(state.navigationCache);
  }

  const pending = (async () => {
    const events = [];
    let total = 0;
    while (events.length === 0 || events.length < total) {
      if (navigationCacheKey() !== key) return null;
      const data = await api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}/timeline${currentQuery({
        offset: events.length,
        limit: NAVIGATION_PAGE_LIMIT,
      })}`);
      total = data.total;
      events.push(...data.events);
      if (!data.events.length) break;
    }
    if (navigationCacheKey() !== key) return null;
    state.navigationCache = { key, events, total, pending: null };
    return state.navigationCache;
  })().finally(() => {
    if (state.navigationCache.key === key) state.navigationCache.pending = null;
  });

  state.navigationCache = { key, events: [], total: 0, pending };
  return pending;
}

function navigationCategoriesForEvent(event, events) {
  return NAVIGATION_CATEGORIES
    .map((category) => ({
      ...category,
      matchesInResult: events.filter((candidate) => category.matches(candidate)),
    }))
    .filter((category) => category.matches(event) && category.matchesInResult.length);
}

function defaultNavigationCategoryId(event, categories) {
  const preferred = [
    isUpdatePlanEvent(event) ? 'update_plan' : '',
    event.kind === 'command' && event.status === 'failed' ? 'failed_commands' : '',
    event.kind === 'patch' && event.status === 'success' ? 'patch_applied' : '',
    event.kind === 'patch' && event.status === 'failed' ? 'patch_failed' : '',
    event.severity !== 'normal' || event.status === 'failed' ? 'errors_warnings' : '',
  ].filter(Boolean);
  for (const id of preferred) {
    if (categories.some((category) => category.id === id)) return id;
  }
  return categories[0]?.id || '';
}

function selectedNavigationCategoryId(event, categories) {
  if (state.navigationCategoryId && categories.some((category) => category.id === state.navigationCategoryId)) {
    return state.navigationCategoryId;
  }
  const next = defaultNavigationCategoryId(event, categories);
  state.navigationCategoryId = next;
  return next;
}

function renderInspectorNavigation(event) {
  const cache = currentNavigationCache();
  if (!cache) {
    return '<nav class="eventNavigator" aria-label="Event quick navigation"><span class="navStatus">Loading navigation...</span></nav>';
  }
  const categories = navigationCategoriesForEvent(event, cache.events);
  if (!categories.length) return '';

  const categoryId = selectedNavigationCategoryId(event, categories);
  const category = categories.find((item) => item.id === categoryId) || categories[0];
  const matches = category.matchesInResult;
  const index = matches.findIndex((candidate) => candidate.id === event.id);
  const position = index >= 0 ? index + 1 : 0;
  const options = categories.map((item) => (
    `<option value="${escapeHtml(item.id)}"${item.id === category.id ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
  )).join('');
  return `<nav class="eventNavigator" aria-label="Event quick navigation">
    <select class="navSelect" data-navigation-category aria-label="Quick navigation category">${options}</select>
    <button class="navBtn" type="button" data-detail-action="navigate-event" data-nav-direction="prev"${index <= 0 ? ' disabled' : ''}>Prev</button>
    <span class="navPosition">${escapeHtml(`${position}/${matches.length}`)}</span>
    <button class="navBtn" type="button" data-detail-action="navigate-event" data-nav-direction="next"${index < 0 || index >= matches.length - 1 ? ' disabled' : ''}>Next</button>
  </nav>`;
}

function currentSelectedEvent() {
  return state.currentEvents.find((candidate) => candidate.id === state.selectedEventId)
    || state.navigationCache.events.find((candidate) => candidate.id === state.selectedEventId)
    || null;
}

async function ensureEventLoaded(eventId) {
  if (state.currentEvents.some((event) => event.id === eventId)) return;
  while (state.offset < state.timelineTotal) {
    await loadTimeline(true);
    if (state.currentEvents.some((event) => event.id === eventId)) return;
  }
}

function scrollToTimelineEvent(eventId) {
  const article = el.timeline.querySelector(`[data-event-id="${CSS.escape(eventId)}"]`);
  if (article) article.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function inspectAndRevealEvent(target) {
  await ensureEventLoaded(target.id);
  const loaded = state.currentEvents.find((event) => event.id === target.id) || target;
  if (displayState(loaded) === 'hidden') {
    setOverride(loaded.id, 'summary');
    renderTimeline();
  }
  showInspector(loaded);
  scrollToTimelineEvent(loaded.id);
}

async function navigateSelectedEvent(direction) {
  const current = currentSelectedEvent();
  if (!current) return;
  const cache = await ensureNavigationEvents();
  if (!cache) return;
  const categories = navigationCategoriesForEvent(current, cache.events);
  if (!categories.length) return;
  const categoryId = selectedNavigationCategoryId(current, categories);
  const category = categories.find((item) => item.id === categoryId) || categories[0];
  const matches = category.matchesInResult;
  const index = matches.findIndex((event) => event.id === current.id);
  const nextIndex = direction === 'next' ? index + 1 : index - 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= matches.length) return;
  await inspectAndRevealEvent(matches[nextIndex]);
}

function showInspector(event) {
  const layer = activeLayerId();
  const key = detailKey(state.selectedSessionId, layer, event.id);
  const refs = sourceRefs(event);
  const preview = event.snippet || event.preview || '';
  const chips = renderChips([
    event.kind,
    event.status,
    event.severity && event.severity !== 'normal' ? event.severity : '',
    event.layer || layer,
  ]);
  state.selectedEventId = event.id;
  state.detailSelectionKey = key;
  setMobileView('detail');
  updateSelectedTimelineEvent();
  if (!currentNavigationCache()) {
    ensureNavigationEvents().then(() => {
      if (state.detailSelectionKey === key && state.selectedEventId === event.id) showInspector(event);
    }).catch(showError);
  }
  el.detail.innerHTML = `<article class="inspector">
    <header class="inspectorHeader">
      <div class="inspectorTitleRow">
        <div class="inspectorTitleBlock">
          <h2>${escapeHtml(event.label)}</h2>
          <div class="chips">${chips}</div>
        </div>
        ${renderInspectorNavigation(event)}
      </div>
    </header>
    ${preview ? `<section class="inspectorSection"><h3>Preview</h3><div class="inspectorLead">${escapeHtml(preview)}</div></section>` : ''}
    <section class="inspectorSection">
      <h3>Metadata</h3>
      <dl class="inspectorMeta">${renderInspectorMetadata(event, refs)}</dl>
    </section>
    <section class="inspectorSection">
      <h3>Source</h3>
      <div class="inspectorActions">
        <button class="smallBtn" type="button" data-detail-action="raw">Raw refs</button>
        <span class="rawMeta">${escapeHtml(refs.length ? `${refs.length} JSONL row${refs.length === 1 ? '' : 's'}` : 'No raw refs available')}</span>
      </div>
    </section>
    ${renderInspectorDetail(event)}
  </article>`;

  if (!state.detailCache[key] && !state.detailErrors[key]) {
    loadEventDetail(event).then(() => {
      if (state.detailSelectionKey === key) showInspector(event);
    });
  }
}

async function showRaw(event) {
  const refs = sourceRefs(event);
  const layer = activeLayerId();
  const rawKey = `raw:${detailKey(state.selectedSessionId, layer, event.id)}`;
  state.selectedEventId = event.id;
  state.detailSelectionKey = rawKey;
  setMobileView('detail');
  updateSelectedTimelineEvent();
  if (!refs.length) {
    el.detail.innerHTML = `<article class="rawRefsView">
      <header class="inspectorHeader">
        <h2>Raw refs</h2>
        <div class="chips">${renderChips([event.label, event.layer || layer, event.kind])}</div>
      </header>
      <div class="notice warning"><p>No raw source rows are available for this event.</p></div>
      <div class="inspectorActions">
        <button class="smallBtn" type="button" data-detail-action="inspect">Back to inspector</button>
      </div>
    </article>`;
    return;
  }
  const payloads = await Promise.all(refs.map((ref) => api(`/api/raw?file=${encodeURIComponent(ref.file)}&line=${encodeURIComponent(ref.line)}`)));
  if (state.detailSelectionKey !== rawKey) return;
  el.detail.innerHTML = `<article class="rawRefsView">
    <header class="inspectorHeader">
      <h2>Raw refs</h2>
      <div class="chips">${renderChips([event.label, event.layer || layer, event.kind])}</div>
    </header>
    <p class="rawMeta">${escapeHtml(`${refs.length} JSONL row${refs.length === 1 ? '' : 's'} for ${event.id}`)}</p>
    ${payloads.map((raw) => `<section class="inspectorSection"><p class="rawMeta">${escapeHtml(raw.file)}:${raw.line}</p><pre>${escapeHtml(JSON.stringify(raw.parsed, null, 2) || raw.raw)}</pre></section>`).join('')}
    <div class="inspectorActions">
      <button class="smallBtn" type="button" data-detail-action="inspect">Back to inspector</button>
    </div>
  </article>`;
}

el.sessionList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-session-id]');
  if (item) selectSession(item.dataset.sessionId, { mobileView: 'events' }).catch(showError);
});

for (const button of el.mobileViewButtons) {
  button.addEventListener('click', () => setMobileView(button.dataset.mobileView));
}

el.timeline.addEventListener('click', (event) => {
  const article = event.target.closest('[data-event-id]');
  if (!article) return;
  const item = state.currentEvents.find((candidate) => candidate.id === article.dataset.eventId);
  if (!item) return;
  const action = event.target.closest('[data-action]')?.dataset.action || 'inspect';
  if (action === 'toggle') {
    const next = article.classList.contains('expanded') ? 'collapsed' : 'expanded';
    setOverride(item.id, next);
    renderTimeline();
    if (next === 'expanded') ensureEventDetail(item);
  } else if (action === 'retry-detail') {
    const key = detailKey(state.selectedSessionId, activeLayerId(), item.id);
    delete state.detailErrors[key];
    delete state.detailCache[key];
    ensureEventDetail(item);
  } else if (action === 'raw') {
    showRaw(item).catch(showError);
  } else {
    showInspector(item);
  }
});

el.detail.addEventListener('click', (event) => {
  const action = event.target.closest('[data-detail-action]')?.dataset.detailAction;
  if (!action) return;
  if (action === 'navigate-event') {
    navigateSelectedEvent(event.target.closest('[data-nav-direction]')?.dataset.navDirection || '').catch(showError);
    return;
  }
  const key = state.detailSelectionKey.replace(/^raw:/, '');
  const item = state.currentEvents.find((candidate) => detailKey(state.selectedSessionId, activeLayerId(), candidate.id) === key);
  if (!item) return;
  if (action === 'inspect') {
    showInspector(item);
  } else if (action === 'raw') {
    showRaw(item).catch(showError);
  } else if (action === 'retry-detail') {
    delete state.detailErrors[key];
    delete state.detailCache[key];
    showInspector(item);
  }
});

el.detail.addEventListener('change', (event) => {
  const select = event.target.closest('[data-navigation-category]');
  if (!select) return;
  state.navigationCategoryId = select.value;
  const item = currentSelectedEvent();
  if (item) showInspector(item);
});

el.profileSelect.addEventListener('change', () => {
  state.profileId = el.profileSelect.value;
  localStorage.setItem('sessionAnalyzer.profile', state.profileId);
  clearCurrentSessionOverrides();
  renderTimeline();
  resetTimelineScroll();
});

el.layerSelect.addEventListener('change', () => {
  state.layerId = el.layerSelect.value;
  el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'layer');
  localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  loadSessions().catch(showError);
});

el.resetFoldsBtn.addEventListener('click', () => {
  delete state.overrides[state.selectedSessionId];
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
  renderTimeline();
});

el.loadMoreBtn.addEventListener('click', () => loadTimeline(true).catch(showError));
el.resultSummary?.addEventListener('click', (event) => {
  const clear = event.target.closest('[data-clear-filter]')?.dataset.clearFilter;
  if (clear) clearActiveFilter(clear);
});
el.timeline.closest('.timelinePane')?.addEventListener('scroll', queueVisibleDetailLoad, { passive: true });
window.addEventListener('resize', queueVisibleDetailLoad);

const reload = debounce(() => {
  syncSearchAssistControls();
  renderSearchAssistChips();
  loadSessions().catch(showError);
}, 220);

el.searchInput.addEventListener('focus', showSearchAssist);
el.searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  hideSearchAssist();
});
el.searchInput.addEventListener('input', () => {
  showSearchAssist();
  reload();
});
el.searchInput.addEventListener('change', reload);

el.searchAssist?.addEventListener('click', (event) => {
  const clear = event.target.closest('[data-clear-filter]')?.dataset.clearFilter;
  if (clear) {
    clearActiveFilter(clear);
    return;
  }
  const example = event.target.closest('[data-search-example]')?.dataset.searchExample;
  if (example) applySearchExpression(example);
});

el.searchAssist?.addEventListener('change', (event) => {
  const control = event.target.closest('[data-search-operator]');
  if (!control) return;
  applySearchOperator(control.dataset.searchOperator, control.value.trim());
});

el.searchAssist?.addEventListener('input', (event) => {
  const control = event.target.closest('[data-search-operator="file"]');
  if (!control || !isSuggestedFile(control.value)) return;
  applySearchOperator('file', control.value.trim());
});

el.searchAssist?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const control = event.target.closest('[data-search-operator]');
  if (!control) return;
  event.preventDefault();
  applySearchOperator(control.dataset.searchOperator, control.value.trim());
});

document.addEventListener('pointerdown', (event) => {
  if (!el.searchField || el.searchField.contains(event.target)) return;
  hideSearchAssist();
});

el.kindFilter.addEventListener('input', () => {
  el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'kind');
  renderSearchAssistChips();
  reload();
});
el.kindFilter.addEventListener('change', () => {
  el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'kind');
  renderSearchAssistChips();
  reload();
});
el.statusFilter.addEventListener('input', () => {
  el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'status');
  renderSearchAssistChips();
  reload();
});
el.statusFilter.addEventListener('change', () => {
  el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'status');
  renderSearchAssistChips();
  reload();
});
el.sortSelect.addEventListener('input', reload);
el.sortSelect.addEventListener('change', reload);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.searchAssist?.hidden) {
    event.preventDefault();
    hideSearchAssist();
    return;
  }
  if (event.altKey && event.key === 'ArrowRight') {
    const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
    const next = state.profiles[(i + 1) % state.profiles.length];
    if (next) {
      state.profileId = next.id;
      el.profileSelect.value = next.id;
      localStorage.setItem('sessionAnalyzer.profile', state.profileId);
      clearCurrentSessionOverrides();
      renderTimeline();
      resetTimelineScroll();
    }
  }
  if (event.altKey && event.key === 'ArrowLeft') {
    const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
    const next = state.profiles[(i - 1 + state.profiles.length) % state.profiles.length];
    if (next) {
      state.profileId = next.id;
      el.profileSelect.value = next.id;
      localStorage.setItem('sessionAnalyzer.profile', state.profileId);
      clearCurrentSessionOverrides();
      renderTimeline();
      resetTimelineScroll();
    }
  }
});

function showError(error) {
  el.stateLine.textContent = error.message;
  console.error(error);
}

init().catch(showError);
