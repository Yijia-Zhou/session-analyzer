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
const TIMELINE_AUTO_LOAD_SCROLL_THRESHOLD = 96;
const FILE_SUGGESTION_LIMIT = 12;
const REPO_STORAGE_KEY = 'sessionAnalyzer.repoRoot';
const CUSTOM_PROFILES_KEY = 'sessionAnalyzer.customProfiles';
const DISPLAY_STATES = ['expanded', 'summary', 'collapsed', 'hidden'];
const DISPLAY_STATE_LABELS = {
  expanded: '展开',
  summary: '摘要',
  collapsed: '折叠',
  hidden: '隐藏',
};
const BUILTIN_PROFILE_RULES = {
  narrative: {
    kindStates: {
      user_message: 'expanded',
      assistant_message: 'expanded',
      patch: 'expanded',
      error: 'expanded',
      abort: 'expanded',
      rollback: 'expanded',
      compaction: 'expanded',
      plan_artifact: 'expanded',
      reasoning: 'collapsed',
      token: 'collapsed',
    },
    fallback: 'summary',
    conditions: [
      { id: 'abnormalSeverity', state: 'expanded' },
      { id: 'failedStatus', state: 'expanded' },
    ],
  },
  debug: {
    kindStates: {
      command: 'summary',
      patch: 'summary',
      mcp: 'summary',
      js_repl: 'summary',
      tool_operation: 'summary',
      error: 'summary',
      abort: 'summary',
      rollback: 'summary',
    },
    fallback: 'collapsed',
    conditions: [
      { id: 'errorSeverity', state: 'expanded' },
      { id: 'failedStatus', state: 'expanded' },
    ],
  },
  changes: {
    kindStates: {
      patch: 'expanded',
      plan_artifact: 'expanded',
      user_message: 'collapsed',
      assistant_message: 'collapsed',
    },
    fallback: 'hidden',
    conditions: [
      { id: 'reviewCommand', state: 'summary' },
      { id: 'touchedFiles', state: 'summary' },
    ],
  },
  search: {
    kindStates: {},
    fallback: 'hidden',
    conditions: [
      { id: 'searchHit', state: 'expanded' },
      { id: 'importantEvent', state: 'summary' },
    ],
  },
  planning: {
    kindStates: {
      plan_artifact: 'expanded',
      user_message: 'summary',
      assistant_message: 'summary',
      patch: 'summary',
      error: 'summary',
      abort: 'summary',
      rollback: 'summary',
      compaction: 'summary',
    },
    fallback: 'hidden',
    conditions: [
      { id: 'updatePlanCall', state: 'expanded' },
      { id: 'failedStatus', state: 'summary' },
      { id: 'abnormalSeverity', state: 'summary' },
    ],
  },
  conversation: {
    kindStates: {
      user_message: 'expanded',
      assistant_message: 'expanded',
      plan_artifact: 'expanded',
      error: 'summary',
      abort: 'summary',
      rollback: 'summary',
      compaction: 'summary',
    },
    fallback: 'hidden',
    conditions: [],
  },
  tools: {
    kindStates: {
      command: 'summary',
      patch: 'summary',
      mcp: 'summary',
      js_repl: 'summary',
      tool_operation: 'summary',
      web_search: 'summary',
    },
    fallback: 'collapsed',
    conditions: [
      { id: 'abnormalSeverity', state: 'summary' },
    ],
  },
  context: {
    kindStates: {
      token: 'summary',
      compaction: 'summary',
      rollback: 'summary',
      subagent: 'summary',
      turn: 'summary',
      abort: 'summary',
    },
    fallback: 'hidden',
    conditions: [],
  },
  compact: {
    kindStates: {},
    fallback: 'collapsed',
    conditions: [],
  },
};
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
  abort: 'Abort',
  rollback: 'Rollback',
  compaction: 'Compaction',
  token: 'Token',
  subagent: 'Subagent',
  turn: 'Turn',
  web_search: 'Web search',
  event: 'Event',
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
  repoRoot: '',
  projects: [],
  projectSelected: false,
  selectingProject: false,
  projectLoadingRoot: '',
  selectedSessionId: '',
  selectedEventId: '',
  offset: 0,
  limit: 150,
  timelineLoading: false,
  timelineRequestId: 0,
  sessionGrandTotal: 0,
  sessionTotal: 0,
  timelineTotal: 0,
  currentEvents: [],
  fileSuggestions: [],
  profiles: [],
  builtinProfiles: [],
  customProfiles: readJsonStorage(CUSTOM_PROFILES_KEY, []),
  profileId: localStorage.getItem('sessionAnalyzer.profile') || 'narrative',
  previousProfileBeforeMetric: '',
  previousLayerBeforeProtocol: '',
  dirtyProfileDecisionPending: null,
  profileDraft: null,
  layerId: localStorage.getItem('sessionAnalyzer.layer') || 'main',
  overrides: JSON.parse(localStorage.getItem('sessionAnalyzer.overrides') || '{}'),
  detailCache: {},
  detailErrors: {},
  detailPending: {},
  detailViewportTimer: 0,
  detailView: { type: 'profileRules' },
  detailHistory: [],
  detailSelectionKey: '',
  navigationCategoryId: '',
  navigationCache: { key: '', events: [], total: 0, pending: null },
  mobileView: 'sessions',
};

const el = {
  projectTitle: document.getElementById('projectTitle'),
  projectSwitchControl: document.getElementById('projectSwitchControl'),
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
  sortSelect: document.getElementById('sortSelect'),
  sessionList: document.getElementById('sessionList'),
  sessionHeader: document.getElementById('sessionHeader'),
  analysisPanel: document.getElementById('analysisPanel'),
  timeline: document.getElementById('timeline'),
  detail: document.getElementById('detail'),
  resetFoldsBtn: document.getElementById('resetFoldsBtn'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  resultSummary: document.getElementById('resultSummary'),
  dirtyProfileDialog: document.getElementById('dirtyProfileDialog'),
  dirtyProfileCurrentName: document.getElementById('dirtyProfileCurrentName'),
  dirtyProfileSaveName: document.getElementById('dirtyProfileSaveName'),
  mobileViewButtons: document.querySelectorAll('[data-mobile-view]'),
  projectChooser: document.getElementById('projectChooser'),
  projectStatus: document.getElementById('projectStatus'),
  projectList: document.getElementById('projectList'),
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
  updateDetailViewChrome();
  if (changed && options.scroll !== false && window.matchMedia('(max-width: 760px)').matches) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function updateDetailViewChrome() {
  document.body.dataset.detailView = state.detailView?.type || 'profileRules';
}

function readJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function api(path, options = {}) {
  const init = { ...options };
  if (options.body && typeof options.body !== 'string') {
    init.body = JSON.stringify(options.body);
    init.headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  }
  return fetch(path, init).then(async (res) => {
    const body = await res.json();
    if (!res.ok) {
      const error = new Error(body.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.details = body.details;
      throw error;
    }
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

function projectName(repoRoot) {
  const text = String(repoRoot || '').replace(/[\\/]+$/, '');
  if (!text) return 'Select project';
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function setProjectHeader(repoRoot, summary) {
  if (el.projectTitle) el.projectTitle.textContent = projectName(repoRoot);
  if (el.projectSwitchControl) {
    el.projectSwitchControl.title = repoRoot ? `Switch project: ${repoRoot}` : 'Select target project';
  }
  el.stateLine.textContent = summary || '';
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
    kind: parsed.kind,
    status: parsed.status,
    layer: parsed.layer || state.layerId || 'main',
    parsed,
  };
}

function activeLayerId() {
  return currentSearchState().layer || 'main';
}

function profileAppliesToActiveLayer() {
  return activeLayerId() === 'main';
}

function activeLayerLabel() {
  return LAYER_LABELS[activeLayerId()] || activeLayerId();
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
  state.detailHistory = [];
  state.detailView = { type: 'profileRules' };
  renderProfileRulesPane();
  updateSelectedTimelineEvent();
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile || {}));
}

function defaultRules() {
  return { kindStates: {}, fallback: 'summary', conditions: [] };
}

function normalizeRules(rules) {
  const source = rules || {};
  const kindStates = {};
  for (const [kind, display] of Object.entries(source.kindStates || {})) {
    if (DISPLAY_STATES.includes(display)) kindStates[kind] = display;
  }
  const fallback = DISPLAY_STATES.includes(source.fallback) ? source.fallback : 'summary';
  const conditions = (source.conditions || []).map((condition) => ({
    id: String(condition.id || ''),
    state: DISPLAY_STATES.includes(condition.state) ? condition.state : '',
  })).filter((condition) => condition.id && condition.state);
  return { kindStates, fallback, conditions };
}

function normalizeProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
    ...profile,
    rules: normalizeRules(profile.rules || BUILTIN_PROFILE_RULES[profile.id] || defaultRules()),
  }));
}

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.profileId)
    || state.profiles.find((profile) => profile.id === 'narrative')
    || state.profiles[0]
    || { id: 'narrative', name: '叙事时间线', description: '', rules: defaultRules() };
}

function activeProfileRules() {
  return state.profileDraft?.rules || activeProfile().rules || defaultRules();
}

function resetProfileDraft() {
  state.profileDraft = cloneProfile(activeProfile());
}

function isBuiltinProfile(profileId) {
  return state.builtinProfiles.some((profile) => profile.id === profileId);
}

function profileDirty() {
  const base = activeProfile();
  return JSON.stringify(state.profileDraft?.rules || {}) !== JSON.stringify(base.rules || {});
}

function saveCustomProfiles() {
  state.customProfiles = normalizeProfiles(state.customProfiles);
  writeJsonStorage(CUSTOM_PROFILES_KEY, state.customProfiles);
  state.profiles = normalizeProfiles([...state.builtinProfiles, ...state.customProfiles]);
}

function knownEventKinds() {
  const kinds = new Set([
    'user_message',
    'assistant_message',
    'plan_artifact',
    'reasoning',
    'command',
    'patch',
    'mcp',
    'js_repl',
    'tool_operation',
    'web_search',
    'error',
    'abort',
    'rollback',
    'compaction',
    'token',
    'subagent',
    'turn',
  ]);
  for (const profile of state.profiles) {
    for (const kind of Object.keys(profile.rules?.kindStates || {})) kinds.add(kind);
  }
  for (const event of state.currentEvents) {
    if (event.kind) kinds.add(event.kind);
  }
  return [...kinds].sort((a, b) => (KIND_LABELS[a] || a).localeCompare(KIND_LABELS[b] || b));
}

function conditionDefinitions() {
  return [
    { id: 'searchHit', name: 'Search hit', description: 'Events matching the current search query.' },
    { id: 'importantEvent', name: 'Important event', description: 'User/assistant messages, patches, errors, aborts, rollbacks, compactions, plans, failed events, and abnormal severity.' },
    { id: 'updatePlanCall', name: 'update_plan call', description: 'Calls to the update_plan tool.' },
    { id: 'failedStatus', name: 'Failed status', description: 'Events whose status is failed.' },
    { id: 'errorSeverity', name: 'Error severity', description: 'Events whose severity is error.' },
    { id: 'abnormalSeverity', name: 'Abnormal severity', description: 'Events whose severity is not normal.' },
    { id: 'reviewCommand', name: 'Review command', description: 'Command previews containing test, build, lint, typecheck, git, diff, or status.' },
    { id: 'touchedFiles', name: 'Touched files', description: 'Events that reference changed or touched files.' },
  ];
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

function shortSessionTitle(value, limit = 54) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function sessionRelationshipLabel(session) {
  const parent = shortId(session.parentSessionId);
  const kind = session.derivedKind === 'review' ? 'Review' : 'Subagent';
  const nickname = session.agentNickname && session.agentNickname.toLowerCase() !== kind.toLowerCase() ? ` ${session.agentNickname}` : '';
  const parentLabel = shortSessionTitle(session.parentSessionTitle) || parent;
  if (parentLabel) return `${kind}${nickname} · from ${parentLabel}`;
  if (session.isDerivedSession) return `${kind}${nickname} session`;
  return '';
}

function sessionItemClasses(session, active) {
  const classes = ['sessionItem'];
  if (session.isDerivedSession) {
    classes.push('secondarySession');
    classes.push(session.derivedKind === 'review' ? 'derived-review' : 'derived-subagent');
  }
  if (active) classes.push('active');
  return classes.join(' ');
}

function setRelatedParentHighlight(parentSessionId, enabled) {
  if (!parentSessionId) return;
  const parent = el.sessionList.querySelector(`[data-session-id="${CSS.escape(parentSessionId)}"]`);
  if (!parent) return;
  parent.classList.toggle('relatedParentSession', enabled);
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
  if (search.kind) filters.push({ key: 'kind', label: `Kind: ${optionText(el.searchKindSelect, search.kind, KIND_LABELS)}` });
  if (search.status) filters.push({ key: 'status', label: `Status: ${optionText(el.searchStatusSelect, search.status, STATUS_LABELS)}` });
  if (search.file) filters.push({ key: 'file', label: `File: ${search.file}` });
  if (search.parsed.layer && search.layer !== 'main') filters.push({ key: 'layer', label: `Layer: ${optionText(el.layerSelect, search.layer, LAYER_LABELS)}` });
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
    el.searchAssistChips.innerHTML = '<span class="searchAssistEmpty">No active filters</span>';
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

function applySearchOperator(operator, value) {
  if (!operator) return;
  if (value) {
    el.searchInput.value = searchQuery.upsertOperator(el.searchInput.value, operator, value);
  } else {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, operator);
  }
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  focusSearchEnd();
  loadSessions().catch(showError);
}

function normalizeFileSuggestionText(value) {
  return String(value || '').trim().replace(/\\/g, '/').toLowerCase();
}

function visibleFileSuggestions() {
  const text = normalizeFileSuggestionText(el.searchFileInput?.value);
  const suggestions = text
    ? state.fileSuggestions.filter((item) => normalizeFileSuggestionText(item.file).includes(text))
    : state.fileSuggestions;
  return suggestions.slice(0, FILE_SUGGESTION_LIMIT);
}

function setFileSuggestionsOpen(open) {
  if (!el.searchFileSuggestions || !el.searchFileInput) return;
  const suggestions = visibleFileSuggestions();
  const shouldOpen = open && suggestions.length > 0;
  el.searchFileSuggestions.hidden = !shouldOpen;
  el.searchFileInput.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function hideFileSuggestions() {
  setFileSuggestionsOpen(false);
}

function renderFileSuggestions() {
  if (!el.searchFileSuggestions) return;
  const suggestions = visibleFileSuggestions();
  el.searchFileSuggestions.innerHTML = suggestions.map((item) => (
    `<button class="fileSuggestion" type="button" role="option" data-search-file-suggestion="${escapeHtml(item.file)}">
      <span class="fileSuggestionPath">${escapeHtml(item.file)}</span>
      <span class="fileSuggestionHits">${escapeHtml(item.count)} hits</span>
    </button>`
  )).join('');
  setFileSuggestionsOpen(document.activeElement === el.searchFileInput);
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
    state.layerId = 'main';
    el.layerSelect.value = state.layerId;
    localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  } else if (key === 'q') {
    el.searchInput.value = searchQuery.removeFreeText(el.searchInput.value);
  } else if (key === 'file') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'file');
  } else if (key === 'kind') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'kind');
  } else if (key === 'status') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'status');
  } else if (key === 'layer') {
    el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'layer');
    state.layerId = 'main';
    el.layerSelect.value = state.layerId;
    localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  }
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  loadSessions().catch(showError);
}

function resetTimelineScroll() {
  const pane = el.timeline.closest('.timelinePane');
  if (pane) pane.scrollTop = 0;
}

function eventPrimaryLine(event) {
  const line = event?.rawRefs?.[0]?.line ?? event?.source?.line ?? 0;
  const number = Number(line);
  return Number.isFinite(number) ? number : 0;
}

function captureFocusAnchor() {
  const event = currentSelectedEvent();
  if (!event) return { hadSelection: false };
  return {
    hadSelection: true,
    eventId: event.id,
    timestamp: event.timestamp || '',
    line: eventPrimaryLine(event),
    detailType: state.detailView?.type === 'rawRefs' ? 'rawRefs' : 'inspector',
  };
}

function compareEventToAnchor(event, anchor) {
  const eventTime = event.timestamp || '';
  const anchorTime = anchor.timestamp || '';
  if (eventTime !== anchorTime) return eventTime < anchorTime ? -1 : 1;
  return eventPrimaryLine(event) - (anchor.line || 0);
}

function isVisibleFocusCandidate(event) {
  return displayState(event) !== 'hidden';
}

function isExpandedFocusCandidate(event) {
  return displayState(event) === 'expanded';
}

async function allFocusEvents() {
  const cache = await ensureNavigationEvents();
  return cache?.events || state.currentEvents;
}

async function resolveFocusTarget(anchor) {
  const events = await allFocusEvents();
  if (!events.length) return null;
  if (!anchor?.hadSelection) {
    return events.find(isExpandedFocusCandidate) || null;
  }

  const sameEvent = events.find((event) => event.id === anchor.eventId);
  if (sameEvent && isVisibleFocusCandidate(sameEvent)) return sameEvent;

  const insertionIndex = events.findIndex((event) => compareEventToAnchor(event, anchor) >= 0);
  const startIndex = insertionIndex >= 0 ? insertionIndex : events.length;
  for (let index = startIndex; index < events.length; index += 1) {
    if (isVisibleFocusCandidate(events[index])) return events[index];
  }
  for (let index = Math.min(startIndex - 1, events.length - 1); index >= 0; index -= 1) {
    if (isVisibleFocusCandidate(events[index])) return events[index];
  }
  return null;
}

async function restoreFocus(anchor) {
  if (!state.selectedSessionId) return;
  const target = await resolveFocusTarget(anchor);
  if (!target) {
    if (anchor?.hadSelection) closeDetailView();
    return;
  }
  await ensureEventLoaded(target.id);
  const loaded = state.currentEvents.find((event) => event.id === target.id) || target;
  if (anchor?.detailType === 'rawRefs') await showRaw(loaded, { replace: true });
  else showInspector(loaded, { replace: true });
  scrollToTimelineEvent(loaded.id);
}

function clearCurrentSessionOverrides() {
  if (!state.selectedSessionId || !state.overrides[state.selectedSessionId]) return;
  delete state.overrides[state.selectedSessionId];
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
  updateResetFoldsButton();
}

function hasCurrentSessionOverrides() {
  const sessionOverrides = state.overrides[state.selectedSessionId] || {};
  return Object.keys(sessionOverrides).length > 0;
}

function updateResetFoldsButton() {
  if (!el.resetFoldsBtn) return;
  const visible = hasCurrentSessionOverrides();
  el.resetFoldsBtn.hidden = !visible;
  el.resetFoldsBtn.closest('.foldControls')?.toggleAttribute('data-has-reset-folds', visible);
}

function updateProfileApplicabilityUi(analyzerDisabled = false) {
  const applies = profileAppliesToActiveLayer();
  const controls = el.profileSelect?.closest('.foldControls');
  if (el.profileSelect) {
    el.profileSelect.disabled = analyzerDisabled || !applies;
    const title = applies
      ? 'Folding strategy'
      : 'Folding strategies apply only to Main timeline. This layer uses fixed display rules.';
    el.profileSelect.title = title;
    el.profileSelect.setAttribute('aria-label', applies ? '折叠策略' : title);
  }
  controls?.toggleAttribute('data-profile-inactive', !applies);
}

function setAnalyzerDisabled(disabled) {
  for (const control of [el.searchInput, el.layerSelect, el.sortSelect, el.resetFoldsBtn, el.loadMoreBtn]) {
    if (control) control.disabled = disabled;
  }
  updateProfileApplicabilityUi(disabled);
}

function setProjectMode(selecting) {
  state.selectingProject = selecting;
  state.projectSelected = !selecting;
  document.body.dataset.projectMode = selecting ? 'selecting' : 'analyzing';
  if (el.projectChooser) el.projectChooser.hidden = !selecting;
  setAnalyzerDisabled(selecting);
}

function resetProjectViewState() {
  state.sessions = [];
  state.selectedSessionId = '';
  state.selectedEventId = '';
  state.offset = 0;
  state.timelineLoading = false;
  state.timelineRequestId += 1;
  state.sessionGrandTotal = 0;
  state.sessionTotal = 0;
  state.timelineTotal = 0;
  state.currentEvents = [];
  state.fileSuggestions = [];
  state.detailCache = {};
  state.detailErrors = {};
  state.detailPending = {};
  invalidateNavigationCache();
  el.sessionList.innerHTML = '';
  el.analysisPanel.innerHTML = '';
  el.timeline.innerHTML = '';
  el.resultSummary.textContent = '';
  el.sessionHeader.innerHTML = '<h2>Select a session</h2><p>Choose a target project first.</p>';
  el.loadMoreBtn.disabled = true;
  el.loadMoreBtn.textContent = 'Load more';
  updateResetFoldsButton();
  resetDetailPane();
}

function renderProjects() {
  if (!el.projectList) return;
  const loadingRoot = state.projectLoadingRoot;
  el.projectList.setAttribute('aria-busy', loadingRoot ? 'true' : 'false');
  if (el.projectChooser) el.projectChooser.dataset.loading = loadingRoot ? 'true' : 'false';
  if (!state.projects.length) {
    el.projectList.innerHTML = '<div class="notice warning"><p>No Codex projects were found in the configured sessions directory.</p></div>';
    return;
  }
  const saved = localStorage.getItem(REPO_STORAGE_KEY) || '';
  el.projectList.innerHTML = state.projects.map((project) => {
    const isSaved = project.repoRoot === saved;
    const isLoading = project.repoRoot === loadingRoot;
    const classes = [
      'projectItem',
      isSaved ? 'lastSelected' : '',
      project.exists ? '' : 'missing',
      isLoading ? 'loading' : '',
    ].filter(Boolean).join(' ');
    const badges = [
      isSaved ? '<span class="projectBadge">Last selected</span>' : '',
      project.exists ? '' : '<span class="projectBadge warning">Missing directory</span>',
    ].join('');
    const action = isLoading ? '<span class="projectSpinner" aria-hidden="true"></span><span>Indexing...</span>' : '<span>Open</span>';
    return `<button class="${classes}" type="button" data-project-root="${escapeHtml(project.repoRoot)}"${loadingRoot ? ' disabled' : ''}>
      <span class="projectMain">
        <span class="projectName">${escapeHtml(projectName(project.repoRoot))}${badges}</span>
        <span class="projectPath">${escapeHtml(project.repoRoot)}</span>
      </span>
      <span class="projectFacts" aria-label="Project activity">
        <span>${escapeHtml(project.sessionCount)} session${project.sessionCount === 1 ? '' : 's'}</span>
        <span>${escapeHtml(fmtDate(project.updatedAt))}</span>
      </span>
      <span class="projectAction">${action}</span>
    </button>`;
  }).join('');
}

async function showProjectChooser(options = {}) {
  setProjectMode(true);
  state.projectLoadingRoot = '';
  resetProjectViewState();
  setProjectHeader('', 'Choose a target project to continue.');
  if (el.projectStatus) el.projectStatus.textContent = 'Loading project list...';
  const data = await api('/api/projects');
  state.projects = data.projects || [];
  renderProjects();
  if (el.projectStatus) el.projectStatus.textContent = state.projects.length ? `${state.projects.length} project candidates from ${data.codexHome}` : `No project candidates from ${data.codexHome}`;

  const saved = localStorage.getItem(REPO_STORAGE_KEY);
  if (options.autoRestore && saved && state.projects.some((project) => project.repoRoot === saved)) {
    await selectProject(saved, { restore: true });
  }
}

async function applyAppState(appState) {
  state.repoRoot = appState.repoRoot || '';
  state.builtinProfiles = normalizeProfiles(appState.foldingProfiles || []);
  state.profiles = normalizeProfiles([...state.builtinProfiles, ...state.customProfiles]);
  state.sessionGrandTotal = appState.totals.sessionCount || 0;
  setProjectHeader(
    appState.repoRoot,
    `${appState.totals.sessionCount} sessions | ${appState.totals.eventCount} logical events | ${appState.totals.rawEventCount} raw records`,
  );
  el.profileSelect.innerHTML = state.profiles.map((profile) => (
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`
  )).join('');
  el.profileSelect.value = state.profileId;
  if (!el.profileSelect.value) {
    state.profileId = 'narrative';
    el.profileSelect.value = state.profileId;
  }
  updateProfileApplicabilityUi();
  resetProfileDraft();
  el.layerSelect.value = state.layerId;
  const suggestionState = await api('/api/file-suggestions');
  state.fileSuggestions = suggestionState.files || [];
  renderFileSuggestions();
  resetDetailPane();
}

async function selectProject(repoRoot, options = {}) {
  if (!repoRoot) return;
  state.projectLoadingRoot = repoRoot;
  renderProjects();
  setProjectHeader('', `Indexing ${projectName(repoRoot)}...`);
  if (el.projectStatus) el.projectStatus.textContent = `Reading matching sessions for ${repoRoot}. This can take a few seconds for large transcript history.`;
  setAnalyzerDisabled(true);
  try {
    const appState = await api('/api/project', {
      method: 'POST',
      body: { repoRoot },
    });
    localStorage.setItem(REPO_STORAGE_KEY, appState.repoRoot);
    state.projectLoadingRoot = '';
    resetProjectViewState();
    await applyAppState(appState);
    setProjectMode(false);
    await loadSessions();
    if (!options.restore && el.projectStatus) el.projectStatus.textContent = '';
  } catch (error) {
    state.projectLoadingRoot = '';
    renderProjects();
    setAnalyzerDisabled(false);
    throw error;
  }
}

async function init() {
  setMobileView(state.mobileView, { scroll: false });
  try {
    const appState = await api('/api/state');
    await applyAppState(appState);
    setProjectMode(false);
  } catch (error) {
    if (error.status !== 409) throw error;
    await showProjectChooser({ autoRestore: true });
    if (state.projectSelected) return;
    return;
  }
  await loadSessions();
}

async function loadSessions() {
  updateProfileApplicabilityUi();
  const data = await api(`/api/sessions${currentQuery({ sort: el.sortSelect.value })}`);
  state.sessions = data.sessions;
  state.sessionTotal = data.total;
  renderSessions();
  if (!state.selectedSessionId && data.sessions[0]) {
    await selectSession(data.sessions[0].id);
  } else if (state.selectedSessionId && !data.sessions.some((session) => session.id === state.selectedSessionId)) {
    state.selectedSessionId = '';
    state.offset = 0;
    state.timelineLoading = false;
    state.timelineRequestId += 1;
    state.timelineTotal = 0;
    state.currentEvents = [];
    el.timeline.innerHTML = '';
    el.analysisPanel.innerHTML = '';
    updateLoadMoreButton();
    updateResetFoldsButton();
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
    const active = session.id === state.selectedSessionId;
    const relationship = sessionRelationshipLabel(session);
    const parentAttr = session.parentSessionId ? ` data-parent-session-id="${escapeHtml(session.parentSessionId)}"` : '';
    const relationshipTitle = session.parentSessionTitle || session.parentSessionId || relationship;
    return `<button class="${sessionItemClasses(session, active)}" type="button" data-session-id="${escapeHtml(session.id)}"${parentAttr}>
      <span class="sessionTitle">${escapeHtml(session.title)}</span>
      <span class="meta">${escapeHtml(fmtDate(session.updatedAt || session.startedAt))} | ${escapeHtml(fmtBytes(session.bytes))}</span>
      <span class="chips">
        ${relationship ? `<span class="chip relationshipChip" title="${escapeHtml(relationshipTitle)}">${escapeHtml(relationship)}</span>` : ''}
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
  state.timelineLoading = false;
  state.timelineRequestId += 1;
  state.currentEvents = [];
  invalidateNavigationCache();
  updateResetFoldsButton();
  renderSessions();
  resetDetailPane();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (session) {
    const relationship = sessionRelationshipLabel(session);
    el.sessionHeader.innerHTML = `<h2>${escapeHtml(session.title)}</h2>
      <div class="sessionMeta" aria-label="Session metadata">
        ${relationship ? `<span class="sessionMetaChip">${escapeHtml(relationship)}</span>` : ''}
        <span class="sessionMetaChip">${escapeHtml(fmtDate(session.startedAt))} - ${escapeHtml(fmtDate(session.updatedAt))}</span>
        <span class="sessionSource" title="${escapeHtml(session.sourceFile)}">${escapeHtml(session.sourceFile)}</span>
      </div>`;
  }
  await Promise.all([loadAnalysis(sessionId), loadTimeline(false)]);
  if (options.mobileView) setMobileView(options.mobileView);
}

async function loadAnalysis(sessionId) {
  const analysis = await api(`/api/sessions/${encodeURIComponent(sessionId)}/analysis`);
  const planCount = analysis.counts.planEvents ?? analysis.counts.planArtifacts;
  el.analysisPanel.innerHTML = [
    metric('Turns', analysis.counts.turns),
    metric('Messages', analysis.counts.messages, { action: 'profile', value: 'conversation', label: '切换到对话阅读折叠策略' }),
    metric('Failed', analysis.counts.failedCommands, { action: 'profile', value: 'debug', label: '切换到问题排查折叠策略' }),
    metric('Files', analysis.patchedFiles.length, { action: 'profile', value: 'changes', label: '切换到改动审查折叠策略' }),
    metric('Protocol', analysis.counts.protocol, { action: 'layer', value: 'protocol', label: '切换到协议层事件' }),
    metric('Plans', planCount, { action: 'profile', value: 'planning', label: '切换到计划阅读折叠策略' }),
  ].join('');
}

function isMetricActionActive(action) {
  if (!action) return false;
  if (action.action === 'profile' && !profileAppliesToActiveLayer()) return false;
  if (action.action === 'profile') return state.profileId === action.value;
  if (action.action === 'layer') return activeLayerId() === action.value;
  return false;
}

function metric(label, value, action = null) {
  const hasValue = Number(value) > 0;
  const disabledProfileAction = action?.action === 'profile' && !profileAppliesToActiveLayer() && hasValue;
  const isActionable = action && hasValue && !disabledProfileAction;
  const actionLabel = disabledProfileAction
    ? `${label} shortcut is available on Main timeline only.`
    : (action?.label ? `${action.label}：${value} ${label}` : '');
  const actionAttrs = isActionable
    ? ` role="button" tabindex="0" aria-pressed="${isMetricActionActive(action) ? 'true' : 'false'}" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}" data-metric-action="${escapeHtml(action.action)}" data-metric-value="${escapeHtml(action.value)}"`
    : (disabledProfileAction ? ` aria-disabled="true" title="${escapeHtml(actionLabel)}"` : '');
  const classes = [
    'metric',
    isActionable ? 'filterable' : '',
    disabledProfileAction ? 'disabled' : '',
    isActionable && isMetricActionActive(action) ? 'active' : '',
  ].filter(Boolean).join(' ');
  return `<div class="${classes}"${actionAttrs}><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function syncMetricAction(metricEl) {
  const action = {
    action: metricEl.dataset.metricAction,
    value: metricEl.dataset.metricValue,
  };
  const active = isMetricActionActive(action);
  metricEl.classList.toggle('active', active);
  metricEl.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function updateMetricActionStates() {
  el.analysisPanel?.querySelectorAll('[data-metric-action]').forEach(syncMetricAction);
}

async function applyMetricAction(metricEl) {
  const action = metricEl.dataset.metricAction;
  if (action === 'profile' && !profileAppliesToActiveLayer()) return;
  if (action === 'profile') {
    const targetProfileId = metricEl.dataset.metricValue;
    if (state.profileId === targetProfileId) {
      const previousProfileId = state.profiles.some((profile) => profile.id === state.previousProfileBeforeMetric && profile.id !== targetProfileId)
        ? state.previousProfileBeforeMetric
        : 'narrative';
      if (await changeProfile(previousProfileId)) state.previousProfileBeforeMetric = '';
      updateMetricActionStates();
      return;
    }
    const previousProfileId = state.profileId;
    if (await changeProfile(targetProfileId)) {
      state.previousProfileBeforeMetric = previousProfileId;
    }
    updateMetricActionStates();
    return;
  }
  if (action === 'layer') {
    await applyMetricLayer(metricEl.dataset.metricValue);
  }
}

async function applyMetricLayer(targetLayerId) {
  const currentLayerId = activeLayerId();
  if (currentLayerId === targetLayerId) {
    const previousLayerId = ['main', 'protocol', 'raw'].includes(state.previousLayerBeforeProtocol) && state.previousLayerBeforeProtocol !== targetLayerId
      ? state.previousLayerBeforeProtocol
      : 'main';
    await changeLayer(previousLayerId);
    state.previousLayerBeforeProtocol = '';
    return;
  }
  state.previousLayerBeforeProtocol = currentLayerId;
  await changeLayer(targetLayerId);
}

async function changeLayer(layerId) {
  if (!['main', 'protocol', 'raw'].includes(layerId)) return;
  const focusAnchor = captureFocusAnchor();
  state.layerId = layerId;
  el.layerSelect.value = state.layerId;
  el.searchInput.value = searchQuery.removeOperator(el.searchInput.value, 'layer');
  localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  updateProfileApplicabilityUi();
  if (state.detailView.type === 'profileRules') renderProfileRulesPane();
  await loadSessions();
  await restoreFocus(focusAnchor);
  updateMetricActionStates();
}

function updateLoadMoreButton() {
  if (!el.loadMoreBtn) return;
  const hasMore = state.offset < state.timelineTotal;
  el.loadMoreBtn.disabled = !state.selectedSessionId || state.timelineLoading || !hasMore;
  if (state.timelineLoading) {
    el.loadMoreBtn.textContent = 'Loading...';
  } else {
    el.loadMoreBtn.textContent = hasMore ? `Load more (${state.offset}/${state.timelineTotal})` : `Loaded ${state.offset}`;
  }
}

async function loadTimeline(append) {
  if (!state.selectedSessionId) return;
  if (append && state.timelineLoading) return;
  const sessionId = state.selectedSessionId;
  const requestId = state.timelineRequestId + 1;
  state.timelineRequestId = requestId;
  state.timelineLoading = true;
  updateLoadMoreButton();
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${currentQuery({
      offset: append ? state.offset : 0,
      limit: state.limit,
    })}`);
    if (requestId !== state.timelineRequestId || sessionId !== state.selectedSessionId) return;
    if (append) {
      state.currentEvents = state.currentEvents.concat(data.events);
    } else {
      state.currentEvents = data.events;
    }
    state.offset = state.currentEvents.length;
    state.timelineTotal = data.total;
    renderTimeline();
    if (!append) resetTimelineScroll();
    renderResultSummary();
  } finally {
    if (requestId === state.timelineRequestId) {
      state.timelineLoading = false;
      updateLoadMoreButton();
    }
  }
}

function naturalDisplayState(event) {
  const layer = activeLayerId();

  if (layer === 'protocol') {
    return event.kind === 'protocol' ? 'summary' : 'collapsed';
  }
  if (layer === 'raw') {
    return ['event_msg', 'response_item'].includes(event.recordType) ? 'collapsed' : 'summary';
  }

  const q = currentSearchState().q;
  const profile = q && state.profileId !== 'compact'
    ? state.profiles.find((candidate) => candidate.id === 'search')
    : { ...activeProfile(), rules: activeProfileRules() };
  return displayStateFromRules(event, profile?.rules || defaultRules());
}

function displayState(event) {
  const sessionOverrides = state.overrides[state.selectedSessionId] || {};
  if (sessionOverrides[event.id]) return sessionOverrides[event.id];
  return naturalDisplayState(event);
}

function foldedDisplayState(event) {
  const natural = naturalDisplayState(event);
  return ['summary', 'collapsed'].includes(natural) ? natural : 'collapsed';
}

function importantEvent(event) {
  return ['user_message', 'assistant_message', 'patch', 'error', 'abort', 'rollback', 'compaction', 'plan_artifact', 'review'].includes(event.kind)
    || isUpdatePlanEvent(event)
    || event.severity !== 'normal'
    || event.status === 'failed';
}

function conditionMatches(conditionId, event) {
  if (conditionId === 'searchHit') return Boolean(event.hasSearchHit);
  if (conditionId === 'importantEvent') return importantEvent(event);
  if (conditionId === 'updatePlanCall') return isUpdatePlanEvent(event);
  if (conditionId === 'failedStatus') return event.status === 'failed';
  if (conditionId === 'errorSeverity') return event.severity === 'error';
  if (conditionId === 'abnormalSeverity') return event.severity !== 'normal';
  if (conditionId === 'reviewCommand') return event.kind === 'command' && /\b(test|build|lint|typecheck|git|diff|status)\b/i.test(event.preview || '');
  if (conditionId === 'touchedFiles') return event.touchedFiles && event.touchedFiles.length;
  return false;
}

function displayStateFromRules(event, rules) {
  const normalized = normalizeRules(rules);
  for (const condition of normalized.conditions) {
    if (conditionMatches(condition.id, event)) return condition.state;
  }
  return normalized.kindStates[event.kind] || normalized.fallback;
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
  if (event.kind === 'token' && event.usageLimits?.length) {
    return `<div class="eventPreview usageLimitPreview">${renderUsageLimitPreview(event.usageLimits)}</div>`;
  }
  if (event.kind === 'token' && event.tokenUsage?.length) {
    return `<div class="eventPreview tokenPreview">${renderTokenUsageBadges(event.tokenUsage)}</div>`;
  }
  const preview = event.snippet || event.preview || event.label;
  return `<div class="eventPreview">${escapeHtml(preview)}</div>`;
}

function renderTokenUsageBadges(items) {
  return items.map((item) => {
    const primary = item.primary ? ' primary' : '';
    return `<span class="tokenBadge${primary}"><span>${escapeHtml(item.label || '')}</span><strong>${escapeHtml(item.formatted ?? item.value ?? '')}</strong></span>`;
  }).join('');
}

function renderUsageLimitPreview(items) {
  return items.map((item) => `<div class="usageLimitMini"><strong>${escapeHtml(item.label || '')}</strong><span>${escapeHtml(item.remaining || '')} remaining</span><em>Resets ${escapeHtml(item.reset || '')}</em></div>`).join('');
}

function cssToken(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function renderTimeline() {
  el.timeline.innerHTML = state.currentEvents.map((event) => {
    const ds = displayState(event);
    const classes = [
      'event',
      ds,
      `state-${cssToken(ds)}`,
      `kind-${cssToken(event.kind)}`,
      event.severity,
      event.status ? `status-${cssToken(event.status)}` : '',
      event.id === state.selectedEventId ? 'selected' : '',
      event.hasSearchHit ? 'searchHit' : '',
      ds === 'hidden' ? 'hiddenByProfile' : '',
    ].filter(Boolean).join(' ');
    const chips = [
      event.layer ? `<span class="chip layerChip">${escapeHtml(event.layer)}</span>` : '',
      event.status ? `<span class="chip statusChip statusChip-${cssToken(event.status)}">${escapeHtml(event.status)}</span>` : '',
      event.toolName ? `<span class="chip toolChip">${escapeHtml(event.toolName)}</span>` : '',
      event.touchedFiles?.length ? `<span class="chip countChip">${event.touchedFiles.length} files</span>` : '',
      event.rawRefs?.length ? `<span class="chip countChip">${event.rawRefs.length} raw</span>` : '',
      event.channels?.length ? `<span class="chip channelChip">${escapeHtml(event.channels.join(','))}</span>` : '',
    ].join('');
    const toggleLabel = ds === 'expanded' ? 'Collapse event' : 'Expand event';
    return `<article class="${classes}" data-event-id="${escapeHtml(event.id)}">
      <div class="eventHeader">
        <button class="eventToggle" type="button" data-action="toggle" aria-label="${toggleLabel}" title="${toggleLabel}">
          <span class="srOnly">${toggleLabel}</span>
        </button>
        <span class="eventKind">${escapeHtml(event.label)}</span>
        <span class="chips">${chips}</span>
        <span class="eventTime">${escapeHtml(fmtDate(event.timestamp))}</span>
      </div>
      ${renderEventPreview(event, ds)}
      ${renderEventBody(event, ds)}
    </article>`;
  }).join('');
  queueVisibleDetailLoad();
}

function setOverride(eventId, value) {
  if (!state.overrides[state.selectedSessionId]) state.overrides[state.selectedSessionId] = {};
  state.overrides[state.selectedSessionId][eventId] = value;
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
  updateResetFoldsButton();
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

function maybeLoadMoreTimeline(scroller) {
  if (!scroller || !state.selectedSessionId || state.timelineLoading || state.offset >= state.timelineTotal) return;
  const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  if (remaining <= TIMELINE_AUTO_LOAD_SCROLL_THRESHOLD) {
    loadTimeline(true).catch(showError);
  }
}

function onTimelinePaneScroll(event) {
  queueVisibleDetailLoad();
  maybeLoadMoreTimeline(event.currentTarget);
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
  const categorySelect = categories.length > 1
    ? `<select class="navSelect" data-navigation-category aria-label="Quick navigation category">${categories.map((item) => (
      `<option value="${escapeHtml(item.id)}"${item.id === category.id ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
    )).join('')}</select>`
    : '';
  return `<nav class="eventNavigator" aria-label="Event quick navigation">
    ${categorySelect}
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
  showInspector(loaded, { replace: true });
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

function pushDetailView(nextView) {
  if (state.detailView) state.detailHistory.push(state.detailView);
  state.detailView = nextView;
}

function replaceDetailView(nextView) {
  state.detailView = nextView;
}

function closeDetailView() {
  state.detailHistory = [];
  state.detailSelectionKey = '';
  state.selectedEventId = '';
  state.navigationCategoryId = '';
  state.detailView = { type: 'profileRules' };
  renderProfileRulesPane();
  updateSelectedTimelineEvent();
}

function backDetailView() {
  const previous = state.detailHistory.pop() || { type: 'profileRules' };
  state.detailView = previous;
  renderCurrentDetailView();
}

function renderCurrentDetailView() {
  if (state.detailView.type === 'inspector') {
    const item = currentSelectedEvent();
    if (item) showInspector(item, { replace: true });
    else closeDetailView();
    return;
  }
  if (state.detailView.type === 'rawRefs') {
    const item = currentSelectedEvent();
    if (item) showRaw(item, { replace: true }).catch(showError);
    else closeDetailView();
    return;
  }
  renderProfileRulesPane();
}

function renderDetailShell({ title, subtitle = '', actions = '', body = '', closeable = true, backable = state.detailHistory.length > 0, headerClass = '' }) {
  updateDetailViewChrome();
  const hasChromeControls = backable || closeable;
  const resolvedHeaderClass = [headerClass, hasChromeControls ? 'detailChromeHeader' : ''].filter(Boolean).join(' ');
  const backButton = backable
    ? '<button class="detailIconBtn detailBackBtn" type="button" data-detail-action="back" aria-label="Back" title="Back">&larr;</button>'
    : '';
  const closeButton = closeable
    ? '<button class="detailIconBtn detailCloseBtn" type="button" data-detail-action="close" aria-label="Close" title="Close">&times;</button>'
    : '';
  el.detail.innerHTML = `<article class="detailView">
    <header class="detailViewHeader ${escapeHtml(resolvedHeaderClass)}">
      ${backButton}
      <div class="detailViewTitle">
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${closeButton}
      ${actions ? `<div class="detailViewActions">${actions}</div>` : ''}
    </header>
    ${body}
  </article>`;
}

function renderProfileRulesPane() {
  state.detailView = { type: 'profileRules' };
  state.detailSelectionKey = '';
  state.selectedEventId = '';
  state.navigationCategoryId = '';
  setMobileView('detail', { scroll: false });
  updateSelectedTimelineEvent();
  if (!profileAppliesToActiveLayer()) {
    const layer = activeLayerId();
    const fixedRuleText = layer === 'protocol'
      ? 'Protocol events are shown as summaries; non-protocol events stay collapsed.'
      : 'Raw event_msg and response_item records stay collapsed; other raw records are shown as summaries.';
    renderDetailShell({
      title: '折叠策略',
      subtitle: `${activeLayerLabel()} uses fixed display rules`,
      actions: '<button class="smallBtn" type="button" data-detail-action="view-main-layer">View Main timeline</button>',
      headerClass: 'profileDetailHeader',
      closeable: false,
      backable: false,
      body: `<section class="profileRules profileRulesInactive">
        <div class="notice info">
          <p>Folding strategies apply only to Main timeline. This layer uses fixed display rules.</p>
        </div>
        <section class="profileRuleSection">
          <h3>${escapeHtml(activeLayerLabel())}</h3>
          <p class="profileInactiveText">${escapeHtml(fixedRuleText)}</p>
        </section>
      </section>`,
    });
    return;
  }
  if (!state.profileDraft) resetProfileDraft();
  const profile = activeProfile();
  const draft = state.profileDraft || cloneProfile(profile);
  const dirty = profileDirty();
  const status = dirty ? 'Unsaved preview' : '';
  const profileOptions = state.profiles.map((item) => {
    const name = dirty && item.id === state.profileId && isBuiltinProfile(item.id)
      ? nextCustomProfileName(item.id)
      : item.name;
    return `<option value="${escapeHtml(item.id)}"${item.id === state.profileId ? ' selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
  const stateOptions = (value, includeDisabled = false) => [
    includeDisabled ? `<option value=""${value ? '' : ' selected'}>Disabled</option>` : '',
    ...DISPLAY_STATES.map((stateId) => `<option value="${stateId}"${stateId === value ? ' selected' : ''}>${DISPLAY_STATE_LABELS[stateId]}</option>`),
  ].join('');
  const rules = normalizeRules(draft.rules);
  const conditionMap = new Map(rules.conditions.map((condition) => [condition.id, condition.state]));
  const renderKindRow = (kind) => {
    const display = rules.kindStates[kind] || '';
    return `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(KIND_LABELS[kind] || kind)}</strong>
        <span>${escapeHtml(kind)}</span>
      </span>
      <select data-profile-kind="${escapeHtml(kind)}">
        <option value=""${display ? '' : ' selected'}>${escapeHtml(DISPLAY_STATE_LABELS[rules.fallback])} (Default)</option>
        ${DISPLAY_STATES.map((stateId) => `<option value="${stateId}"${stateId === display ? ' selected' : ''}>${DISPLAY_STATE_LABELS[stateId]}</option>`).join('')}
      </select>
    </label>`;
  };
  const explicitKinds = knownEventKinds().filter((kind) => rules.kindStates[kind]);
  const defaultKinds = knownEventKinds().filter((kind) => !rules.kindStates[kind]);
  const explicitKindRows = explicitKinds.map(renderKindRow).join('');
  const defaultKindRows = defaultKinds.map(renderKindRow).join('');
  const activeConditionRows = conditionDefinitions().filter((condition) => conditionMap.has(condition.id)).map((condition) => (
    `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(condition.name)}</strong>
        <span title="${escapeHtml(condition.description)}">${escapeHtml(condition.description)}</span>
      </span>
      <select data-profile-condition="${escapeHtml(condition.id)}">${stateOptions(conditionMap.get(condition.id) || '', true)}</select>
    </label>`
  )).join('');
  const inactiveConditionRows = conditionDefinitions().filter((condition) => !conditionMap.has(condition.id)).map((condition) => (
    `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(condition.name)}</strong>
        <span title="${escapeHtml(condition.description)}">${escapeHtml(condition.description)}</span>
      </span>
      <select data-profile-condition="${escapeHtml(condition.id)}">${stateOptions('', true)}</select>
    </label>`
  )).join('');
  const defaultKindNames = defaultKinds.map((kind) => KIND_LABELS[kind] || kind).join(', ');
  const editActions = dirty
    ? `<button class="smallBtn" type="button" data-detail-action="save-profile">Save</button>
    <button class="smallBtn" type="button" data-detail-action="cancel-profile">Cancel</button>`
    : '';
  const actions = `<div class="profileActionStack">
      <label class="profilePickerCompact">
      <select data-profile-picker aria-label="Strategy">${profileOptions}</select>
      </label>
      ${editActions}
  </div>`;
  renderDetailShell({
    title: '折叠策略',
    subtitle: [status, draft.description].filter(Boolean).join(' | '),
    actions,
    headerClass: 'profileDetailHeader',
    closeable: false,
    backable: false,
    body: `<section class="profileRules">
      <section class="profileRuleSection">
        <div class="profileRuleSectionHeader">
          <h3>Event kinds</h3>
        </div>
        <div class="profileRuleList">${explicitKindRows || '<div class="profileRuleEmpty">No explicit event-kind rules.</div>'}</div>
      </section>
      <details class="profileRuleDetails">
        <summary>
          <span>${escapeHtml(`${defaultKinds.length} event kinds use Default`)}</span>
          <label class="profileDefaultInline">
            <span>Default</span>
            <select data-profile-fallback>${stateOptions(rules.fallback)}</select>
          </label>
        </summary>
        <p>${escapeHtml(defaultKindNames)}</p>
        <div class="profileRuleList">${defaultKindRows}</div>
      </details>
      <section class="profileRuleSection">
        <h3>Conditions</h3>
        <div class="profileRuleList">${activeConditionRows || '<div class="profileRuleEmpty">No active conditions.</div>'}</div>
      </section>
      <details class="profileRuleDetails">
        <summary>${escapeHtml(`${conditionDefinitions().length - conditionMap.size} inactive conditions`)}</summary>
        <div class="profileRuleList">${inactiveConditionRows}</div>
      </details>
    </section>`,
  });
}

function showInspector(event, options = {}) {
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
  if (options.replace) replaceDetailView({ type: 'inspector', eventId: event.id });
  else pushDetailView({ type: 'inspector', eventId: event.id });
  setMobileView('detail');
  updateSelectedTimelineEvent();
  if (!currentNavigationCache()) {
    ensureNavigationEvents().then(() => {
      if (state.detailSelectionKey === key && state.selectedEventId === event.id) showInspector(event, { replace: true });
    }).catch(showError);
  }
  renderDetailShell({
    title: event.label,
    actions: renderInspectorNavigation(event),
    body: `<div class="inspector">
    <div class="chips">${chips}</div>
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
  </div>`,
  });

  if (!state.detailCache[key] && !state.detailErrors[key]) {
    loadEventDetail(event).then(() => {
      if (state.detailSelectionKey === key) showInspector(event, { replace: true });
    });
  }
}

async function showRaw(event, options = {}) {
  const refs = sourceRefs(event);
  const layer = activeLayerId();
  const rawKey = `raw:${detailKey(state.selectedSessionId, layer, event.id)}`;
  state.selectedEventId = event.id;
  state.detailSelectionKey = rawKey;
  if (options.replace) replaceDetailView({ type: 'rawRefs', eventId: event.id });
  else pushDetailView({ type: 'rawRefs', eventId: event.id });
  setMobileView('detail');
  updateSelectedTimelineEvent();
  if (!refs.length) {
    renderDetailShell({
      title: 'Raw refs',
      subtitle: `${event.label} | ${event.layer || layer} | ${event.kind}`,
      actions: '<button class="smallBtn" type="button" data-detail-action="inspect">Inspect event</button>',
      body: `<div class="rawRefsView">
      <div class="notice warning"><p>No raw source rows are available for this event.</p></div>
    </div>`,
    });
    return;
  }
  const payloads = await Promise.all(refs.map((ref) => api(`/api/raw?file=${encodeURIComponent(ref.file)}&line=${encodeURIComponent(ref.line)}`)));
  if (state.detailSelectionKey !== rawKey) return;
  renderDetailShell({
    title: 'Raw refs',
    subtitle: `${event.label} | ${event.layer || layer} | ${event.kind}`,
    actions: '<button class="smallBtn" type="button" data-detail-action="inspect">Inspect event</button>',
    body: `<div class="rawRefsView">
    <p class="rawMeta">${escapeHtml(`${refs.length} JSONL row${refs.length === 1 ? '' : 's'} for ${event.id}`)}</p>
    ${payloads.map((raw) => `<section class="inspectorSection"><p class="rawMeta">${escapeHtml(raw.file)}:${raw.line}</p><pre>${escapeHtml(JSON.stringify(raw.parsed, null, 2) || raw.raw)}</pre></section>`).join('')}
  </div>`,
  });
}

function ensureProfileDraft() {
  if (!state.profileDraft) resetProfileDraft();
  state.profileDraft.rules = normalizeRules(state.profileDraft.rules || defaultRules());
}

function setProfileId(profileId, options = {}) {
  state.profileId = profileId;
  localStorage.setItem('sessionAnalyzer.profile', state.profileId);
  el.profileSelect.value = state.profileId;
  resetProfileDraft();
  clearCurrentSessionOverrides();
  renderTimeline();
  updateMetricActionStates();
  if (!options.keepScroll) resetTimelineScroll();
  if (state.detailView.type === 'profileRules') renderProfileRulesPane();
}

async function changeProfile(profileId) {
  if (!state.profiles.some((profile) => profile.id === profileId)) return false;
  if (profileId === state.profileId) return true;
  const focusAnchor = captureFocusAnchor();
  if (profileDirty() && !(await resolveDirtyProfileBeforeSwitch(profileId))) {
    el.profileSelect.value = state.profileId;
    renderProfileRulesPane();
    return false;
  }
  setProfileId(profileId, { keepScroll: true });
  await restoreFocus(focusAnchor);
  return true;
}

async function resolveDirtyProfileBeforeSwitch(targetProfileId) {
  const result = await dirtyProfileSwitchChoice(targetProfileId);
  const choice = result.choice;
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  if (choice === 'save') {
    saveProfileDraft(result.name);
    return true;
  }
  return false;
}

function dirtyProfileSwitchChoice(targetProfileId) {
  if (state.dirtyProfileDecisionPending) return state.dirtyProfileDecisionPending;
  if (!el.dirtyProfileDialog) return Promise.resolve({ choice: 'cancel', name: '' });

  state.dirtyProfileDecisionPending = new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const currentProfile = activeProfile();
    const defaultName = isBuiltinProfile(state.profileId)
      ? nextCustomProfileName(state.profileId)
      : currentProfile.name;
    if (el.dirtyProfileCurrentName) el.dirtyProfileCurrentName.textContent = currentProfile.name;
    if (el.dirtyProfileSaveName) el.dirtyProfileSaveName.value = defaultName;
    const finish = (choice) => {
      el.dirtyProfileDialog.hidden = true;
      el.dirtyProfileDialog.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeydown);
      state.dirtyProfileDecisionPending = null;
      if (previousFocus?.focus) previousFocus.focus();
      resolve({ choice, name: el.dirtyProfileSaveName?.value.trim() || defaultName });
    };
    const onClick = (event) => {
      const choice = event.target.closest('[data-dirty-profile-choice]')?.dataset.dirtyProfileChoice;
      if (choice) finish(choice);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish('cancel');
        return;
      }
      if (event.key === 'Enter' && event.target === el.dirtyProfileSaveName) {
        event.preventDefault();
        finish('save');
      }
    };
    el.dirtyProfileDialog.hidden = false;
    el.dirtyProfileDialog.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
    el.dirtyProfileSaveName?.focus();
    el.dirtyProfileSaveName?.select();
  });

  return state.dirtyProfileDecisionPending;
}

function nextCustomProfileName(baseProfileId) {
  const base = state.builtinProfiles.find((profile) => profile.id === baseProfileId)
    || state.profiles.find((profile) => profile.id === baseProfileId)
    || activeProfile();
  const count = state.customProfiles.filter((profile) => profile.baseProfileId === baseProfileId).length + 1;
  return `${base.name} (自定义${count})`;
}

function saveProfileDraft(name = '') {
  ensureProfileDraft();
  const draft = normalizeProfiles([state.profileDraft])[0];
  if (isBuiltinProfile(state.profileId)) {
    const baseProfileId = state.profileId;
    const saved = {
      ...draft,
      id: `custom:${Date.now()}`,
      baseProfileId,
      name: String(name || '').trim() || nextCustomProfileName(baseProfileId),
      description: `Custom strategy based on ${activeProfile().name}`,
    };
    state.customProfiles.push(saved);
    saveCustomProfiles();
    state.profileId = saved.id;
  } else {
    state.customProfiles = state.customProfiles.map((profile) => (
      profile.id === state.profileId
        ? { ...draft, id: state.profileId, name: String(name || '').trim() || profile.name, baseProfileId: profile.baseProfileId }
        : profile
    ));
    saveCustomProfiles();
  }
  localStorage.setItem('sessionAnalyzer.profile', state.profileId);
  el.profileSelect.innerHTML = state.profiles.map((profile) => (
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`
  )).join('');
  el.profileSelect.value = state.profileId;
  resetProfileDraft();
  clearCurrentSessionOverrides();
  renderTimeline();
  renderProfileRulesPane();
}

function cancelProfileDraft() {
  resetProfileDraft();
  renderTimeline();
  renderProfileRulesPane();
}

el.projectList?.addEventListener('click', (event) => {
  const item = event.target.closest('[data-project-root]');
  if (item) selectProject(item.dataset.projectRoot).catch(showError);
});

el.projectSwitchControl?.addEventListener('click', () => {
  showProjectChooser({ autoRestore: false }).catch(showError);
});

el.sessionList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-session-id]');
  if (item) selectSession(item.dataset.sessionId, { mobileView: 'events' }).catch(showError);
});

el.sessionList.addEventListener('pointerover', (event) => {
  const item = event.target.closest('[data-parent-session-id]');
  if (item && el.sessionList.contains(item)) setRelatedParentHighlight(item.dataset.parentSessionId, true);
});

el.sessionList.addEventListener('pointerout', (event) => {
  const item = event.target.closest('[data-parent-session-id]');
  if (!item || !el.sessionList.contains(item)) return;
  if (item.contains(event.relatedTarget)) return;
  setRelatedParentHighlight(item.dataset.parentSessionId, false);
});

el.sessionList.addEventListener('focusin', (event) => {
  const item = event.target.closest('[data-parent-session-id]');
  if (item && el.sessionList.contains(item)) setRelatedParentHighlight(item.dataset.parentSessionId, true);
});

el.sessionList.addEventListener('focusout', (event) => {
  const item = event.target.closest('[data-parent-session-id]');
  if (!item || !el.sessionList.contains(item)) return;
  setRelatedParentHighlight(item.dataset.parentSessionId, false);
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
    const next = article.classList.contains('expanded') ? foldedDisplayState(item) : 'expanded';
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
    if (!article.classList.contains('expanded')) {
      setOverride(item.id, 'expanded');
      renderTimeline();
      ensureEventDetail(item);
    }
    showInspector(item);
  }
});

el.detail.addEventListener('click', (event) => {
  const action = event.target.closest('[data-detail-action]')?.dataset.detailAction;
  if (!action) return;
  if (action === 'back') {
    backDetailView();
    return;
  }
  if (action === 'close') {
    closeDetailView();
    return;
  }
  if (action === 'save-profile') {
    saveProfileDraft();
    return;
  }
  if (action === 'cancel-profile') {
    cancelProfileDraft();
    return;
  }
  if (action === 'view-main-layer') {
    changeLayer('main').catch(showError);
    return;
  }
  if (action === 'navigate-event') {
    navigateSelectedEvent(event.target.closest('[data-nav-direction]')?.dataset.navDirection || '').catch(showError);
    return;
  }
  const key = state.detailSelectionKey.replace(/^raw:/, '');
  const item = state.currentEvents.find((candidate) => detailKey(state.selectedSessionId, activeLayerId(), candidate.id) === key);
  if (!item) return;
  if (action === 'inspect') {
    showInspector(item, { replace: true });
  } else if (action === 'raw') {
    showRaw(item).catch(showError);
  } else if (action === 'retry-detail') {
    delete state.detailErrors[key];
    delete state.detailCache[key];
    showInspector(item, { replace: true });
  }
});

el.detail.addEventListener('change', (event) => {
  const profilePicker = event.target.closest('[data-profile-picker]');
  if (profilePicker) {
    changeProfile(profilePicker.value).catch(showError);
    return;
  }
  const fallback = event.target.closest('[data-profile-fallback]');
  if (fallback) {
    ensureProfileDraft();
    state.profileDraft.rules.fallback = fallback.value;
    renderTimeline();
    renderProfileRulesPane();
    return;
  }
  const kindSelect = event.target.closest('[data-profile-kind]');
  if (kindSelect) {
    ensureProfileDraft();
    const kind = kindSelect.dataset.profileKind;
    if (kindSelect.value) state.profileDraft.rules.kindStates[kind] = kindSelect.value;
    else delete state.profileDraft.rules.kindStates[kind];
    renderTimeline();
    renderProfileRulesPane();
    return;
  }
  const conditionSelect = event.target.closest('[data-profile-condition]');
  if (conditionSelect) {
    ensureProfileDraft();
    const conditionId = conditionSelect.dataset.profileCondition;
    state.profileDraft.rules.conditions = state.profileDraft.rules.conditions.filter((condition) => condition.id !== conditionId);
    if (conditionSelect.value) state.profileDraft.rules.conditions.push({ id: conditionId, state: conditionSelect.value });
    renderTimeline();
    renderProfileRulesPane();
    return;
  }
  const select = event.target.closest('[data-navigation-category]');
  if (!select) return;
  state.navigationCategoryId = select.value;
  const item = currentSelectedEvent();
  if (item) showInspector(item, { replace: true });
});

el.profileSelect.addEventListener('change', () => {
  changeProfile(el.profileSelect.value).catch(showError);
});

el.layerSelect.addEventListener('change', () => {
  changeLayer(el.layerSelect.value).catch(showError);
});

el.resetFoldsBtn.addEventListener('click', () => {
  delete state.overrides[state.selectedSessionId];
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
  updateResetFoldsButton();
  renderTimeline();
});

el.loadMoreBtn.addEventListener('click', () => loadTimeline(true).catch(showError));
el.analysisPanel?.addEventListener('click', (event) => {
  const metricEl = event.target.closest('[data-metric-action]');
  if (!metricEl) return;
  applyMetricAction(metricEl).catch(showError);
});
el.analysisPanel?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const metricEl = event.target.closest('[data-metric-action]');
  if (!metricEl) return;
  event.preventDefault();
  applyMetricAction(metricEl).catch(showError);
});
el.resultSummary?.addEventListener('click', (event) => {
  const clear = event.target.closest('[data-clear-filter]')?.dataset.clearFilter;
  if (clear) clearActiveFilter(clear);
});
el.timeline.closest('.timelinePane')?.addEventListener('scroll', onTimelinePaneScroll, { passive: true });
window.addEventListener('resize', queueVisibleDetailLoad);

const reload = debounce(() => {
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  if (state.detailView.type === 'profileRules') renderProfileRulesPane();
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
  const suggestedFile = event.target.closest('[data-search-file-suggestion]')?.dataset.searchFileSuggestion;
  if (suggestedFile) {
    applySearchOperator('file', suggestedFile);
    hideFileSuggestions();
    return;
  }
});

el.searchAssist?.addEventListener('focusin', (event) => {
  if (event.target !== el.searchFileInput) return;
  renderFileSuggestions();
  setFileSuggestionsOpen(true);
});

el.searchAssist?.addEventListener('change', (event) => {
  const control = event.target.closest('[data-search-operator]');
  if (!control) return;
  if (control.dataset.searchOperator === 'file') hideFileSuggestions();
  applySearchOperator(control.dataset.searchOperator, control.value.trim());
});

el.searchAssist?.addEventListener('input', (event) => {
  const control = event.target.closest('[data-search-operator="file"]');
  if (!control) return;
  renderFileSuggestions();
  setFileSuggestionsOpen(true);
  if (isSuggestedFile(control.value)) {
    hideFileSuggestions();
    applySearchOperator('file', control.value.trim());
  }
});

el.searchAssist?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && event.target === el.searchFileInput && !el.searchFileSuggestions?.hidden) {
    event.preventDefault();
    hideFileSuggestions();
    return;
  }
  if (event.key === 'ArrowDown' && event.target === el.searchFileInput && !el.searchFileSuggestions?.hidden) {
    const firstSuggestion = el.searchFileSuggestions.querySelector('[data-search-file-suggestion]');
    if (firstSuggestion) {
      event.preventDefault();
      firstSuggestion.focus();
    }
    return;
  }
  if (event.key !== 'Enter') return;
  const control = event.target.closest('[data-search-operator]');
  if (!control) return;
  event.preventDefault();
  hideFileSuggestions();
  applySearchOperator(control.dataset.searchOperator, control.value.trim());
});

document.addEventListener('pointerdown', (event) => {
  if (el.searchFileInput && !event.target.closest('.fileSuggestControl')) hideFileSuggestions();
  if (!el.searchField || el.searchField.contains(event.target)) return;
  hideSearchAssist();
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
      changeProfile(next.id).catch(showError);
    }
  }
  if (event.altKey && event.key === 'ArrowLeft') {
    const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
    const next = state.profiles[(i - 1 + state.profiles.length) % state.profiles.length];
    if (next) {
      changeProfile(next.id).catch(showError);
    }
  }
});

function showError(error) {
  if (state.selectingProject) {
    setProjectHeader('', error.message);
  } else {
    el.stateLine.textContent = error.message;
  }
  if (state.selectingProject && el.projectStatus) el.projectStatus.textContent = error.message;
  console.error(error);
}

init().catch(showError);
