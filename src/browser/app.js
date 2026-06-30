'use strict';

const rendererApi = window.sessionRenderers;
const escapeHtml = rendererApi.escapeHtml;
const renderSections = rendererApi.renderSections;
const renderTimelineSections = rendererApi.renderTimelineSections;
const searchQuery = window.sessionSearchQuery;
const searchHighlighter = window.sessionSearchHighlighter;
const foldingApi = window.sessionFolding;
const i18n = window.sessionI18n;
const navigationApi = window.sessionNavigation;
const eventChipsApi = window.sessionEventChips;

const NAVIGATION_PAGE_LIMIT = 500;
const TIMELINE_AUTO_LOAD_SCROLL_THRESHOLD = 96;
const SEARCH_TARGET_PRELOAD_MIN = 5;
const SEARCH_TARGET_PRELOAD_MAX_PAGES = 3;
const FILE_SUGGESTION_LIMIT = 12;
const SEARCH_HIGHLIGHT_INPUT_DELAY_MS = 300;
const DETAIL_VIEW_ORIGIN_SEARCH = 'searchTransient';
const DETAIL_VIEW_ORIGIN_USER = 'userConfirmed';
const REPO_STORAGE_KEY = 'sessionAnalyzer.repoRoot';
const CUSTOM_PROFILES_KEY = 'sessionAnalyzer.customProfiles';
const OVERRIDES_KEY = 'sessionAnalyzer.overrides';
const LOCALE_STORAGE_KEY = 'sessionAnalyzer.locale';
const DISPLAY_STATES = foldingApi.DISPLAY_STATES;
const CONDITION_DISPLAY_STATES = foldingApi.CONDITION_DISPLAY_STATES;
const EDITABLE_EVENT_KINDS = foldingApi.EDITABLE_EVENT_KINDS;
const EDITABLE_KIND_GROUPS = foldingApi.EDITABLE_KIND_GROUPS;
const CONDITION_DEFINITIONS = foldingApi.CONDITION_DEFINITIONS;
const normalizeRules = foldingApi.normalizeRules;
const normalizeOverrides = foldingApi.normalizeOverrides;
const evaluateDisplayStateFromRules = foldingApi.displayStateFromRules;
const inspectorChipValues = eventChipsApi.inspectorChipValues;
const rawRefsSubtitle = eventChipsApi.rawRefsSubtitle;
const KIND_LABELS = {
  user_message: 'User message',
  assistant_message: 'Assistant message',
  command: 'Command',
  patch: 'Patch',
  mcp_call: 'MCP call',
  js_repl: 'JS REPL',
  other_tool_call: 'Other tool call',
  proposed_plan: 'Proposed plan',
  plan_update: 'Plan update',
  protocol: 'Protocol',
  error: 'Error',
  warning: 'Warning',
  abort: 'Turn aborted',
  rollback: 'Thread rollback',
  compaction: 'Context compaction',
  usage_limit_warning: 'Usage limit warning',
  subagent: 'Subagent activity',
  review: 'Review',
  reasoning: 'Reasoning',
  web_search: 'Web search',
  goal: 'Goal',
  hook: 'Hook',
  developer_message: 'Developer message',
  event: 'Event',
};
const STATUS_LABELS = {
  active: 'Active',
  blocked: 'Blocked',
  complete: 'Complete',
  failed: 'Failed',
  success: 'Success',
  completed: 'Completed',
};
const LAYER_LABELS = {
  main: 'Main timeline',
  protocol: 'Protocol layer',
  raw: 'Raw records',
};
const NAVIGATION_CATEGORIES = navigationApi.NAVIGATION_CATEGORIES;

function browserLocale() {
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (saved) return i18n.resolveLocale(saved);
  return i18n.resolveLocale(navigator.languages?.[0] || navigator.language || '');
}

function t(key, vars = {}) {
  return i18n.t(state?.locale || browserLocale(), 'ui', key, vars);
}

function displayStateLabel(value) {
  return i18n.displayStateLabel(value, state?.locale || browserLocale());
}

function statusLabel(value) {
  return i18n.statusLabel(value, state?.locale || browserLocale());
}

function searchStatusLabel(value) {
  return i18n.searchStatusLabel(value, state?.locale || browserLocale());
}

const state = {
  locale: browserLocale(),
  sessions: [],
  projectResults: [],
  repoRoot: '',
  projects: [],
  projectSelected: false,
  selectingProject: false,
  projectLoadingRoot: '',
  projectJobId: '',
  projectPollTimer: 0,
  projectChooserRequestId: 0,
  projectReturning: false,
  sessionsRequestId: 0,
  projectSearchRequestId: 0,
  projectSearchDataContext: '',
  projectSearchTotal: 0,
  projectSearchEventTotal: 0,
  projectSearchSort: 'latest-match-desc',
  projectSearchLoading: false,
  projectReturnContext: null,
  analysisRequestId: 0,
  selectedSessionId: '',
  selectedEventId: '',
  offset: 0,
  limit: 150,
  timelineLoading: false,
  timelineRequestId: 0,
  sessionsDataContext: '',
  timelineDataContext: '',
  sessionGrandTotal: 0,
  sessionTotal: 0,
  timelineTotal: 0,
  timelineSearchMatchCount: 0,
  timelineSearchEventCount: 0,
  currentEvents: [],
  fileSuggestions: [],
  fileSuggestionRequestId: 0,
  eventKinds: { main: [], protocol: [], raw: [] },
  sessionEventKinds: { main: [], protocol: [], raw: [] },
  profiles: [],
  builtinProfiles: [],
  customProfiles: readJsonStorage(CUSTOM_PROFILES_KEY, []),
  profileId: localStorage.getItem('sessionAnalyzer.profile') || 'narrative',
  previousProfileBeforeMetric: '',
  previousLayerBeforeProtocol: '',
  dirtyProfileDecisionPending: null,
  profileDraft: null,
  layerId: localStorage.getItem('sessionAnalyzer.layer') || 'main',
  overrides: normalizeOverrides(readJsonStorage(OVERRIDES_KEY, {})),
  detailCache: {},
  detailErrors: {},
  detailPending: {},
  detailCacheGeneration: 0,
  detailViewportTimer: 0,
  detailView: { type: 'profileRules' },
  detailHistory: [],
  detailSelectionKey: '',
  navigationCategoryId: '',
  navigationCategoryManualId: '',
  navigationCache: { key: '', events: [], total: 0, pending: null },
  navigationLoadErrorKey: '',
  searchHighlight: { query: '', marks: [] },
  searchScope: 'session',
  searchQuery: '',
  searchFilters: { file: '', kind: '', status: '' },
  searchValidation: [],
  searchTargetRegistry: { key: '', targets: [], activeTargetId: '' },
  searchNavigation: { running: false, queue: [] },
  searchProgrammaticScroll: { active: false, timer: 0, paginationFrame: 0 },
  searchHighlightTimer: 0,
  searchTargetPreload: { key: '', pages: 0, pending: false },
  searchTransientExpansion: { key: '', eventIds: [] },
  searchStructureKey: '',
  searchSurfaceContexts: { sessions: '', timeline: '', detail: '' },
  mobileView: 'sessions',
};

const el = {
  topbar: document.querySelector('.topbar'),
  projectTitle: document.getElementById('projectTitle'),
  projectSwitchControl: document.getElementById('projectSwitchControl'),
  projectSwitchHint: document.querySelector('.projectSwitchHint'),
  stateLine: document.getElementById('stateLine'),
  searchInput: document.getElementById('searchInput'),
  searchScopeButtons: document.querySelectorAll('[data-search-scope]'),
  searchValidation: document.getElementById('searchValidation'),
  searchActionRegion: document.getElementById('searchActionRegion'),
  localeSelect: document.getElementById('localeSelect'),
  searchAssist: document.getElementById('searchAssist'),
  searchAssistChips: document.getElementById('searchAssistChips'),
  searchField: document.querySelector('.searchField'),
  searchKindLabel: document.getElementById('searchKindLabel'),
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
  projectProgress: document.getElementById('projectProgress'),
  projectCancelBtn: document.getElementById('projectCancelBtn'),
  projectList: document.getElementById('projectList'),
  projectChooserTitle: document.querySelector('.projectChooserHeader h2'),
  projectChooserDescription: document.querySelector('.projectChooserHeader p'),
};

let profileInfoSlot = null;

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
  syncProfileInfoSlot();
}

function updateDetailViewChrome() {
  document.body.dataset.detailView = state.detailView?.type || 'profileRules';
}

function setText(node, text) {
  if (node) node.textContent = text;
}

function setSelectOptionText(select, value, text) {
  const option = select ? [...select.options].find((item) => item.value === value) : null;
  if (option) option.textContent = text;
}

function applyStaticLocale() {
  window.sessionAnalyzerLocale = state.locale;
  document.documentElement.lang = state.locale;
  if (el.localeSelect) el.localeSelect.value = state.locale;
  document.querySelector('.localeControl .srOnly') && setText(document.querySelector('.localeControl .srOnly'), t('localeLabel'));
  if (el.localeSelect) el.localeSelect.setAttribute('aria-label', t('localeLabel'));
  if (!state.repoRoot && !state.projectLoadingRoot) setText(el.stateLine, t('stateLoading'));
  syncSearchScopeUi();
  if (el.searchAssist) el.searchAssist.setAttribute('aria-label', t('searchOptions'));
  if (el.searchActionRegion) el.searchActionRegion.setAttribute('aria-label', t('activeSearchContext'));
  document.querySelector('[data-search-match-controls]')?.setAttribute('title', t('searchMatchTitle'));
  document.querySelector('[data-search-match-nav="previous"]')?.setAttribute('aria-label', t('previousSearchMatch'));
  document.querySelector('[data-search-match-nav="previous"]')?.setAttribute('title', t('previousSearchMatch'));
  document.querySelector('[data-search-match-nav="next"]')?.setAttribute('aria-label', t('nextSearchMatch'));
  document.querySelector('[data-search-match-nav="next"]')?.setAttribute('title', t('nextSearchMatch'));
  document.querySelectorAll('.searchAssistTitle')[0] && setText(document.querySelectorAll('.searchAssistTitle')[0], t('searchFilters'));
  document.querySelectorAll('.searchAssistTitle')[1] && setText(document.querySelectorAll('.searchAssistTitle')[1], t('active'));
  setSelectOptionText(el.searchKindSelect, '', t('anyKind'));
  setSelectOptionText(el.searchStatusSelect, '', t('anyStatus'));
  setSelectOptionText(el.searchStatusSelect, 'active', searchStatusLabel('active'));
  setSelectOptionText(el.searchStatusSelect, 'blocked', searchStatusLabel('blocked'));
  setSelectOptionText(el.searchStatusSelect, 'complete', searchStatusLabel('complete'));
  setSelectOptionText(el.searchStatusSelect, 'failed', searchStatusLabel('failed'));
  setSelectOptionText(el.searchStatusSelect, 'success', searchStatusLabel('success'));
  setSelectOptionText(el.searchStatusSelect, 'completed', searchStatusLabel('completed'));
  setSelectOptionText(el.searchLayerSelect, '', t('currentLayer'));
  setSelectOptionText(el.searchLayerSelect, 'main', t('mainTimeline'));
  setSelectOptionText(el.searchLayerSelect, 'protocol', t('protocolLayer'));
  setSelectOptionText(el.searchLayerSelect, 'raw', t('rawRecords'));
  setSelectOptionText(el.layerSelect, 'main', t('mainTimeline'));
  setSelectOptionText(el.layerSelect, 'protocol', t('protocolLayer'));
  setSelectOptionText(el.layerSelect, 'raw', t('rawRecords'));
  setSelectOptionText(el.sortSelect, 'updated-desc', t('updatedDesc'));
  setSelectOptionText(el.sortSelect, 'started-asc', t('startedAsc'));
  setSelectOptionText(el.sortSelect, 'events-desc', t('eventsDesc'));
  setSelectOptionText(el.sortSelect, 'failures-desc', t('failuresDesc'));
  setText(document.querySelector('.mobileViewTab[data-mobile-view="sessions"]'), t('sessions'));
  setText(document.querySelector('.mobileViewTab[data-mobile-view="events"]'), t('events'));
  setText(document.querySelector('.mobileViewTab[data-mobile-view="detail"]'), t('detail'));
  setText(el.resetFoldsBtn, t('resetFolds'));
  setText(el.loadMoreBtn, t('loadMore'));
  setText(document.querySelector('.projectChooserHeader h2'), t('selectProject'));
  setText(document.querySelector('.projectChooserHeader p'), t('chooseProject'));
  setText(el.projectCancelBtn, t('cancelIndexing'));
  setText(document.querySelector('.sessionsPane .sessionListHeader h2'), t('sessions'));
  setText(document.querySelector('.sortControl .srOnly'), t('sort'));
  el.layerSelect?.setAttribute('aria-label', t('layer'));
  el.profileSelect?.setAttribute('aria-label', t('foldingStrategy'));
  setText(document.getElementById('dirtyProfileTitle'), t('dirtyProfileTitle'));
  setText(document.getElementById('dirtyProfileMessage'), t('dirtyProfileMessage'));
  setText(document.querySelector('.appDialogMeta dt'), t('currentStrategy'));
  setText(document.querySelector('.appDialogField span'), t('saveAs'));
  setText(document.querySelector('[data-dirty-profile-choice="save"]'), t('saveAndSwitch'));
  setText(document.querySelector('[data-dirty-profile-choice="discard"]'), t('discardAndSwitch'));
  setText(document.querySelector('[data-dirty-profile-choice="cancel"]'), t('cancel'));
  const sessionHeaderTitle = el.sessionHeader?.querySelector('h2');
  const sessionHeaderText = el.sessionHeader?.querySelector('p');
  if (!state.selectedSessionId) {
    setText(sessionHeaderTitle, t('chooseSession'));
    setText(sessionHeaderText, t('leftListFiltered'));
  }
  if (!state.selectedEventId && !el.detail?.querySelector('.detailView')) {
    const detailTitle = el.detail?.querySelector('h2');
    const detailText = el.detail?.querySelector('p');
    setText(detailTitle, t('eventDetail'));
    setText(detailText, t('clickTimelineEvent'));
  }
  updateProjectChooserHeader();
  updateProjectSwitchControl();
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
  let requestPath = path;
  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('locale', state.locale);
    requestPath = `${url.pathname}${url.search}${url.hash}`;
  }
  if (options.body && typeof options.body !== 'string') {
    init.body = JSON.stringify(options.body);
    init.headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  }
  return fetch(requestPath, init).then(async (res) => {
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
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  return debounced;
}

function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function projectName(repoRoot) {
  const text = String(repoRoot || '').replace(/[\\/]+$/, '');
  if (!text) return t('selectProject');
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function setProjectHeader(repoRoot, summary) {
  updateProjectSwitchControl({ displayRoot: repoRoot, returnRoot: state.repoRoot });
  el.stateLine.textContent = summary || '';
}

function updateProjectChrome(options = {}) {
  if (el.topbar) el.topbar.hidden = Boolean(state.projectLoadingRoot);
  updateProjectChooserHeader();
  updateProjectSwitchControl(options);
}

function updateProjectChooserHeader() {
  if (!el.projectChooserTitle || !el.projectChooserDescription) return;
  if (state.projectLoadingRoot) {
    el.projectChooserTitle.textContent = t('openingProject', { name: projectName(state.projectLoadingRoot) });
    el.projectChooserDescription.textContent = t('indexingProject');
  } else {
    el.projectChooserTitle.textContent = t('selectProject');
    el.projectChooserDescription.textContent = t('chooseProject');
  }
}

function updateProjectSwitchControl(options = {}) {
  const displayRoot = Object.hasOwn(options, 'displayRoot') ? options.displayRoot : state.repoRoot;
  const returnRoot = Object.hasOwn(options, 'returnRoot') ? options.returnRoot : state.repoRoot;
  const canReturn = state.selectingProject && Boolean(returnRoot);
  const labelRoot = canReturn ? returnRoot : displayRoot;
  if (el.projectTitle) el.projectTitle.textContent = projectName(labelRoot);
  if (el.projectSwitchHint) {
    el.projectSwitchHint.textContent = state.projectReturning ? t('returning') : (canReturn ? t('return') : (displayRoot ? t('change') : t('select')));
  }
  if (!el.projectSwitchControl) return;
  el.projectSwitchControl.disabled = state.projectReturning || Boolean(state.projectLoadingRoot || state.projectJobId);
  if (state.projectReturning && returnRoot) {
    el.projectSwitchControl.title = t('returningToProject', { root: returnRoot });
    el.projectSwitchControl.setAttribute('aria-label', t('returningToCurrentProject', { root: returnRoot }));
  } else if (canReturn) {
    el.projectSwitchControl.title = t('returnToProject', { root: returnRoot });
    el.projectSwitchControl.setAttribute('aria-label', t('returnToCurrentProject', { root: returnRoot }));
  } else {
    el.projectSwitchControl.title = displayRoot ? t('switchProject', { root: displayRoot }) : t('selectProject');
    el.projectSwitchControl.setAttribute('aria-label', displayRoot ? t('switchTargetProject', { root: displayRoot }) : t('selectProject'));
  }
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

function fmtDuration(ms) {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return '0s';
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}s`;
}

function humanizeKind(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^mcp\b/i.test(text)) return text.replace(/_/g, ' ').replace(/^mcp/i, 'MCP');
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bJs\b/g, 'JS');
}

function kindLabel(value) {
  return i18n.eventKindLabel(value, state.locale) || KIND_LABELS[value] || humanizeKind(value) || value;
}

function projectProgressPercent(progress) {
  const phase = progress?.phase || '';
  if (phase === 'complete') return 100;
  if (phase === 'parsing') {
    const total = Number(progress.candidateFileCount || 0);
    const done = Number(progress.indexedFileCount || 0);
    return total ? Math.max(5, Math.min(99, Math.round((done / total) * 100))) : 5;
  }
  const total = Number(progress?.filesTotal || 0);
  const done = Number(progress?.filesScanned || 0);
  return total ? Math.max(1, Math.min(95, Math.round((done / total) * 100))) : 0;
}

function renderProjectJob(job) {
  const progress = job?.progress || {};
  const phase = progress.phase || job?.status || 'queued';
  const parts = [];
  if (phase === 'selecting') {
    parts.push(t('scanningFiles', { done: progress.filesScanned || 0, total: progress.filesTotal || 0 }));
    parts.push(t('candidates', { count: progress.candidateFileCount || 0 }));
    parts.push(t('skipped', { count: progress.skippedFileCount || 0 }));
  } else if (phase === 'parsing') {
    parts.push(t('parsingFiles', { done: progress.indexedFileCount || 0, total: progress.candidateFileCount || 0 }));
    parts.push(t('sessionCount', { count: progress.sessionCount || 0 }));
    parts.push(fmtBytes(progress.indexedBytes || 0));
  } else if (job?.status === 'cancelled') {
    parts.push(t('indexingCancelled'));
  } else if (job?.status === 'failed') {
    parts.push(job.error || t('indexingFailed'));
  } else {
    parts.push(t('preparingIndex', { name: projectName(job?.repoRoot || progress.repoRoot || '') }));
  }
  if (progress.elapsedMs || job?.buildMs) parts.push(fmtDuration(progress.elapsedMs || job.buildMs));
  if (el.projectStatus) el.projectStatus.textContent = parts.join(' | ');
  if (el.projectProgress) {
    el.projectProgress.hidden = !job || ['failed', 'cancelled'].includes(job.status);
    el.projectProgress.value = projectProgressPercent(progress);
  }
  if (el.projectCancelBtn) {
    el.projectCancelBtn.hidden = !job || !['queued', 'running'].includes(job.status);
  }
}

function currentSearchState() {
  return {
    scope: state.searchScope,
    q: state.searchQuery,
    file: state.searchFilters.file,
    kind: state.searchFilters.kind,
    status: state.searchFilters.status,
    layer: state.layerId || 'main',
    validation: state.searchValidation,
  };
}

function syncSearchScopeUi() {
  document.body.dataset.searchScope = state.searchScope;
  for (const button of el.searchScopeButtons) {
    const scope = button.dataset.searchScope;
    button.setAttribute('aria-pressed', scope === state.searchScope ? 'true' : 'false');
    button.disabled = scope === 'session' && !state.selectedSessionId;
    button.textContent = scope === 'session' ? t('currentSessionScope') : t('entireProjectScope');
  }
  const group = document.querySelector('.searchScopeControl');
  if (group) group.setAttribute('aria-label', t('searchScope'));
  if (el.searchInput) {
    el.searchInput.placeholder = state.searchScope === 'project'
      ? t('projectSearchPlaceholder')
      : t('sessionSearchPlaceholder');
  }
  if (el.sortSelect && !state.selectingProject) el.sortSelect.disabled = state.searchScope === 'project';
  setText(el.searchKindLabel, state.searchScope === 'project' ? t('eventTypeProjectTotal') : t('eventTypeSessionTotal'));
}

function hasActiveSearchExpression() {
  const search = currentSearchState();
  return Boolean(search.q || search.file || search.kind || search.status);
}

function searchInputValueFromState() {
  return [
    state.searchQuery,
    ...state.searchValidation.map((item) => item.raw),
  ].filter(Boolean).join(' ').trim();
}

function syncSearchInputValue() {
  const value = searchInputValueFromState();
  if (el.searchInput.value !== value) el.searchInput.value = value;
}

function clearSearchValidationOperator(operator) {
  const next = state.searchValidation.filter((item) => item.operator !== operator);
  if (next.length === state.searchValidation.length) return false;
  state.searchValidation = next;
  syncSearchInputValue();
  renderSearchValidation();
  return true;
}

function commitTypedSearchInput() {
  const parsed = searchQuery.parseSearchInput(el.searchInput.value);
  const filters = { ...state.searchFilters };
  for (const token of parsed.tokens) {
    if (!token.valid || !Object.hasOwn(filters, token.operator)) continue;
    filters[token.operator] = token.value;
  }
  state.searchQuery = parsed.q;
  state.searchFilters = filters;
  state.searchValidation = parsed.errors;
  el.searchInput.value = parsed.retainedInput;
  renderSearchValidation();
  return parsed.layer && parsed.layer !== state.layerId ? parsed.layer : '';
}

function activeLayerId() {
  return currentSearchState().layer || 'main';
}

function profileAppliesToActiveLayer() {
  return activeLayerId() === 'main';
}

function activeLayerLabel() {
  const layer = activeLayerId();
  if (layer === 'main') return t('mainTimeline');
  if (layer === 'protocol') return t('protocolLayer');
  if (layer === 'raw') return t('rawRecords');
  return LAYER_LABELS[layer] || layer;
}

function highlightTerms() {
  return searchHighlighter.searchTerms(currentSearchState().q);
}

function highlightRoots() {
  return [el.timeline, el.detail].filter(Boolean);
}

function sessionsDataContextKey() {
  return JSON.stringify([
    state.repoRoot,
    el.sortSelect?.value || '',
    state.locale,
  ]);
}

function projectSearchDataContextKey() {
  const search = currentSearchState();
  return JSON.stringify([
    state.repoRoot,
    search.scope,
    state.selectedSessionId,
    search.q,
    search.layer,
    search.kind,
    search.status,
    search.file,
    state.projectSearchSort,
    state.locale,
  ]);
}

function timelineDataContextKey() {
  const search = currentSearchState();
  return JSON.stringify([
    state.repoRoot,
    search.scope,
    state.selectedSessionId,
    search.layer,
    search.q,
    search.kind,
    search.status,
    search.file,
    state.locale,
  ]);
}

function foldingProfileSearchContextKey() {
  return JSON.stringify([
    state.profileId,
    normalizeRules(activeProfileRules()),
  ]);
}

function timelineSearchSurfaceContextKey() {
  return JSON.stringify([
    timelineDataContextKey(),
    foldingProfileSearchContextKey(),
    el.sortSelect?.value || '',
  ]);
}

function detailSearchSurfaceContextKey() {
  return JSON.stringify([
    timelineDataContextKey(),
    state.detailCacheGeneration,
    state.detailView?.type || '',
    state.detailView?.eventId || '',
  ]);
}

function searchDiscoveryContextReady() {
  if (state.searchScope !== 'session') return false;
  const sessionsReady = state.searchSurfaceContexts.sessions === sessionsDataContextKey();
  const timelineReady = !state.selectedSessionId
    || state.searchSurfaceContexts.timeline === timelineSearchSurfaceContextKey();
  return sessionsReady && timelineReady;
}

function searchTargetKey() {
  const search = currentSearchState();
  return [
    state.repoRoot,
    search.scope,
    state.selectedSessionId,
    search.layer,
    search.q,
    search.kind,
    search.status,
    search.file,
    foldingProfileSearchContextKey(),
    search.scope === 'project' ? state.projectSearchSort : (el.sortSelect?.value || ''),
    state.locale,
  ].join('\u001f');
}

function searchTargetPreloadKey() {
  return searchTargetKey();
}

function resetSearchTargetRegistry(key = searchTargetKey()) {
  state.searchTargetRegistry = { key, targets: [], activeTargetId: '' };
}

function syncSearchTargetRegistryKey() {
  const key = searchTargetKey();
  if (state.searchTargetRegistry.key !== key) resetSearchTargetRegistry(key);
  return key;
}

function beginSearchTargetContextTransition() {
  const key = searchTargetKey();
  if (state.searchTargetRegistry.key === key) return false;
  clearQueuedSearchNavigations();
  state.searchTargetPreload = { key: '', pages: 0, pending: false };
  highlightRoots().forEach((root) => searchHighlighter.clear(root));
  state.searchHighlight = { query: currentSearchState().q, marks: [] };
  resetSearchTargetRegistry(key);
  state.timelineSearchMatchCount = 0;
  state.timelineSearchEventCount = 0;
  updateSearchMatchControls();
  return true;
}

function searchTargetId(searchKey, surface, ownerId, occurrence) {
  return JSON.stringify([searchKey, surface, ownerId, occurrence]);
}

function searchTargetIndex() {
  const { targets, activeTargetId } = state.searchTargetRegistry;
  return targets.findIndex((target) => target.id === activeTargetId);
}

function activeSearchTarget() {
  const index = searchTargetIndex();
  return index >= 0 ? state.searchTargetRegistry.targets[index] : null;
}

function searchableHighlightOwners() {
  if (!searchDiscoveryContextReady()) return [];
  const owners = [];
  const eventIds = new Set(state.currentEvents.map((event) => event.id));
  for (const article of el.timeline?.querySelectorAll('[data-event-id]:not(.hiddenByProfile)') || []) {
    if (eventIds.has(article.dataset.eventId)) {
      owners.push({ surface: 'timeline', ownerId: article.dataset.eventId, root: article });
    }
  }
  if (state.detailView.type === 'inspector' && state.detailView.eventId) {
    const inspector = el.detail?.querySelector('.inspector');
    const detailReady = state.searchSurfaceContexts.detail === detailSearchSurfaceContextKey();
    if (inspector && detailReady && eventIds.has(state.detailView.eventId)) {
      owners.push({ surface: 'inspector', ownerId: state.detailView.eventId, root: inspector });
    }
  }
  return owners;
}

function bindSearchTarget(searchKey, owner, occurrence, mark, targetsById) {
  const id = searchTargetId(searchKey, owner.surface, owner.ownerId, occurrence);
  let target = targetsById.get(id);
  if (!target) {
    target = {
      id,
      searchKey,
      surface: owner.surface,
      ownerId: owner.ownerId,
      occurrence,
      node: null,
    };
    state.searchTargetRegistry.targets.push(target);
    targetsById.set(id, target);
  }
  target.node = mark;
  mark.dataset.searchTargetId = id;
  mark.dataset.searchTargetSurface = owner.surface;
  mark.dataset.searchTargetOwner = owner.ownerId;
  mark.dataset.searchTargetOccurrence = String(occurrence);
  return target;
}

function resetSearchTransientExpansions() {
  const hadExpansions = state.searchTransientExpansion.eventIds.length > 0;
  state.searchTransientExpansion = { key: '', eventIds: [] };
  return hadExpansions;
}

function currentSearchTransientExpansionIds() {
  const key = searchTargetPreloadKey();
  const search = currentSearchState();
  if (!search.q || state.searchTransientExpansion.key !== key) return [];
  return state.searchTransientExpansion.eventIds;
}

function reconcileSearchTransientExpansions() {
  const search = currentSearchState();
  const key = searchTargetPreloadKey();
  if (!search.q || (state.searchTransientExpansion.key && state.searchTransientExpansion.key !== key)) {
    return resetSearchTransientExpansions();
  }
  return false;
}

function addSearchTransientExpansion(eventId) {
  const search = currentSearchState();
  if (!search.q || !eventId) return;
  const key = searchTargetPreloadKey();
  if (state.searchTransientExpansion.key !== key) {
    state.searchTransientExpansion = { key, eventIds: [] };
  }
  if (!state.searchTransientExpansion.eventIds.includes(eventId)) {
    state.searchTransientExpansion.eventIds.push(eventId);
  }
}

function clearSearchTransientExpansion(eventId) {
  if (!eventId || !state.searchTransientExpansion.eventIds.length) return;
  state.searchTransientExpansion.eventIds = state.searchTransientExpansion.eventIds.filter((id) => id !== eventId);
  if (!state.searchTransientExpansion.eventIds.length) state.searchTransientExpansion.key = '';
}

function structuredSearchKey() {
  const search = currentSearchState();
  return `${search.scope}\u001e${searchQuery.structuredSearchKey(
    { kind: search.kind, status: search.status, file: search.file },
    state.layerId || '',
    search.scope === 'project' ? state.projectSearchSort : (el.sortSelect?.value || ''),
  )}`;
}

function currentSearchMarkLabel() {
  const { targets } = state.searchTargetRegistry;
  const count = searchHighlighter.searchCountModel(state.timelineSearchMatchCount, targets.length, searchTargetIndex());
  if (!count.hasAnyMatch) return t('noMatches');
  return t('matchCount', count);
}

function syncSearchInlineLayout() {
  if (!el.searchField) return;
  const controls = el.searchField.querySelector('.searchInlineMatches');
  if (!controls || controls.hidden) {
    el.searchField.classList.remove('searchInlineStacked');
    el.searchField.style.removeProperty('--search-inline-reserve');
    return;
  }
  el.searchField.classList.remove('searchInlineStacked');
  const reserve = Math.ceil(controls.scrollWidth + 12);
  el.searchField.style.setProperty('--search-inline-reserve', `${reserve}px`);
  el.searchField.classList.toggle('searchInlineStacked', el.searchInput.clientWidth - reserve < 120);
}

function updateSearchMatchControls() {
  const controls = document.querySelectorAll('[data-search-match-controls]');
  syncSearchTargetRegistryKey();
  const { targets } = state.searchTargetRegistry;
  const visible = state.searchScope === 'session' && Boolean(currentSearchState().q);
  const canNavigate = searchDiscoveryContextReady()
    && (targets.length > 0 || state.timelineSearchMatchCount > 0);
  controls.forEach((control) => {
    control.hidden = !visible;
    control.toggleAttribute('data-search-navigation-pending', state.searchNavigation.running);
    const label = control.querySelector('[data-search-match-count]');
    if (label) label.textContent = currentSearchMarkLabel();
    control.querySelectorAll('[data-search-match-nav]').forEach((button) => {
      button.disabled = !canNavigate;
    });
  });
  requestAnimationFrame(syncSearchInlineLayout);
}

function maybePreloadSearchTargets() {
  const search = currentSearchState();
  if (search.scope !== 'session' || !search.q || !state.selectedSessionId) return;
  if (!searchDiscoveryContextReady()) return;
  if (state.searchTargetRegistry.targets.length >= SEARCH_TARGET_PRELOAD_MIN) return;
  if (state.offset >= state.timelineTotal) return;
  if (state.timelineLoading || state.searchTargetPreload.pending || state.searchNavigation.running) return;

  const key = searchTargetPreloadKey();
  if (state.searchTargetPreload.key !== key) {
    state.searchTargetPreload = { key, pages: 0, pending: false };
  }
  if (state.searchTargetPreload.pages >= SEARCH_TARGET_PRELOAD_MAX_PAGES) return;

  state.searchTargetPreload.pages += 1;
  state.searchTargetPreload.pending = true;
  loadTimeline(true)
    .catch(showError)
    .finally(() => {
      state.searchTargetPreload.pending = false;
      if (state.searchTargetRegistry.targets.length < SEARCH_TARGET_PRELOAD_MIN) {
        maybePreloadSearchTargets();
      }
    });
}

function liveSearchTargetNode(target) {
  return target?.node?.isConnected && target.node.dataset.searchTargetId === target.id ? target.node : null;
}

function endProgrammaticSearchScrollGuard() {
  if (state.searchProgrammaticScroll.timer) clearTimeout(state.searchProgrammaticScroll.timer);
  state.searchProgrammaticScroll.active = false;
  state.searchProgrammaticScroll.timer = 0;
}

function scheduleProgrammaticSearchScrollGuard(timeout) {
  state.searchProgrammaticScroll.active = true;
  if (state.searchProgrammaticScroll.timer) clearTimeout(state.searchProgrammaticScroll.timer);
  state.searchProgrammaticScroll.timer = setTimeout(() => {
    endProgrammaticSearchScrollGuard();
  }, timeout);
}

function beginProgrammaticSearchScroll() {
  scheduleProgrammaticSearchScrollGuard(1500);
}

function keepProgrammaticSearchScrollGuard() {
  if (!state.searchProgrammaticScroll.active) return;
  scheduleProgrammaticSearchScrollGuard(250);
}

function setActiveSearchTarget(target, options = {}) {
  state.searchHighlight.marks.forEach((mark) => mark.classList.remove('activeSearchMark'));
  if (!target) {
    state.searchTargetRegistry.activeTargetId = '';
    updateSearchMatchControls();
    return false;
  }

  state.searchTargetRegistry.activeTargetId = target.id;
  let mark = liveSearchTargetNode(target);
  if (mark) mark.classList.add('activeSearchMark');

  if (target.surface === 'timeline' && (options.scroll || options.syncDetail)) {
    const confirmedEventDetail = isSelectedEventDetailView()
      && state.detailView.origin === DETAIL_VIEW_ORIGIN_USER;
    if (!(options.passive && confirmedEventDetail)) {
      state.selectedEventId = target.ownerId;
      updateSelectedTimelineEvent();
      if (options.syncDetail) {
        const item = state.currentEvents.find((event) => event.id === target.ownerId);
        const confirmedCurrentEvent = confirmedEventDetail && state.detailView.eventId === item?.id;
        if (item && !confirmedCurrentEvent) {
          showInspector(item, { replace: true, origin: DETAIL_VIEW_ORIGIN_SEARCH });
          mark = liveSearchTargetNode(target);
        }
      }
    }
  }

  if (options.scroll && mark) {
    beginProgrammaticSearchScroll();
    searchHighlighter.reveal(mark);
  }
  updateSearchMatchControls();
  return Boolean(mark);
}

function refreshSearchHighlights(options = {}) {
  const roots = highlightRoots();
  const searchKey = syncSearchTargetRegistryKey();
  const previousActiveTargetId = state.searchTargetRegistry.activeTargetId;
  for (const target of state.searchTargetRegistry.targets) target.node = null;
  roots.forEach((root) => searchHighlighter.clear(root));

  const query = currentSearchState().q;
  const terms = highlightTerms();
  const marks = [];
  if (terms.length) {
    const targetsById = new Map(state.searchTargetRegistry.targets.map((target) => [target.id, target]));
    for (const owner of searchableHighlightOwners()) {
      const ownerMarks = searchHighlighter.apply(owner.root, terms);
      ownerMarks.forEach((mark, occurrence) => bindSearchTarget(searchKey, owner, occurrence, mark, targetsById));
      marks.push(...ownerMarks);
    }
  }
  state.searchHighlight = { query, marks };

  if (!query) resetSearchTargetRegistry(searchKey);
  const activeTargetStillKnown = options.preserveActive
    && state.searchTargetRegistry.targets.some((target) => target.id === previousActiveTargetId);
  if (!activeTargetStillKnown) {
    state.searchTargetRegistry.activeTargetId = state.searchTargetRegistry.targets[0]?.id || '';
  }

  const target = activeSearchTarget();
  if (target) {
    setActiveSearchTarget(target, {
      scroll: false,
      syncDetail: options.syncDetail,
      passive: options.passive,
    });
  } else {
    updateSearchMatchControls();
  }
  convergeSelectedEventDetailView();
  if (options.allowPreload !== false) maybePreloadSearchTargets();
}

function persistedDisplayOverride(eventId) {
  const sessionOverrides = state.overrides[state.selectedSessionId] || {};
  return sessionOverrides[eventId] || '';
}

function knownTimelineSearchEventIds() {
  return new Set(state.searchTargetRegistry.targets
    .filter((target) => target.surface === 'timeline')
    .map((target) => target.ownerId));
}

function waitForTimelineIdle() {
  if (!state.timelineLoading) return Promise.resolve();
  return new Promise((resolve) => {
    const poll = () => {
      if (!state.timelineLoading) resolve();
      else setTimeout(poll, 25);
    };
    poll();
  });
}

function timelineSearchTargets(eventId) {
  return state.searchTargetRegistry.targets.filter((target) => (
    target.surface === 'timeline' && target.ownerId === eventId
  ));
}

async function materializeSearchEvent(event, direction, options = {}) {
  await ensureEventLoaded(event.id, { allowSearchTargetPreload: false });
  if (options.searchKey && searchTargetPreloadKey() !== options.searchKey) return false;
  const loaded = state.currentEvents.find((candidate) => candidate.id === event.id) || event;
  let targets = timelineSearchTargets(loaded.id);
  if (targets.length) return direction < 0 ? targets[targets.length - 1] : targets[0];

  const override = persistedDisplayOverride(loaded.id);
  if (override && override !== 'expanded') return false;
  if (!override && displayState(loaded) !== 'expanded') {
    addSearchTransientExpansion(loaded.id);
    renderTimeline();
  }

  await loadEventDetail(loaded);
  if (options.searchKey && searchTargetPreloadKey() !== options.searchKey) return false;
  renderTimeline();
  refreshSearchHighlights({ preserveActive: true, allowPreload: false });
  targets = timelineSearchTargets(loaded.id);
  return (direction < 0 ? targets[targets.length - 1] : targets[0]) || false;
}

async function resolveSearchTargetNode(target, searchKey) {
  let node = liveSearchTargetNode(target);
  if (node || !target || searchTargetPreloadKey() !== searchKey) return node;

  if (target.surface === 'session') {
    refreshSearchHighlights({ preserveActive: true, allowPreload: false });
    return liveSearchTargetNode(target);
  }

  await ensureEventLoaded(target.ownerId, { allowSearchTargetPreload: false });
  if (searchTargetPreloadKey() !== searchKey) return null;
  node = liveSearchTargetNode(target);

  const event = state.currentEvents.find((candidate) => candidate.id === target.ownerId);
  if (!event) return null;
  if (target.surface === 'inspector') {
    await loadEventDetail(event);
    if (searchTargetPreloadKey() !== searchKey) return null;
    showInspector(event, { replace: true, origin: DETAIL_VIEW_ORIGIN_SEARCH });
    return liveSearchTargetNode(target);
  }

  if (!node) {
    const override = persistedDisplayOverride(event.id);
    if (!override && displayState(event) !== 'expanded') addSearchTransientExpansion(event.id);
    await loadEventDetail(event);
    if (searchTargetPreloadKey() !== searchKey) return null;
    renderTimeline();
    refreshSearchHighlights({ preserveActive: true, allowPreload: false });
  }
  return liveSearchTargetNode(target);
}

async function activateSearchTarget(target, options = {}) {
  if (!target) return false;
  const searchKey = state.searchTargetRegistry.key;
  const previousActiveTargetId = state.searchTargetRegistry.activeTargetId;
  state.searchTargetRegistry.activeTargetId = target.id;
  const node = await resolveSearchTargetNode(target, searchKey);
  if (searchTargetPreloadKey() !== searchKey) return false;
  if (!node) {
    state.searchTargetRegistry.activeTargetId = previousActiveTargetId;
    setActiveSearchTarget(activeSearchTarget());
    return false;
  }
  return setActiveSearchTarget(target, options);
}

async function activateSearchTargetCandidates(candidates, options, attempted, searchKey) {
  for (const target of candidates) {
    if (!target || attempted.has(target.id)) continue;
    attempted.add(target.id);
    if (await activateSearchTarget(target, options)) return true;
    if (searchTargetPreloadKey() !== searchKey) return false;
  }
  return false;
}

async function materializeNextSearchTarget(direction) {
  const search = currentSearchState();
  if (!search.q || !state.timelineSearchMatchCount || !searchDiscoveryContextReady()) return false;
  const searchKey = searchTargetPreloadKey();
  const currentTarget = activeSearchTarget();
  const activeEventId = ['timeline', 'inspector'].includes(currentTarget?.surface) ? currentTarget.ownerId : '';
  const activeEventIndex = state.currentEvents.findIndex((event) => event.id === activeEventId);
  const initiallyKnownTargetIds = new Set(state.searchTargetRegistry.targets.map((target) => target.id));
  const attempted = new Set();

  const tryEvents = async (events) => {
    for (const event of events) {
      if (!event.hasSearchHit || attempted.has(event.id)) continue;
      attempted.add(event.id);
      const newlyDiscovered = timelineSearchTargets(event.id)
        .filter((target) => !initiallyKnownTargetIds.has(target.id));
      if (newlyDiscovered.length) {
        return direction < 0 ? newlyDiscovered[newlyDiscovered.length - 1] : newlyDiscovered[0];
      }
      if (knownTimelineSearchEventIds().has(event.id)) continue;
      const target = await materializeSearchEvent(event, direction, { searchKey });
      if (target) return target;
      if (searchTargetPreloadKey() !== searchKey) return false;
    }
    return false;
  };

  const appendNextPage = async () => {
    const previousOffset = state.offset;
    await waitForTimelineIdle();
    if (searchTargetPreloadKey() !== searchKey) return false;
    if (state.offset > previousOffset) return true;
    if (state.offset >= state.timelineTotal) return false;
    await loadTimeline(true, { allowSearchTargetPreload: false });
    await waitForTimelineIdle();
    if (searchTargetPreloadKey() !== searchKey) return false;
    return state.offset > previousOffset;
  };

  if (direction >= 0) {
    let scanOffset = activeEventIndex >= 0 ? activeEventIndex + 1 : 0;
    while (true) {
      const loadedEnd = state.currentEvents.length;
      const target = await tryEvents(state.currentEvents.slice(scanOffset, loadedEnd));
      if (target) return target;
      if (searchTargetPreloadKey() !== searchKey || state.offset >= state.timelineTotal) break;
      scanOffset = loadedEnd;
      if (!await appendNextPage()) break;
    }
    if (activeEventIndex >= 0) {
      return tryEvents(state.currentEvents.slice(0, activeEventIndex));
    }
    return false;
  }

  if (activeEventIndex >= 0) {
    const target = await tryEvents(state.currentEvents.slice(0, activeEventIndex).reverse());
    if (target) return target;
    if (searchTargetPreloadKey() !== searchKey) return false;
  }

  while (state.offset < state.timelineTotal) {
    if (!await appendNextPage()) break;
  }
  if (searchTargetPreloadKey() !== searchKey) return false;
  const wrapStart = activeEventIndex >= 0 ? activeEventIndex + 1 : 0;
  return tryEvents(state.currentEvents.slice(wrapStart).reverse());
}

async function navigateSearchMatch(direction) {
  const searchKey = syncSearchTargetRegistryKey();
  await waitForTimelineIdle();
  if (searchTargetPreloadKey() !== searchKey) return false;
  if (!searchDiscoveryContextReady()) return false;
  reconcileSearchTransientExpansions();
  if (!state.searchTargetRegistry.targets.length) {
    refreshSearchHighlights({ preserveActive: true, syncDetail: true });
  }
  const targets = state.searchTargetRegistry.targets;
  if (!targets.length) {
    const materialized = await materializeNextSearchTarget(direction);
    return activateSearchTarget(materialized, { scroll: true, syncDetail: true });
  }

  const options = { scroll: true, syncDetail: true };
  const attempted = new Set();
  const activeTargetId = state.searchTargetRegistry.activeTargetId;
  const current = searchTargetIndex();
  const beforeBoundary = current < 0
    ? (direction < 0 ? [...targets].reverse() : [...targets])
    : direction < 0
      ? targets.slice(0, current).reverse()
      : targets.slice(current + 1);
  if (await activateSearchTargetCandidates(beforeBoundary, options, attempted, searchKey)) return true;
  if (searchTargetPreloadKey() !== searchKey) return false;

  const knownBeforeMaterialization = new Set(
    state.searchTargetRegistry.targets.map((target) => target.id),
  );
  const materialized = await materializeNextSearchTarget(direction);
  if (materialized && await activateSearchTargetCandidates(
    [materialized], options, attempted, searchKey,
  )) return true;
  if (searchTargetPreloadKey() !== searchKey) return false;

  const newlyRegistered = state.searchTargetRegistry.targets.filter(
    (target) => !knownBeforeMaterialization.has(target.id),
  );
  if (await activateSearchTargetCandidates(
    direction < 0 ? newlyRegistered.reverse() : newlyRegistered,
    options,
    attempted,
    searchKey,
  )) return true;
  if (searchTargetPreloadKey() !== searchKey) return false;

  const updatedTargets = state.searchTargetRegistry.targets;
  const updatedCurrent = updatedTargets.findIndex((target) => target.id === activeTargetId);
  const wrapped = updatedCurrent < 0
    ? (direction < 0 ? [...updatedTargets].reverse() : [...updatedTargets])
    : direction < 0
      ? updatedTargets.slice(updatedCurrent).reverse()
      : updatedTargets.slice(0, updatedCurrent + 1);
  return activateSearchTargetCandidates(wrapped, options, attempted, searchKey);
}

function clearQueuedSearchNavigations() {
  const queued = state.searchNavigation.queue.splice(0);
  queued.forEach(({ resolve }) => resolve(false));
}

async function drainSearchNavigationQueue() {
  if (state.searchNavigation.running) return;
  state.searchNavigation.running = true;
  updateSearchMatchControls();
  try {
    while (state.searchNavigation.queue.length) {
      const item = state.searchNavigation.queue.shift();
      try {
        item.resolve(await navigateSearchMatch(item.direction));
      } catch (error) {
        item.reject(error);
      }
    }
  } finally {
    state.searchNavigation.running = false;
    updateSearchMatchControls();
    maybePreloadSearchTargets();
  }
}

function queueSearchNavigation(direction) {
  const normalizedDirection = direction < 0 ? -1 : 1;
  const pending = new Promise((resolve, reject) => {
    state.searchNavigation.queue.push({ direction: normalizedDirection, resolve, reject });
  });
  drainSearchNavigationQueue();
  return pending;
}

function scheduleSearchHighlightRefresh(options = {}) {
  if (state.searchHighlightTimer) clearTimeout(state.searchHighlightTimer);
  const scheduledKey = searchTargetKey();
  state.searchHighlightTimer = setTimeout(() => {
    state.searchHighlightTimer = 0;
    if (scheduledKey !== searchTargetKey()) return;
    refreshSearchHighlights(options);
    renderResultSummary();
  }, SEARCH_HIGHLIGHT_INPUT_DELAY_MS);
}

function currentQuery(extra = {}, options = {}) {
  const params = new URLSearchParams();
  const filters = currentSearchState();
  if (options.includeExpression !== false) {
    if (options.includeQ !== false && filters.q) params.set('q', filters.q);
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.status) params.set('status', filters.status);
    if (filters.file) params.set('file', filters.file);
  }
  if (options.includeLayer !== false && filters.layer) params.set('layer', filters.layer);
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
  state.navigationCategoryManualId = '';
  state.detailHistory = [];
  state.searchTargetPreload = { key: '', pages: 0, pending: false };
  state.detailView = { type: 'profileRules' };
  renderProfileRulesPane({ reveal: false });
  updateSelectedTimelineEvent();
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile || {}));
}

function defaultRules() {
  return { kindStates: {}, fallback: 'summary', conditions: [] };
}

function normalizeProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
    ...profile,
    rules: normalizeRules(profile.rules || defaultRules()),
  }));
}

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.profileId)
    || state.profiles.find((profile) => profile.id === 'narrative')
    || state.profiles[0]
    || i18n.localizeProfile({ id: 'narrative', name: 'narrative', description: '', rules: defaultRules() }, state.locale);
}

function renderProfileOptions() {
  return state.profiles.map((profile) => (
    `<option value="${escapeHtml(profile.id)}" title="${escapeHtml(profile.description || '')}">${escapeHtml(profile.name || profile.id)}</option>`
  )).join('');
}

function renderProfileInfoItems() {
  const rows = state.profiles.map((profile) => {
    const active = profile.id === state.profileId ? ' active' : '';
    const description = profile.description || t('profileInfoMissingDescription');
    return `<div class="profileInfoItem${active}">
      <strong>${escapeHtml(profile.name || profile.id)}</strong>
      <p>${escapeHtml(description)}</p>
    </div>`;
  }).join('');
  return rows || `<div class="profileInfoItem"><p>${escapeHtml(t('profileInfoEmpty'))}</p></div>`;
}

function profileInfoLabel() {
  const profile = activeProfile();
  const description = profile.description || t('profileInfoMissingDescription');
  return t('profileInfoLabel', { name: profile.name || profile.id, description });
}

function ensureProfileInfoSlot() {
  if (profileInfoSlot) return profileInfoSlot;
  profileInfoSlot = document.createElement('span');
  profileInfoSlot.className = 'profileInfoSlot';
  profileInfoSlot.innerHTML = '<button class="profileInfoBtn" type="button">ⓘ</button><div id="profileInfoPopover" class="profileInfoPopover" role="tooltip"></div>';
  return profileInfoSlot;
}

function elementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && element.getClientRects().length > 0;
}

function visibleProfilePickerHost(host) {
  if (!host || !elementVisible(host)) return null;
  const select = host.querySelector('select');
  return elementVisible(select) ? host : null;
}

// Keep exactly one strategy info control and move it to the visible profile picker.
function syncProfileInfoSlot(analyzerDisabled = false) {
  const detailHost = el.detail?.querySelector('[data-profile-picker-host="detail"]');
  const topbarHost = el.profileSelect?.closest('[data-profile-picker-host="topbar"]');
  const host = !analyzerDisabled && profileAppliesToActiveLayer() && isBuiltinProfile(state.profileId) && !profileDirty()
    ? visibleProfilePickerHost(detailHost) || visibleProfilePickerHost(topbarHost)
    : null;
  const slot = ensureProfileInfoSlot();
  const previousHost = slot.closest('[data-profile-picker-host]');
  if (previousHost && previousHost !== host) previousHost.classList.remove('hasProfileInfo');
  if (!host) {
    if (previousHost) previousHost.classList.remove('hasProfileInfo');
    slot.remove();
    return;
  }
  host.appendChild(slot);
  host.classList.add('hasProfileInfo');
  const button = slot.querySelector('.profileInfoBtn');
  const popover = slot.querySelector('.profileInfoPopover');
  button.disabled = false;
  button.setAttribute('aria-label', profileInfoLabel());
  button.setAttribute('aria-describedby', popover.id);
  popover.innerHTML = renderProfileInfoItems();
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

function hasOwnRuleForKind(profile, kind) {
  return Boolean(profile?.rules?.kindStates && Object.hasOwn(profile.rules.kindStates, kind));
}

function profileRuleForKind(profile, kind) {
  return hasOwnRuleForKind(profile, kind) ? profile.rules.kindStates[kind] : '';
}

function baseProfileFor(profile) {
  if (!profile?.baseProfileId) return null;
  return state.builtinProfiles.find((candidate) => candidate.id === profile.baseProfileId) || null;
}

function dynamicKindMatchesAnyBuiltin(kind, display) {
  return state.builtinProfiles.some((profile) => profileRuleForKind(profile, kind) === display);
}

function addProfileKindDifferences(kinds, profile, baseProfile = null) {
  if (!profile?.rules?.kindStates) return;
  const base = baseProfile || baseProfileFor(profile);
  for (const kind of Object.keys(profile.rules.kindStates)) {
    if (!foldingApi.isDynamicEditableKind(kind)) {
      kinds.add(kind);
      continue;
    }
    const display = profileRuleForKind(profile, kind);
    if (base ? display !== profileRuleForKind(base, kind) : !dynamicKindMatchesAnyBuiltin(kind, display)) {
      kinds.add(kind);
    }
  }
  if (!base?.rules?.kindStates) return;
  for (const kind of Object.keys(base.rules.kindStates)) {
    if (foldingApi.isDynamicEditableKind(kind) && profileRuleForKind(profile, kind) !== profileRuleForKind(base, kind)) {
      kinds.add(kind);
    }
  }
}

function knownEventKinds() {
  const kinds = new Set(EDITABLE_EVENT_KINDS);
  for (const profile of state.customProfiles) addProfileKindDifferences(kinds, profile);
  if (state.profileDraft) addProfileKindDifferences(kinds, state.profileDraft, activeProfile());
  for (const item of state.sessionEventKinds?.main || []) {
    const kind = String(item?.value || '').trim();
    if (kind) kinds.add(kind);
  }
  for (const event of state.currentEvents) {
    if (event.kind) kinds.add(event.kind);
  }
  return [...kinds].sort(compareEditableKinds);
}

function compareEditableKinds(left, right) {
  const leftGroup = foldingApi.editableKindGroup(left);
  const rightGroup = foldingApi.editableKindGroup(right);
  return leftGroup.groupPriority - rightGroup.groupPriority
    || leftGroup.kindPriority - rightGroup.kindPriority
    || kindLabel(left).localeCompare(kindLabel(right))
    || left.localeCompare(right);
}

function groupedEditableKinds(kinds) {
  const byGroup = new Map(EDITABLE_KIND_GROUPS.map((group) => [group.id, { group, kinds: [] }]));
  for (const kind of kinds) {
    const groupId = foldingApi.editableKindGroup(kind).groupId;
    const entry = byGroup.get(groupId) || byGroup.get('other');
    entry.kinds.push(kind);
  }
  return EDITABLE_KIND_GROUPS
    .map((group) => byGroup.get(group.id))
    .filter((entry) => entry && entry.kinds.length)
    .map((entry) => ({
      ...entry,
      kinds: [...entry.kinds].sort(compareEditableKinds),
    }));
}

function conditionDefinitions() {
  return CONDITION_DEFINITIONS.map((condition) => i18n.localizeCondition(condition, state.locale));
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
  if (session.isDerivedSession) {
    const parent = shortId(session.parentSessionId);
    const kind = session.derivedKind === 'review' ? t('reviewKind') : t('subagentKind');
    const nickname = session.agentNickname && session.agentNickname.toLowerCase() !== kind.toLowerCase() ? ` ${session.agentNickname}` : '';
    const parentLabel = shortSessionTitle(session.parentSessionTitle) || parent;
    if (parentLabel) return t('derivedFrom', { kind, nickname, parent: parentLabel });
    return t('derivedSession', { kind, nickname });
  }
  const forkedFrom = shortId(session.forkedFromSessionId);
  const forkedFromLabel = shortSessionTitle(session.forkedFromSessionTitle) || forkedFrom;
  if (forkedFromLabel) return t('forkFrom', { parent: forkedFromLabel });
  return '';
}

function sessionRelationshipTitle(session, fallback = '') {
  if (session.isDerivedSession) return session.parentSessionTitle || session.parentSessionId || fallback;
  return session.forkedFromSessionTitle || session.forkedFromSessionId || fallback;
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
  return foldingApi.isUpdatePlanEvent(event);
}

function metadataRow(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderInspectorMetadata(event, refs, detail = null) {
  const meta = detail?.meta || event;
  const outputStats = meta.outputStats || event.outputStats || {};
  return [
    metadataRow(t('time'), fmtDate(meta.timestamp || event.timestamp)),
    metadataRow(t('status'), meta.status || event.status),
    metadataRow(t('severity'), meta.severity && meta.severity !== 'normal' ? meta.severity : ''),
    metadataRow(t('tool'), meta.toolName || event.toolName),
    metadataRow(t('exitCode'), outputStats.exitCode == null ? '' : String(outputStats.exitCode)),
    metadataRow(t('duration'), outputStats.durationMs == null ? '' : `${outputStats.durationMs} ms`),
    metadataRow(t('recordType'), event.recordType),
    metadataRow(t('channels'), formatList(meta.channels || event.channels)),
    metadataRow(t('touchedFiles'), formatList(meta.touchedFiles || event.touchedFiles)),
  ].join('');
}

function renderInspectorSource(event, refs, detail = null) {
  const meta = detail?.meta || event;
  const source = sourceLabel(meta.source || event.source || refs[0]);
  return `<section class="inspectorSection">
    <h3>${escapeHtml(t('source'))}</h3>
    ${source ? `<div class="inspectorSourcePath">${escapeHtml(source)}</div>` : ''}
    <div class="inspectorActions">
      <button class="smallBtn" type="button" data-detail-action="raw">${escapeHtml(t('rawRefs'))}</button>
      <span class="rawMeta">${escapeHtml(refs.length ? t('rawRows', { count: refs.length, plural: refs.length === 1 ? '' : 's' }) : t('noRawRefs'))}</span>
    </div>
  </section>`;
}

function renderInspectorDetail(event) {
  const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
  const detail = state.detailCache[key];
  const error = state.detailErrors[key];
  if (detail) {
    if (!detail.inspectorSections?.length) return '';
    return `<section class="inspectorSection">
      <h3>${escapeHtml(t('details'))}</h3>
      <div class="inspectorDetailBody">${renderSections(detail.inspectorSections)}</div>
    </section>`;
  }
  if (error) {
    return `<section class="inspectorSection">
      <h3>${escapeHtml(t('details'))}</h3>
      <div class="notice error"><p>${escapeHtml(error)}</p></div>
      <button class="smallBtn" type="button" data-detail-action="retry-detail">${escapeHtml(t('retryDetail'))}</button>
    </section>`;
  }
  return `<section class="inspectorSection">
    <h3>${escapeHtml(t('details'))}</h3>
    <div class="notice info"><p>${escapeHtml(t('loadingStructuredDetail'))}</p></div>
  </section>`;
}

function shouldShowInspectorSummary(event, preview, detail = null) {
  const source = String(preview || '').trim();
  if (!source) return false;
  if (source === String(event.label || '').trim()) return false;
  if (event.layer === 'raw') return true;
  const bodyOwnedKinds = new Set([
    'user_message',
    'assistant_message',
    'proposed_plan',
    'plan_update',
    'reasoning',
    'command',
    'patch',
    'js_repl',
  ]);
  if (bodyOwnedKinds.has(event.kind)) return false;
  if (detail?.timelineSections?.some((section) => ['markdown', 'code', 'terminal', 'patch', 'diff', 'user_input', 'plan_update', 'collaboration'].includes(section.type))) return false;
  return true;
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
  if (search.kind) filters.push({ key: 'kind', label: `${t('kind')}: ${optionText(el.searchKindSelect, search.kind) || kindLabel(search.kind)}` });
  if (search.status) filters.push({ key: 'status', label: `${t('status')}: ${optionText(el.searchStatusSelect, search.status, STATUS_LABELS)}` });
  if (search.file) filters.push({ key: 'file', label: `${t('file')}: ${search.file}` });
  return filters;
}

function activeFindAndFilters() {
  const search = currentSearchState();
  return [
    search.q ? { key: 'q', label: `${t('find')}: ${search.q}` } : null,
    ...activeFilters(),
  ].filter(Boolean);
}

function activeSearchChips() {
  return [
    { key: 'layer', label: `${t('layer')}: ${activeLayerLabel()}`, removable: false },
    ...activeFindAndFilters(),
  ];
}

function filterChipMarkup(filter) {
  if (filter.removable === false) {
    return `<span class="filterChip contextChip" data-search-context="${escapeHtml(filter.key)}"><span>${escapeHtml(filter.label)}</span></span>`;
  }
  return `<button class="filterChip" type="button" data-clear-filter="${escapeHtml(filter.key)}" aria-label="${escapeHtml(t('clear', { label: filter.label }))}">
      <span>${escapeHtml(filter.label)}</span><span aria-hidden="true">&times;</span>
    </button>`;
}

function renderFilterChips(filters) {
  return filters.map(filterChipMarkup).join('');
}

function hasFocusedTimelineContext() {
  const search = currentSearchState();
  return Boolean(search.kind || search.status || search.file || activeLayerId() !== 'main');
}

function renderReadFromHereAction() {
  if (!state.selectedSessionId || !state.selectedEventId || !hasFocusedTimelineContext()) return '';
  return `<button class="smallBtn readFromHereBtn" type="button" data-detail-action="read-from-here" title="${escapeHtml(t('readFromHereTitle'))}">${escapeHtml(t('readFromHere'))}</button>`;
}

function renderSearchActionRegion() {
  const region = el.searchActionRegion || el.searchAssistChips;
  if (!region) return;
  const expression = activeFindAndFilters();
  const clear = expression.length
    ? `<button class="clearFiltersBtn" type="button" data-clear-filter="all">${escapeHtml(t('clearAll'))}</button>`
    : '';
  region.innerHTML = `${renderFilterChips(activeSearchChips())}${clear}`;
}

function renderBackToProjectResultsAction() {
  if (!state.projectReturnContext || state.searchScope !== 'session') return '';
  return `<button class="smallBtn" type="button" data-detail-action="back-to-project-results">${escapeHtml(t('backToProjectResults'))}</button>`;
}

function renderSearchAssistChips() {
  renderSearchActionRegion();
}

function renderSearchValidation() {
  if (!el.searchValidation) return;
  if (!state.searchValidation.length) {
    el.searchValidation.hidden = true;
    el.searchValidation.textContent = '';
    el.searchInput.removeAttribute('aria-invalid');
    return;
  }
  const messages = state.searchValidation.map((item) => (
    item.error === 'missing-value'
      ? t('searchOperatorMissingValue', { operator: item.operator })
      : t('searchOperatorInvalidValue', { operator: item.operator, value: item.value })
  ));
  el.searchValidation.textContent = messages.join(' ');
  el.searchValidation.hidden = false;
  el.searchInput.setAttribute('aria-invalid', 'true');
}

function setSelectIfOption(select, value) {
  if (!select) return;
  const hasOption = [...select.options].some((option) => option.value === value);
  select.value = hasOption ? value : '';
}

function normalizedKindOptions(layerId = activeLayerId()) {
  const seen = new Set();
  const options = [];
  const source = state.searchScope === 'session' && state.selectedSessionId
    ? state.sessionEventKinds
    : state.eventKinds;
  for (const item of source?.[layerId] || []) {
    const value = String(item?.value || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: item.label || kindLabel(value),
      count: Number(item.count || 0),
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

function renderKindOptions() {
  if (!el.searchKindSelect) return;
  const search = currentSearchState();
  const options = normalizedKindOptions(search.layer);
  const values = new Set(options.map((option) => option.value));
  const rows = [`<option value="">${escapeHtml(t('anyKind'))}</option>`];
  if (search.kind && !values.has(search.kind)) {
    rows.push(`<option value="${escapeHtml(search.kind)}">${escapeHtml(`${kindLabel(search.kind)} (${search.kind})`)}</option>`);
  }
  rows.push(...options.map((option) => {
    const label = option.count ? `${option.label} (${option.count})` : option.label;
    return `<option value="${escapeHtml(option.value)}">${escapeHtml(label)}</option>`;
  }));
  el.searchKindSelect.innerHTML = rows.join('');
  el.searchKindSelect.value = search.kind;
}

function syncSearchAssistControls() {
  const search = currentSearchState();
  renderKindOptions();
  setSelectIfOption(el.searchKindSelect, search.kind);
  setSelectIfOption(el.searchStatusSelect, search.status);
  setSelectIfOption(el.searchLayerSelect, search.layer);
  if (el.searchFileInput) el.searchFileInput.value = search.file;
  renderSearchValidation();
}

function showSearchAssist() {
  if (!el.searchAssist) return;
  el.searchAssist.hidden = false;
  if (el.resultSummary) el.resultSummary.hidden = true;
  el.searchInput.setAttribute('aria-expanded', 'true');
  syncSearchAssistControls();
  renderSearchAssistChips();
}

function hideSearchAssist() {
  if (!el.searchAssist) return;
  el.searchAssist.hidden = true;
  if (el.resultSummary) el.resultSummary.hidden = false;
  el.searchInput.setAttribute('aria-expanded', 'false');
}

function focusSearchEnd() {
  el.searchInput.focus();
  const end = el.searchInput.value.length;
  el.searchInput.setSelectionRange(end, end);
}

function applySearchOperator(operator, value) {
  if (!operator) return;
  clearSearchValidationOperator(operator);
  if (operator === 'layer') {
    if (value && value !== state.layerId) changeLayer(value).catch(showError);
  } else if (Object.hasOwn(state.searchFilters, operator)) {
    state.searchFilters = { ...state.searchFilters, [operator]: value || '' };
    state.searchStructureKey = structuredSearchKey();
    beginSearchTargetContextTransition();
    refreshActiveSearch({ structural: true }).catch(showError);
  }
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  focusSearchEnd();
}

function normalizeFileSuggestionText(value) {
  return String(value || '').trim().replace(/\\/g, '/').toLowerCase();
}

function fileSuggestionContextKey() {
  return JSON.stringify([
    state.repoRoot,
    state.searchScope,
    activeLayerId(),
    state.searchScope === 'session' ? state.selectedSessionId : '',
    state.locale,
  ]);
}

async function refreshFileSuggestions() {
  const requestId = state.fileSuggestionRequestId + 1;
  const requestContext = fileSuggestionContextKey();
  state.fileSuggestionRequestId = requestId;
  const params = new URLSearchParams({ layer: activeLayerId() });
  if (state.searchScope === 'session' && state.selectedSessionId) {
    params.set('sessionId', state.selectedSessionId);
  }
  const data = await api(`/api/file-suggestions?${params.toString()}`);
  if (requestId !== state.fileSuggestionRequestId || requestContext !== fileSuggestionContextKey()) return false;
  state.fileSuggestions = data.files || [];
  renderFileSuggestions();
  return true;
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
      <span class="fileSuggestionHits">${escapeHtml(t('suggestionEventCount', { count: item.count }))}</span>
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
  const search = currentSearchState();
  renderSearchAssistChips();
  if (search.scope === 'project') {
    if (!hasActiveSearchExpression()) {
      el.resultSummary.replaceChildren();
      return;
    }
    const summary = t('projectResultSummary', {
      sessions: state.projectSearchTotal,
      events: state.projectSearchEventTotal,
    });
    el.resultSummary.innerHTML = `<div class="resultCounts">${escapeHtml(summary)}</div>`;
    updateSearchMatchControls();
    return;
  }
  if (!filters.length && !search.q) {
    if (state.projectReturnContext) {
      el.resultSummary.innerHTML = `<button class="smallBtn" type="button" data-search-back-to-project>${escapeHtml(t('backToProjectResults'))}</button>`;
    } else {
      el.resultSummary.replaceChildren();
    }
    return;
  }
  const eventText = filters.length && state.selectedSessionId
    ? (state.offset < state.timelineTotal ? t('eventsMatchLoaded', { count: state.timelineTotal, loaded: state.offset }) : t('eventsMatch', { count: state.timelineTotal }))
    : (filters.length ? t('eventsSelectSession') : '');
  const matchControls = search.q
    ? `<div class="searchMatchControls" data-search-match-controls title="${escapeHtml(t('searchMatchTitle'))}">
      <span class="searchMatchCount" data-search-match-count>${escapeHtml(currentSearchMarkLabel())}</span>
    </div>`
    : '';
  const committed = state.timelineDataContext === timelineDataContextKey();
  const matchingEventCount = search.q ? state.timelineSearchEventCount : state.timelineTotal;
  const projectFallback = committed && hasActiveSearchExpression() && matchingEventCount === 0
    ? `<button class="smallBtn projectFallbackBtn" type="button" data-search-project-fallback>${escapeHtml(t('searchEntireProject'))}</button>`
    : '';
  const backToProject = state.projectReturnContext
    ? `<button class="smallBtn" type="button" data-search-back-to-project>${escapeHtml(t('backToProjectResults'))}</button>`
    : '';
  el.resultSummary.innerHTML = `${eventText ? `<div class="resultCounts">${escapeHtml(eventText)}</div>` : ''}${matchControls}${projectFallback}${backToProject}`;
  updateSearchMatchControls();
}

function clearActiveFilter(key) {
  const structureBefore = structuredSearchKey();
  if (key === 'all') {
    state.searchQuery = '';
    state.searchFilters = { file: '', kind: '', status: '' };
    state.searchValidation = [];
  } else if (key === 'q') {
    state.searchQuery = '';
  } else if (Object.hasOwn(state.searchFilters, key)) {
    state.searchFilters = { ...state.searchFilters, [key]: '' };
  }
  syncSearchInputValue();
  renderSearchValidation();
  beginSearchTargetContextTransition();
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  if (reconcileSearchTransientExpansions()) renderTimeline();
  const structureAfter = structuredSearchKey();
  state.searchStructureKey = structureAfter;
  refreshActiveSearch({ structural: structureBefore !== structureAfter }).catch(showError);
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
  if (!state.selectedSessionId) return null;
  const target = await resolveFocusTarget(anchor);
  if (!target) {
    if (anchor?.hadSelection) closeDetailView();
    return null;
  }
  await ensureEventLoaded(target.id);
  const loaded = state.currentEvents.find((event) => event.id === target.id) || target;
  if (anchor?.detailType === 'rawRefs') await showRaw(loaded, { replace: true });
  else showInspector(loaded, { replace: true });
  scrollToTimelineEvent(loaded.id);
  return loaded;
}

function clearCurrentSessionOverrides() {
  if (!state.selectedSessionId || !state.overrides[state.selectedSessionId]) return;
  delete state.overrides[state.selectedSessionId];
  saveOverrides();
  updateResetFoldsButton();
}

function saveOverrides() {
  state.overrides = normalizeOverrides(state.overrides);
  writeJsonStorage(OVERRIDES_KEY, state.overrides);
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
    const label = applies
      ? t('foldingStrategy')
      : t('fixedProfileRules');
    el.profileSelect.removeAttribute('title');
    el.profileSelect.setAttribute('aria-label', label);
  }
  syncProfileInfoSlot(analyzerDisabled);
  controls?.toggleAttribute('data-profile-inactive', !applies);
}

function setAnalyzerDisabled(disabled) {
  for (const control of [el.searchInput, ...el.searchScopeButtons, el.layerSelect, el.sortSelect, el.resetFoldsBtn, el.loadMoreBtn]) {
    if (control) control.disabled = disabled;
  }
  updateProfileApplicabilityUi(disabled);
  if (!disabled) syncSearchScopeUi();
}

function setProjectMode(selecting) {
  state.selectingProject = selecting;
  state.projectSelected = !selecting;
  document.body.dataset.projectMode = selecting ? 'selecting' : 'analyzing';
  if (el.projectChooser) el.projectChooser.hidden = !selecting;
  setAnalyzerDisabled(selecting);
  updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
}

function resetProjectViewState() {
  state.sessions = [];
  state.projectResults = [];
  state.sessionsRequestId += 1;
  state.projectSearchRequestId += 1;
  state.projectSearchDataContext = '';
  state.projectSearchTotal = 0;
  state.projectSearchEventTotal = 0;
  state.projectSearchLoading = false;
  state.projectReturnContext = null;
  state.analysisRequestId += 1;
  state.selectedSessionId = '';
  state.selectedEventId = '';
  state.offset = 0;
  state.timelineLoading = false;
  state.timelineRequestId += 1;
  state.sessionsDataContext = '';
  state.timelineDataContext = '';
  state.sessionGrandTotal = 0;
  state.sessionTotal = 0;
  state.timelineTotal = 0;
  state.timelineSearchMatchCount = 0;
  state.timelineSearchEventCount = 0;
  state.currentEvents = [];
  state.searchSurfaceContexts = { sessions: '', timeline: '', detail: '' };
  state.searchTargetPreload = { key: '', pages: 0, pending: false };
  state.fileSuggestions = [];
  state.fileSuggestionRequestId += 1;
  state.eventKinds = { main: [], protocol: [], raw: [] };
  state.sessionEventKinds = { main: [], protocol: [], raw: [] };
  resetSessionDetailCache();
  invalidateNavigationCache();
  el.sessionList.innerHTML = '';
  el.analysisPanel.innerHTML = '';
  el.timeline.innerHTML = '';
  el.resultSummary.textContent = '';
  el.sessionHeader.innerHTML = `<h2>${escapeHtml(t('chooseSession'))}</h2><p>${escapeHtml(t('selectSessionFirst'))}</p>`;
  el.loadMoreBtn.disabled = true;
  el.loadMoreBtn.textContent = t('loadMore');
  updateResetFoldsButton();
  resetDetailPane();
}

function renderProjects() {
  if (!el.projectList) return;
  const loadingRoot = state.projectLoadingRoot;
  el.projectList.setAttribute('aria-busy', loadingRoot ? 'true' : 'false');
  if (el.projectChooser) el.projectChooser.dataset.loading = loadingRoot ? 'true' : 'false';
  if (!state.projects.length) {
    el.projectList.innerHTML = loadingRoot
      ? ''
      : `<div class="notice warning"><p>${escapeHtml(t('noCodexProjects'))}</p></div>`;
    return;
  }
  const saved = localStorage.getItem(REPO_STORAGE_KEY) || '';
  el.projectList.innerHTML = state.projects.map((project) => {
    const isSaved = project.repoRoot === saved;
    const isLoading = project.repoRoot === loadingRoot;
    const statsPending = Boolean(project.statsPending);
    const sessionCount = Number(project.sessionCount || 0);
    const classes = [
      'projectItem',
      isSaved ? 'lastSelected' : '',
      project.exists ? '' : 'missing',
      isLoading ? 'loading' : '',
    ].filter(Boolean).join(' ');
    const badges = [
      isSaved ? `<span class="projectBadge">${escapeHtml(t('lastSelected'))}</span>` : '',
      project.exists ? '' : `<span class="projectBadge warning">${escapeHtml(t('missingDirectory'))}</span>`,
    ].join('');
    const action = isLoading ? `<span class="projectSpinner" aria-hidden="true"></span><span>${escapeHtml(t('indexing'))}</span>` : `<span>${escapeHtml(t('open'))}</span>`;
    const facts = statsPending
      ? `<span>${escapeHtml(t('activityLoading'))}</span>`
      : `<span>${escapeHtml(t('sessionCount', { count: sessionCount }))}</span><span>${escapeHtml(project.updatedAt ? fmtDate(project.updatedAt) : t('noTranscriptActivity'))}</span>`;
    return `<button class="${classes}" type="button" data-project-root="${escapeHtml(project.repoRoot)}"${loadingRoot ? ' disabled' : ''}>
      <span class="projectMain">
        <span class="projectName">${escapeHtml(projectName(project.repoRoot))}${badges}</span>
        <span class="projectPath">${escapeHtml(project.repoRoot)}</span>
      </span>
      <span class="projectFacts" aria-label="${escapeHtml(t('projectActivity'))}">
        ${facts}
      </span>
      <span class="projectAction">${action}</span>
    </button>`;
  }).join('');
}

function clearProjectPollTimer() {
  if (!state.projectPollTimer) return;
  clearTimeout(state.projectPollTimer);
  state.projectPollTimer = 0;
}

function isActiveProjectChooserRequest(requestId) {
  return requestId === state.projectChooserRequestId
    && state.selectingProject
    && !state.projectLoadingRoot
    && !state.projectJobId;
}

function resetSessionDetailCache() {
  state.detailCache = {};
  state.detailErrors = {};
  state.detailPending = {};
  state.detailCacheGeneration += 1;
}

async function cancelProjectJob(jobId) {
  if (!jobId) return;
  try {
    await api(`/api/project/status?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

async function showProjectChooser(options = {}) {
  const requestId = state.projectChooserRequestId + 1;
  state.projectChooserRequestId = requestId;
  state.projectReturning = false;
  setProjectMode(true);
  state.projectLoadingRoot = '';
  state.projectJobId = '';
  updateProjectChrome({ displayRoot: '', returnRoot: state.repoRoot });
  clearProjectPollTimer();
  resetProjectViewState();
  setProjectHeader('', t('chooseTargetProjectContinue'));
  if (el.projectStatus) el.projectStatus.textContent = t('loadingProjectList');
  if (el.projectProgress) el.projectProgress.hidden = true;
  if (el.projectCancelBtn) el.projectCancelBtn.hidden = true;
  if (el.projectList) el.projectList.innerHTML = '';
  let renderedSummary = false;
  try {
    const summary = await api('/api/projects?summary=1');
    if (!isActiveProjectChooserRequest(requestId)) return;
    state.projects = summary.projects;
    renderedSummary = state.projects.length > 0;
    if (renderedSummary) renderProjects();
    if (el.projectStatus) {
      el.projectStatus.textContent = renderedSummary
        ? t('projectActivityLoading', { codexHome: summary.codexHome })
        : t('discoveringProjects');
    }
  } catch (error) {
    console.warn('Unable to load project summary', error);
  }
  if (!isActiveProjectChooserRequest(requestId)) return;
  const data = await api('/api/projects');
  if (!isActiveProjectChooserRequest(requestId)) return;
  state.projects = data.projects;
  renderProjects();
  if (el.projectStatus) el.projectStatus.textContent = state.projects.length ? t('projectCandidates', { count: state.projects.length, codexHome: data.codexHome }) : t('noProjectCandidates', { codexHome: data.codexHome });

  const saved = localStorage.getItem(REPO_STORAGE_KEY);
  if (options.autoRestore && saved && state.projects.some((project) => project.repoRoot === saved)) {
    await selectProject(saved, { restore: true });
  }
}

async function exitProjectChooser() {
  state.projectChooserRequestId += 1;
  const jobId = state.projectJobId;
  state.projectReturning = true;
  clearProjectPollTimer();
  state.projectLoadingRoot = '';
  state.projectJobId = '';
  updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
  try {
    await cancelProjectJob(jobId);
    const appState = await api('/api/state');
    const currentState = appState.currentState || (!appState.job ? appState : null);
    if (!currentState?.projectSelected) throw new Error(t('projectUnavailable'));
    await finishProjectSelection(currentState, { restore: true });
  } catch (error) {
    state.projectReturning = false;
    updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
    throw error;
  }
}

async function applyAppState(appState) {
  if (appState.locale) state.locale = i18n.resolveLocale(appState.locale);
  applyStaticLocale();
  state.repoRoot = appState.repoRoot || '';
  state.builtinProfiles = normalizeProfiles(appState.foldingProfiles);
  state.profiles = normalizeProfiles([...state.builtinProfiles, ...state.customProfiles]);
  state.eventKinds = appState.eventKinds;
  state.sessionGrandTotal = appState.totals.sessionCount || 0;
  setProjectHeader(
    appState.repoRoot,
    [
      t('sessionCount', { count: appState.totals.sessionCount }),
      t('logicalEventCount', { count: appState.totals.eventCount }),
      t('rawRecordCount', { count: appState.totals.rawEventCount }),
    ].join(' | '),
  );
  el.profileSelect.innerHTML = renderProfileOptions();
  el.profileSelect.value = state.profileId;
  if (!el.profileSelect.value) {
    state.profileId = 'narrative';
    el.profileSelect.value = state.profileId;
    localStorage.setItem('sessionAnalyzer.profile', state.profileId);
  }
  syncProfileInfoSlot();
  updateProfileApplicabilityUi();
  resetProfileDraft();
  el.layerSelect.value = state.layerId;
  syncSearchAssistControls();
  resetDetailPane();
}

async function finishProjectSelection(appState, options = {}) {
  localStorage.setItem(REPO_STORAGE_KEY, appState.repoRoot);
  state.projectLoadingRoot = '';
  state.projectJobId = '';
  state.projectReturning = false;
  clearProjectPollTimer();
  updateProjectChrome({ displayRoot: appState.repoRoot, returnRoot: appState.repoRoot });
  renderProjects();
  resetProjectViewState();
  await applyAppState(appState);
  setProjectMode(false);
  await loadSessions();
  if (!options.restore && el.projectStatus) el.projectStatus.textContent = '';
  if (el.projectProgress) el.projectProgress.hidden = true;
  if (el.projectCancelBtn) el.projectCancelBtn.hidden = true;
}

async function changeLocale(locale) {
  const next = i18n.resolveLocale(locale);
  if (next === state.locale) return;
  const dirtyDraft = profileDirty()
    ? { profileId: state.profileId, rules: normalizeRules(cloneProfile(state.profileDraft).rules || defaultRules()) }
    : null;
  state.locale = next;
  beginSearchTargetContextTransition();
  localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);
  resetSessionDetailCache();
  applyStaticLocale();
  if (state.projectSelected) {
    const appState = await api('/api/state');
    await applyAppState(appState.currentState || appState);
    await loadSessions();
    if (dirtyDraft && state.profileId === dirtyDraft.profileId && state.profiles.some((profile) => profile.id === dirtyDraft.profileId)) {
      state.profileDraft = cloneProfile(activeProfile());
      state.profileDraft.rules = normalizeRules(dirtyDraft.rules);
      renderTimeline();
      updateMetricActionStates();
      if (state.detailView.type === 'profileRules') renderProfileRulesPane();
    }
  } else {
    renderProjects();
  }
}

async function handleProjectJobResponse(data, options = {}) {
  const job = data.job || {};
  if (job.id !== state.projectJobId) return;
  renderProjectJob(job);
  if (job.status === 'succeeded') {
    let appState = data.state;
    if (!appState) appState = (await api(`/api/project/status?jobId=${encodeURIComponent(job.id)}`)).state;
    if (!appState) {
      const current = await api('/api/state');
      if (!current.job) appState = current;
    }
    if (!appState) throw new Error(t('projectIndexUnavailable'));
    await finishProjectSelection(appState, options);
    return;
  }
  if (job.status === 'failed') throw new Error(job.error || t('indexingFailed'));
  if (job.status === 'cancelled') {
    state.projectLoadingRoot = '';
    state.projectJobId = '';
    state.projectReturning = false;
    setAnalyzerDisabled(false);
    updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
    if (el.projectStatus) el.projectStatus.textContent = t('indexingCancelledSentence');
    if (el.projectProgress) el.projectProgress.hidden = true;
    if (el.projectCancelBtn) el.projectCancelBtn.hidden = true;
    if (state.projects.length) renderProjects();
    else await showProjectChooser({ autoRestore: false });
    return;
  }
  scheduleProjectJobPoll(job.id, options);
}

async function pollProjectJob(jobId, options = {}) {
  clearProjectPollTimer();
  const data = await api(`/api/project/status?jobId=${encodeURIComponent(jobId)}`);
  if (jobId !== state.projectJobId) return;
  await handleProjectJobResponse(data, options);
}

function handleProjectJobError(jobId, error) {
  if (jobId !== state.projectJobId) return;
  showError(error);
}

function scheduleProjectJobPoll(jobId, options = {}) {
  state.projectPollTimer = setTimeout(() => {
    pollProjectJob(jobId, options).catch((error) => handleProjectJobError(jobId, error));
  }, 400);
}

async function selectProject(repoRoot, options = {}) {
  if (!repoRoot) return;
  const requestId = state.projectChooserRequestId + 1;
  state.projectChooserRequestId = requestId;
  state.projectReturning = false;
  state.projectLoadingRoot = repoRoot;
  state.projectJobId = '';
  clearProjectPollTimer();
  updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
  renderProjects();
  if (el.projectStatus) el.projectStatus.textContent = t('readingMatchingSessions', { repoRoot });
  setAnalyzerDisabled(true);
  try {
    const started = await api('/api/project', {
      method: 'POST',
      body: { repoRoot, locale: state.locale },
    });
    const job = started.job || {};
    if (requestId !== state.projectChooserRequestId) {
      await cancelProjectJob(job.id || '');
      return;
    }
    state.projectJobId = job.id || '';
    renderProjectJob(job);
    if (state.projectJobId) await pollProjectJob(state.projectJobId, options);
  } catch (error) {
    if (requestId !== state.projectChooserRequestId) return;
    clearProjectPollTimer();
    state.projectJobId = '';
    state.projectLoadingRoot = '';
    state.projectReturning = false;
    updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
    renderProjects();
    setAnalyzerDisabled(false);
    throw error;
  }
}

async function init() {
  setMobileView(state.mobileView, { scroll: false });
  try {
    const appState = await api('/api/state');
    if (appState.job) {
      const job = appState.job;
      setProjectMode(true);
      state.projectLoadingRoot = job.repoRoot || '';
      state.projectJobId = job.id || '';
      updateProjectChrome({ displayRoot: state.repoRoot, returnRoot: state.repoRoot });
      resetProjectViewState();
      renderProjectJob(job);
      renderProjects();
      if (state.projectJobId) await pollProjectJob(state.projectJobId, { restore: true });
      return;
    }
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
  state.searchStructureKey = structuredSearchKey();
  const requestId = state.sessionsRequestId + 1;
  const requestContext = sessionsDataContextKey();
  state.sessionsRequestId = requestId;
  const data = await api(`/api/sessions${currentQuery(
    { sort: el.sortSelect.value },
    { includeExpression: false, includeLayer: false },
  )}`);
  if (requestId !== state.sessionsRequestId || requestContext !== sessionsDataContextKey()) return false;
  state.sessionsDataContext = requestContext;
  state.sessions = data.sessions;
  state.sessionTotal = data.total;
  if (!data.sessions.length) {
    state.selectedSessionId = '';
    state.searchScope = 'project';
    state.timelineRequestId += 1;
    state.currentEvents = [];
    state.timelineTotal = 0;
    state.timelineSearchMatchCount = 0;
    state.timelineSearchEventCount = 0;
    state.searchStructureKey = structuredSearchKey();
    syncSearchScopeUi();
    renderProjectSearchView();
  } else {
    if (!state.selectedSessionId || !data.sessions.some((session) => session.id === state.selectedSessionId)) {
      state.selectedSessionId = data.sessions[0].id;
    }
    if (state.searchScope === 'project') {
      state.searchStructureKey = structuredSearchKey();
      syncSearchScopeUi();
      await loadProjectResults();
    } else {
      await selectSession(state.selectedSessionId);
    }
  }
  renderSearchAssistChips();
  await refreshFileSuggestions();
  return true;
}

async function loadProjectResults() {
  state.projectSearchRequestId += 1;
  const requestId = state.projectSearchRequestId;
  const requestContext = projectSearchDataContextKey();
  if (state.searchScope !== 'project' || !hasActiveSearchExpression()) {
    state.projectSearchLoading = false;
    state.projectSearchDataContext = requestContext;
    state.projectResults = [];
    state.projectSearchTotal = 0;
    state.projectSearchEventTotal = 0;
    renderProjectSearchView();
    return true;
  }
  state.projectSearchLoading = true;
  state.projectResults = [];
  state.projectSearchTotal = 0;
  state.projectSearchEventTotal = 0;
  renderProjectSearchView();
  try {
    const data = await api(`/api/sessions${currentQuery({ sort: state.projectSearchSort })}`);
    if (requestId !== state.projectSearchRequestId || requestContext !== projectSearchDataContextKey()) return false;
    state.projectSearchDataContext = requestContext;
    state.projectResults = data.sessions || [];
    state.projectSearchTotal = data.total || 0;
    state.projectSearchEventTotal = data.matchingEventTotal || 0;
    return true;
  } finally {
    if (requestId === state.projectSearchRequestId && requestContext === projectSearchDataContextKey()) {
      state.projectSearchLoading = false;
      renderProjectSearchView();
    }
  }
}

async function refreshActiveSearch(options = {}) {
  state.projectSearchRequestId += 1;
  if (state.searchScope === 'project') {
    await loadProjectResults();
    return;
  }
  if (!state.selectedSessionId) return;
  if (options.structural) {
    await loadTimeline(false, { keepScroll: true });
  } else {
    await refreshTimelineFindState();
  }
}

function focusFirstProjectResult(preferredSessionId = '') {
  const preferred = preferredSessionId
    ? el.sessionList.querySelector(`[data-project-result-session-id="${CSS.escape(preferredSessionId)}"]`)
    : null;
  const target = preferred || el.sessionList.querySelector('[data-project-result-session-id]');
  target?.focus();
  return Boolean(target);
}

function restoreProjectResultFocus(preferredSessionId = '') {
  const focused = focusFirstProjectResult(preferredSessionId);
  requestAnimationFrame(() => focusFirstProjectResult(preferredSessionId));
  return focused;
}

async function setSearchScope(scope, options = {}) {
  if (!['session', 'project'].includes(scope)) return false;
  if (scope === 'session' && !state.selectedSessionId) return false;
  if (scope === state.searchScope && !options.force) {
    syncSearchScopeUi();
    return true;
  }
  state.searchScope = scope;
  state.searchStructureKey = structuredSearchKey();
  beginSearchTargetContextTransition();
  syncSearchScopeUi();
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateSearchMatchControls();
  if (scope === 'project') {
    state.timelineRequestId += 1;
    state.analysisRequestId += 1;
    state.timelineLoading = false;
    renderProjectSearchView();
    await Promise.all([loadProjectResults(), refreshFileSuggestions()]);
    if (options.mobileView !== false) setMobileView('sessions');
    if (options.focusResults) restoreProjectResultFocus(options.preferredSessionId || '');
    return true;
  }
  state.projectSearchRequestId += 1;
  state.projectSearchLoading = false;
  state.projectReturnContext = null;
  await selectSession(state.selectedSessionId, { mobileView: options.mobileView === false ? '' : 'events' });
  return true;
}

async function backToProjectResults() {
  const preferredSessionId = state.projectReturnContext?.sessionId || '';
  await setSearchScope('project', {
    force: true,
    focusResults: true,
    preferredSessionId,
    mobileView: true,
  });
  restoreProjectResultFocus(preferredSessionId);
}

async function drillDownProjectResult(sessionId) {
  if (state.searchScope !== 'project') return false;
  const result = state.projectResults.find((item) => item.id === sessionId);
  const latest = result?.searchMatch?.latestEvent;
  if (!result || !latest) return false;
  const returnContext = {
    sessionId,
    eventId: latest.id,
    timelineIndex: latest.timelineIndex,
    contextKey: projectSearchDataContextKey(),
  };
  state.projectReturnContext = returnContext;
  if (state.selectedSessionId !== sessionId) resetSessionDetailCache();
  state.searchScope = 'session';
  state.projectSearchRequestId += 1;
  state.selectedSessionId = sessionId;
  state.searchStructureKey = structuredSearchKey();
  syncSearchScopeUi();
  beginSearchTargetContextTransition();
  state.offset = 0;
  state.timelineLoading = false;
  state.timelineRequestId += 1;
  state.currentEvents = [];
  state.sessionEventKinds = { main: [], protocol: [], raw: [] };
  state.searchTargetPreload = { key: '', pages: 0, pending: false };
  resetSearchTransientExpansions();
  invalidateNavigationCache();
  resetDetailPane();
  renderSessions();
  const session = state.sessions.find((item) => item.id === sessionId) || result;
  el.sessionHeader.innerHTML = `<h2>${escapeHtml(session.title)}</h2>
    <div class="sessionMeta" aria-label="${escapeHtml(t('sessionMetadata'))}">
      <span class="sessionMetaChip">${escapeHtml(fmtDate(session.startedAt))} - ${escapeHtml(fmtDate(session.updatedAt))}</span>
      <span class="sessionSource" title="${escapeHtml(session.sourceFile)}">${escapeHtml(session.sourceFile)}</span>
    </div>
    <button class="smallBtn" type="button" data-search-back-to-project>${escapeHtml(t('backToProjectResults'))}</button>`;
  const loaded = await Promise.all([
    loadAnalysis(sessionId),
    loadTimelineThroughIndex(latest.timelineIndex),
    refreshFileSuggestions(),
  ]);
  if (!loaded[1]
      || state.searchScope !== 'session'
      || state.selectedSessionId !== sessionId
      || !state.projectReturnContext
      || state.projectReturnContext.eventId !== latest.id) return false;
  const event = state.currentEvents.find((item) => item.id === latest.id);
  if (!event) return false;
  state.selectedEventId = event.id;
  updateSelectedTimelineEvent();
  if (state.searchQuery) {
    const searchKey = searchTargetPreloadKey();
    const target = await materializeSearchEvent(event, 1, { searchKey });
    if (target) await activateSearchTarget(target, { scroll: true, syncDetail: false });
  } else {
    scrollToTimelineEvent(event.id);
  }
  if (state.searchScope === 'session' && state.selectedSessionId === sessionId) {
    state.projectReturnContext = returnContext;
    renderTimeline();
    updateSelectedTimelineEvent();
  }
  setMobileView('events');
  renderResultSummary();
  return true;
}

function renderProjectResultSnippet(text) {
  return searchHighlighter.highlightedParts(text, highlightTerms()).map((part) => (
    part.match
      ? `<mark class="projectSearchHighlight">${escapeHtml(part.text)}</mark>`
      : escapeHtml(part.text)
  )).join('');
}

function renderProjectResultCard(session) {
  const latest = session.searchMatch?.latestEvent || {};
  const relationship = sessionRelationshipLabel(session);
  return `<button class="sessionItem projectResultCard" type="button" data-project-result-session-id="${escapeHtml(session.id)}">
    <span class="sessionTitle">${escapeHtml(session.title)}</span>
    <span class="meta">${escapeHtml(fmtDate(session.updatedAt || session.startedAt))} | ${escapeHtml(fmtBytes(session.bytes))}</span>
    ${relationship ? `<span class="chip relationshipChip">${escapeHtml(relationship)}</span>` : ''}
    <span class="projectResultCount">${escapeHtml(t('projectResultCount', { count: session.searchMatch?.eventCount || 0 }))}</span>
    <span class="projectLatestMatch">
      <span class="projectLatestMeta"><strong>${escapeHtml(latest.label || t('latestMatch'))}</strong><time>${escapeHtml(fmtDate(latest.timestamp))}</time></span>
      <span class="projectLatestSnippet">${renderProjectResultSnippet(latest.snippet || '')}</span>
    </span>
  </button>`;
}

function renderSessions() {
  if (state.searchScope === 'project' && hasActiveSearchExpression()) {
    el.sessionList.innerHTML = state.projectResults.map(renderProjectResultCard).join('');
    state.searchSurfaceContexts.sessions = '';
    return;
  }
  el.sessionList.innerHTML = state.sessions.map((session) => {
    const active = session.id === state.selectedSessionId;
    const relationship = sessionRelationshipLabel(session);
    const parentAttr = session.parentSessionId ? ` data-parent-session-id="${escapeHtml(session.parentSessionId)}"` : '';
    const relationshipTitle = sessionRelationshipTitle(session, relationship);
    return `<button class="${sessionItemClasses(session, active)}" type="button" data-session-id="${escapeHtml(session.id)}"${parentAttr}>
      <span class="sessionTitle">${escapeHtml(session.title)}</span>
      <span class="meta">${escapeHtml(fmtDate(session.updatedAt || session.startedAt))} | ${escapeHtml(fmtBytes(session.bytes))}</span>
      <span class="chips">
        ${relationship ? `<span class="chip relationshipChip" title="${escapeHtml(relationshipTitle)}">${escapeHtml(relationship)}</span>` : ''}
        <span class="chip">${escapeHtml(t('messageCountShort', { count: session.counts.messages }))}</span>
        <span class="chip">${escapeHtml(t('toolCountShort', { count: session.counts.toolCalls }))}</span>
        <span class="chip">${escapeHtml(t('failedCommandCountShort', { count: session.counts.failedCommands }))}</span>
        <span class="chip">${escapeHtml(t('protocolCountShort', { count: session.protocolCount }))}</span>
      </span>
    </button>`;
  }).join('');
  state.searchSurfaceContexts.sessions = state.sessionsDataContext === sessionsDataContextKey()
    ? sessionsDataContextKey()
    : '';
  refreshSearchHighlights({ preserveActive: true });
}

function renderProjectSearchView() {
  if (state.searchScope !== 'project') return;
  const active = hasActiveSearchExpression();
  const noResults = active && !state.projectSearchLoading && state.projectSearchTotal === 0;
  const message = !active
    ? t('projectSearchPrompt')
    : (noResults ? t('projectNoResults') : t('projectResultsGuidance'));
  el.sessionHeader.innerHTML = `<h2>${escapeHtml(t('projectSearchTitle'))}</h2><p>${escapeHtml(message)}</p>`;
  el.analysisPanel.innerHTML = '';
  el.timeline.innerHTML = `<div class="projectSearchState"><h3>${escapeHtml(t('projectSearchTitle'))}</h3><p>${escapeHtml(message)}</p></div>`;
  el.detail.innerHTML = '';
  state.searchSurfaceContexts.timeline = '';
  state.searchSurfaceContexts.detail = '';
  el.loadMoreBtn.disabled = true;
  el.loadMoreBtn.textContent = t('loadMore');
  renderSessions();
  renderResultSummary();
}

function renderProjectReturnBanner() {
  if (!state.projectReturnContext || state.searchScope !== 'session') return '';
  return `<div class="projectReturnBanner">
    <button class="smallBtn" type="button" data-search-back-to-project>${escapeHtml(t('backToProjectResults'))}</button>
  </div>`;
}

async function selectSession(sessionId, options = {}) {
  if (state.selectedSessionId !== sessionId) resetSessionDetailCache();
  state.searchScope = 'session';
  state.projectSearchRequestId += 1;
  state.selectedSessionId = sessionId;
  state.searchStructureKey = structuredSearchKey();
  syncSearchScopeUi();
  beginSearchTargetContextTransition();
  state.offset = 0;
  state.timelineLoading = false;
  state.timelineRequestId += 1;
  state.currentEvents = [];
  state.sessionEventKinds = { main: [], protocol: [], raw: [] };
  state.searchTargetPreload = { key: '', pages: 0, pending: false };
  resetSearchTransientExpansions();
  invalidateNavigationCache();
  updateResetFoldsButton();
  renderSessions();
  resetDetailPane();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (session) {
    const relationship = sessionRelationshipLabel(session);
    el.sessionHeader.innerHTML = `<h2>${escapeHtml(session.title)}</h2>
      <div class="sessionMeta" aria-label="${escapeHtml(t('sessionMetadata'))}">
        ${relationship ? `<span class="sessionMetaChip">${escapeHtml(relationship)}</span>` : ''}
        <span class="sessionMetaChip">${escapeHtml(fmtDate(session.startedAt))} - ${escapeHtml(fmtDate(session.updatedAt))}</span>
        <span class="sessionSource" title="${escapeHtml(session.sourceFile)}">${escapeHtml(session.sourceFile)}</span>
      </div>`;
  }
  renderSearchAssistChips();
  await Promise.all([loadAnalysis(sessionId), loadTimeline(false), refreshFileSuggestions()]);
  if (options.mobileView) setMobileView(options.mobileView);
}

async function loadAnalysis(sessionId) {
  const requestId = state.analysisRequestId + 1;
  const requestLocale = state.locale;
  const requestScope = state.searchScope;
  state.analysisRequestId = requestId;
  const analysis = await api(`/api/sessions/${encodeURIComponent(sessionId)}/analysis`);
  if (requestId !== state.analysisRequestId
      || sessionId !== state.selectedSessionId
      || requestScope !== state.searchScope
      || state.searchScope !== 'session'
      || requestLocale !== state.locale) return;
  const planCount = analysis.counts.planEvents ?? analysis.counts.planArtifacts;
  const issueCount = analysis.counts.issueEvents ?? analysis.counts.failedCommands;
  el.analysisPanel.innerHTML = [
    metric(t('metricTurns'), analysis.counts.turns),
    metric(t('metricMessages'), analysis.counts.messages, { action: 'profile', value: 'conversation', label: t('switchToConversationProfile') }),
    metric(t('metricIssues'), issueCount, { action: 'profile', value: 'debug', label: t('switchToIssueProfile') }),
    metric(t('metricFiles'), analysis.patchedFiles.length, { action: 'profile', value: 'changes', label: t('switchToChangesProfile') }),
    metric(t('metricProtocol'), analysis.counts.protocol, { action: 'layer', value: 'protocol', label: t('switchToProtocolLayer') }),
    metric(t('metricPlans'), planCount, { action: 'profile', value: 'planning', label: t('switchToPlanningProfile') }),
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
    ? t('metricShortcutMainOnly', { label })
    : (action?.label ? t('metricActionCount', { action: action.label, value, label }) : '');
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
  const focusAnchor = state.searchScope === 'session' ? captureFocusAnchor() : { hadSelection: false };
  resetSearchTransientExpansions();
  state.layerId = layerId;
  clearSearchValidationOperator('layer');
  el.layerSelect.value = state.layerId;
  state.searchStructureKey = structuredSearchKey();
  beginSearchTargetContextTransition();
  localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  if (state.detailView.type === 'profileRules') renderProfileRulesPane();
  await Promise.all([refreshActiveSearch({ structural: true }), refreshFileSuggestions()]);
  if (focusAnchor.hadSelection) await restoreFocus(focusAnchor);
  updateMetricActionStates();
}

function updateLoadMoreButton() {
  if (!el.loadMoreBtn) return;
  const hasMore = state.offset < state.timelineTotal;
  el.loadMoreBtn.disabled = !state.selectedSessionId || state.timelineLoading || !hasMore;
  if (state.timelineLoading) {
    el.loadMoreBtn.textContent = t('loading');
  } else {
    el.loadMoreBtn.textContent = hasMore
      ? t('loadMoreCount', { loaded: state.offset, total: state.timelineTotal })
      : t('loadedCount', { loaded: state.offset });
  }
}

async function loadTimeline(append, options = {}) {
  if (!state.selectedSessionId) return;
  if (append && state.timelineLoading) return;
  const sessionId = state.selectedSessionId;
  const requestContext = timelineDataContextKey();
  if (append && state.timelineDataContext !== requestContext) return;
  const requestId = state.timelineRequestId + 1;
  state.timelineRequestId = requestId;
  state.timelineLoading = true;
  updateLoadMoreButton();
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${currentQuery({
      offset: append ? state.offset : 0,
      limit: state.limit,
    })}`);
    if (requestId !== state.timelineRequestId
        || sessionId !== state.selectedSessionId
        || requestContext !== timelineDataContextKey()) return;
    if (append) {
      state.currentEvents = state.currentEvents.concat(data.events);
    } else {
      state.currentEvents = data.events;
    }
    state.offset = state.currentEvents.length;
    state.timelineTotal = data.total;
    state.timelineSearchMatchCount = data.searchMatchCount || 0;
    state.timelineSearchEventCount = data.searchEventCount || 0;
    state.sessionEventKinds = data.eventKinds;
    state.timelineDataContext = requestContext;
    syncSearchAssistControls();
    if (state.detailView.type === 'profileRules') renderProfileRulesPane();
    renderTimeline();
    convergeSelectedEventDetailView({ refreshedHitState: true });
    if (!append && !options.keepScroll) resetTimelineScroll();
    renderResultSummary();
    if (options.allowSearchTargetPreload !== false) maybePreloadSearchTargets();
  } finally {
    if (requestId === state.timelineRequestId) {
      state.timelineLoading = false;
      updateLoadMoreButton();
      if (options.allowSearchTargetPreload !== false) maybePreloadSearchTargets();
    }
  }
}

async function loadTimelineThroughIndex(timelineIndex) {
  if (!state.selectedSessionId || state.searchScope !== 'session') return false;
  const sessionId = state.selectedSessionId;
  const requestContext = timelineDataContextKey();
  const requiredCount = Math.max(1, Number(timelineIndex || 0) + 1);
  const requestId = state.timelineRequestId + 1;
  state.timelineRequestId = requestId;
  state.timelineLoading = true;
  updateLoadMoreButton();
  try {
    const events = [];
    let total = 0;
    let searchMatchCount = 0;
    let searchEventCount = 0;
    let eventKinds = null;
    while (events.length < requiredCount) {
      const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${currentQuery({
        offset: events.length,
        limit: Math.min(500, requiredCount - events.length),
      })}`);
      if (requestId !== state.timelineRequestId
          || sessionId !== state.selectedSessionId
          || state.searchScope !== 'session'
          || requestContext !== timelineDataContextKey()) return false;
      total = data.total;
      searchMatchCount = data.searchMatchCount || 0;
      searchEventCount = data.searchEventCount || 0;
      eventKinds = data.eventKinds;
      events.push(...data.events);
      if (!data.events.length || events.length >= total) break;
    }
    state.currentEvents = events;
    state.offset = events.length;
    state.timelineTotal = total;
    state.timelineSearchMatchCount = searchMatchCount;
    state.timelineSearchEventCount = searchEventCount;
    state.sessionEventKinds = eventKinds || { main: [], protocol: [], raw: [] };
    state.timelineDataContext = requestContext;
    syncSearchAssistControls();
    renderTimeline();
    renderResultSummary();
    resetTimelineScroll();
    return true;
  } finally {
    if (requestId === state.timelineRequestId) {
      state.timelineLoading = false;
      updateLoadMoreButton();
    }
  }
}

async function refreshTimelineFindState(options = {}) {
  if (!state.selectedSessionId) return;
  const sessionId = state.selectedSessionId;
  const requestContext = timelineDataContextKey();
  const targetCount = Math.max(state.currentEvents.length, state.offset, state.limit);
  if (!targetCount) {
    await loadTimeline(false, { keepScroll: true, ...options });
    return;
  }

  const requestId = state.timelineRequestId + 1;
  state.timelineRequestId = requestId;
  state.timelineLoading = true;
  updateLoadMoreButton();
  try {
    const events = [];
    let total = 0;
    let searchMatchCount = 0;
    let searchEventCount = 0;
    let eventKinds = null;
    while (events.length < targetCount) {
      const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/timeline${currentQuery({
        offset: events.length,
        limit: Math.min(500, targetCount - events.length),
      })}`);
      if (requestId !== state.timelineRequestId
          || sessionId !== state.selectedSessionId
          || requestContext !== timelineDataContextKey()) return;
      total = data.total;
      searchMatchCount = data.searchMatchCount || 0;
      searchEventCount = data.searchEventCount || 0;
      eventKinds = data.eventKinds;
      events.push(...data.events);
      if (!data.events.length || events.length >= total) break;
    }
    state.currentEvents = events;
    state.offset = events.length;
    state.timelineTotal = total;
    state.timelineSearchMatchCount = searchMatchCount;
    state.timelineSearchEventCount = searchEventCount;
    state.sessionEventKinds = eventKinds;
    state.timelineDataContext = requestContext;
    syncSearchAssistControls();
    if (state.detailView.type === 'profileRules') renderProfileRulesPane();
    renderTimeline();
    if (!convergeSelectedEventDetailView({ refreshedHitState: true })) refreshSearchSensitiveDetailView();
    renderResultSummary();
    maybePreloadSearchTargets();
  } finally {
    if (requestId === state.timelineRequestId) {
      state.timelineLoading = false;
      updateLoadMoreButton();
      maybePreloadSearchTargets();
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

  const profile = { ...activeProfile(), rules: activeProfileRules() };
  return evaluateDisplayStateFromRules(event, profile?.rules || defaultRules());
}

function displayState(event) {
  const sessionOverrides = state.overrides[state.selectedSessionId] || {};
  if (sessionOverrides[event.id]) return sessionOverrides[event.id];
  if (currentSearchTransientExpansionIds().includes(event.id)) return 'expanded';
  return naturalDisplayState(event);
}

function foldedDisplayState(event) {
  const natural = naturalDisplayState(event);
  return ['summary', 'collapsed'].includes(natural) ? natural : 'collapsed';
}

function renderEventBody(event, display) {
  if (display !== 'expanded') return '';
  const key = detailKey(state.selectedSessionId, activeLayerId(), event.id);
  const detail = state.detailCache[key];
  const error = state.detailErrors[key];
  if (detail) {
    const preview = event.snippet || event.preview || event.label;
    return `<div class="eventBody">${renderTimelineSections(detail.timelineSections, preview)}</div>`;
  }
  if (error) {
    return `<div class="eventBody"><div class="notice error"><p>${escapeHtml(error)}</p></div><button class="smallBtn" type="button" data-action="retry-detail">${escapeHtml(t('retryDetail'))}</button></div>`;
  }
  const snippet = event.hasSearchHit && event.snippet
    ? `<div class="eventPreview eventLoadingSnippet">${escapeHtml(event.snippet)}</div>`
    : '';
  return `<div class="eventBody">${snippet}<div class="notice info"><p>${escapeHtml(t('loadingStructuredDetail'))}</p></div></div>`;
}

function renderEventFooterActions(display) {
  if (display !== 'expanded') return '';
  const label = t('collapseEvent');
  return `<div class="eventFooterActions">
    <button class="eventCollapseBtn" type="button" data-action="toggle" aria-label="${label}" title="${label}">
      <svg class="eventCollapseIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 15l6-6 6 6"></path>
      </svg>
      <span class="srOnly">${label}</span>
    </button>
  </div>`;
}

function renderEventPreview(event, display) {
  if (display === 'expanded') return '';
  if (event.kind === 'usage_limit_warning' && event.usageLimits?.length) {
    return `<div class="eventPreview usageLimitPreview">${renderUsageLimitPreview(event.usageLimits)}</div>`;
  }
  if (event.kind === 'usage_limit_warning' && event.tokenUsage?.length) {
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
  return items.map((item) => `<div class="usageLimitMini"><strong>${escapeHtml(item.label || '')}</strong><span>${escapeHtml(item.remaining || '')} ${escapeHtml(t('remaining'))}</span><em>${escapeHtml(t('resets'))} ${escapeHtml(item.reset || '')}</em></div>`).join('');
}

function cssToken(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function renderTimeline() {
  if (state.searchScope !== 'session') {
    renderProjectSearchView();
    return;
  }
  el.timeline.innerHTML = `${renderProjectReturnBanner()}${state.currentEvents.map((event) => {
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
      event.status ? `<span class="chip statusChip statusChip-${cssToken(event.status)}">${escapeHtml(event.status)}</span>` : '',
      ...(Array.isArray(event.tags) ? event.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`) : []),
      event.toolName ? `<span class="chip toolChip">${escapeHtml(event.toolName)}</span>` : '',
      event.touchedFiles?.length ? `<span class="chip countChip">${event.touchedFiles.length} ${escapeHtml(t('files'))}</span>` : '',
      event.rawRefs?.length ? `<span class="chip countChip">${event.rawRefs.length} ${escapeHtml(t('raw'))}</span>` : '',
      event.channels?.length ? `<span class="chip channelChip">${escapeHtml(event.channels.join(','))}</span>` : '',
    ].join('');
    const toggleLabel = ds === 'expanded' ? t('collapseEvent') : t('expandEvent');
    return `<article class="${classes}" data-event-id="${escapeHtml(event.id)}">
      <div class="eventHeader">
        <button class="eventToggle" type="button" data-action="toggle" aria-label="${toggleLabel}" title="${toggleLabel}">
          <span class="srOnly">${toggleLabel}</span>
        </button>
        <span class="eventKind">${escapeHtml(event.label)}</span>
        ${chips ? `<span class="chips">${chips}</span>` : ''}
        <span class="eventTime">${escapeHtml(fmtDate(event.timestamp))}</span>
      </div>
      ${renderEventPreview(event, ds)}
      ${renderEventBody(event, ds)}
      ${renderEventFooterActions(ds)}
    </article>`;
  }).join('')}`;
  state.searchSurfaceContexts.timeline = state.timelineDataContext === timelineDataContextKey()
    ? timelineSearchSurfaceContextKey()
    : '';
  queueVisibleDetailLoad();
  refreshSearchHighlights({ preserveActive: true });
}

function setOverride(eventId, value) {
  clearSearchTransientExpansion(eventId);
  if (!state.overrides[state.selectedSessionId]) state.overrides[state.selectedSessionId] = {};
  state.overrides[state.selectedSessionId][eventId] = value;
  saveOverrides();
  updateResetFoldsButton();
}

function loadEventDetail(event) {
  const layer = activeLayerId();
  const sessionId = state.selectedSessionId;
  const generation = state.detailCacheGeneration;
  const key = detailKey(sessionId, layer, event.id);
  if (state.detailCache[key] || state.detailErrors[key]) return Promise.resolve();
  if (!state.detailPending[key]) {
    const pending = api(`/api/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(event.id)}/detail?layer=${encodeURIComponent(layer)}`)
      .then((detail) => {
        if (state.selectedSessionId !== sessionId || state.detailCacheGeneration !== generation) return;
        state.detailCache[key] = detail;
        delete state.detailErrors[key];
      })
      .catch((error) => {
        if (state.selectedSessionId !== sessionId || state.detailCacheGeneration !== generation) return;
        state.detailErrors[key] = error.message;
      })
      .finally(() => {
        if (state.detailPending[key] === pending) delete state.detailPending[key];
      });
    state.detailPending[key] = pending;
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
  if ((scroller && (bounds.width <= 0 || bounds.height <= 0))
      || (rect.width <= 0 && rect.height <= 0)) return false;
  return rect.bottom >= bounds.top && rect.top <= bounds.bottom;
}

function loadVisibleExpandedDetails() {
  state.detailViewportTimer = 0;
  if (!searchDiscoveryContextReady()) return;
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

function queueTimelinePaginationCheck(scroller) {
  if (!scroller || state.searchProgrammaticScroll.paginationFrame) return;
  state.searchProgrammaticScroll.paginationFrame = requestAnimationFrame(() => {
    state.searchProgrammaticScroll.paginationFrame = 0;
    maybeLoadMoreTimeline(scroller);
  });
}

const TIMELINE_SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

function onTimelineUserScrollIntent(event) {
  if (event.type === 'keydown' && !TIMELINE_SCROLL_KEYS.has(event.key)) return;
  if (!state.searchProgrammaticScroll.active) return;
  endProgrammaticSearchScrollGuard();
  queueTimelinePaginationCheck(event.currentTarget);
}

function onTimelinePaneScroll(event) {
  const searchScroll = state.searchProgrammaticScroll.active;
  if (searchScroll) keepProgrammaticSearchScrollGuard();
  if (document.activeElement !== el.searchInput && !searchScroll) hideSearchAssist();
  queueVisibleDetailLoad();
  if (!searchScroll) maybeLoadMoreTimeline(event.currentTarget);
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
  state.navigationLoadErrorKey = '';
}

function currentNavigationCache() {
  const key = navigationCacheKey();
  return state.navigationCache.key === key && !state.navigationCache.pending ? state.navigationCache : null;
}

function currentNavigationPending() {
  const key = navigationCacheKey();
  return state.navigationCache.key === key ? state.navigationCache.pending : null;
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
  return navigationApi.navigationCategoriesForEvent(event, events, NAVIGATION_CATEGORIES);
}

function defaultNavigationCategoryId(event, categories) {
  const preferred = [
    event.hasSearchHit ? 'search_hits' : '',
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
  if (state.navigationCategoryManualId && categories.some((category) => category.id === state.navigationCategoryManualId)) {
    state.navigationCategoryId = state.navigationCategoryManualId;
    return state.navigationCategoryManualId;
  }
  const next = defaultNavigationCategoryId(event, categories);
  state.navigationCategoryId = next;
  return next;
}

function renderInspectorNavigation(event, options = {}) {
  const cache = currentNavigationCache();
  if (!cache) {
    if (!options.pending) return '';
    return `<nav class="eventNavigator" aria-label="${escapeHtml(t('eventQuickNavigation'))}"><span class="navStatus">${escapeHtml(t('loadingNavigation'))}</span></nav>`;
  }
  const categories = navigationCategoriesForEvent(event, cache.events);
  if (!categories.length) return '';

  const categoryId = selectedNavigationCategoryId(event, categories);
  const category = categories.find((item) => item.id === categoryId) || categories[0];
  const matches = category.matchesInResult;
  const index = matches.findIndex((candidate) => candidate.id === event.id);
  const position = index >= 0 ? index + 1 : 0;
  const categorySelect = categories.length > 1
    ? `<select class="navSelect" data-navigation-category aria-label="${escapeHtml(t('quickNavigationCategory'))}">${categories.map((item) => (
      `<option value="${escapeHtml(item.id)}"${item.id === category.id ? ' selected' : ''}>${escapeHtml(i18n.t(state.locale, 'navigation', item.id) || item.label)}</option>`
    )).join('')}</select>`
    : '';
  return `<nav class="eventNavigator" aria-label="${escapeHtml(t('eventQuickNavigation'))}">
    ${categorySelect}
    <button class="navBtn" type="button" data-detail-action="navigate-event" data-nav-direction="prev"${index <= 0 ? ' disabled' : ''}>${escapeHtml(t('previous'))}</button>
    <span class="navPosition">${escapeHtml(`${position}/${matches.length}`)}</span>
    <button class="navBtn" type="button" data-detail-action="navigate-event" data-nav-direction="next"${index < 0 || index >= matches.length - 1 ? ' disabled' : ''}>${escapeHtml(t('next'))}</button>
  </nav>`;
}

function currentSelectedEvent() {
  return state.currentEvents.find((candidate) => candidate.id === state.selectedEventId)
    || currentNavigationCache()?.events.find((candidate) => candidate.id === state.selectedEventId)
    || null;
}

async function ensureEventLoaded(eventId, options = {}) {
  if (state.currentEvents.some((event) => event.id === eventId)) return;
  while (state.offset < state.timelineTotal) {
    await waitForTimelineIdle();
    await loadTimeline(true, options);
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
  showInspector(loaded, { replace: true, origin: DETAIL_VIEW_ORIGIN_USER });
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

function isSelectedEventDetailView(view = state.detailView) {
  return view?.type === 'inspector' || view?.type === 'rawRefs';
}

function detailViewOrigin(type, eventId, options = {}) {
  if (options.origin) return options.origin;
  if (options.replace && state.detailView?.type === type && state.detailView?.eventId === eventId) {
    return state.detailView.origin || DETAIL_VIEW_ORIGIN_USER;
  }
  return DETAIL_VIEW_ORIGIN_USER;
}

function eventDetailView(type, eventId, options = {}) {
  return { type, eventId, origin: detailViewOrigin(type, eventId, options) };
}

function selectedEventInCurrentTimeline() {
  const eventId = state.detailView?.eventId || state.selectedEventId;
  if (!eventId) return null;
  return state.currentEvents.find((candidate) => candidate.id === eventId) || null;
}

function convergeSelectedEventDetailView(options = {}) {
  if (!isSelectedEventDetailView()) return false;
  const item = selectedEventInCurrentTimeline();
  if (!item) {
    closeDetailView();
    return true;
  }
  if (state.detailView.origin !== DETAIL_VIEW_ORIGIN_SEARCH) return false;
  const query = currentSearchState().q;
  if (!query) {
    closeDetailView();
    return true;
  }
  if (!options.refreshedHitState) return false;
  if (!state.timelineSearchMatchCount || !item.hasSearchHit) {
    closeDetailView();
    return true;
  }
  return false;
}

function pushDetailView(nextView) {
  if (state.detailView) {
    const previousView = nextView.origin === DETAIL_VIEW_ORIGIN_USER
      && isSelectedEventDetailView(state.detailView)
      && state.detailView.eventId === nextView.eventId
      ? { ...state.detailView, origin: DETAIL_VIEW_ORIGIN_USER }
      : state.detailView;
    state.detailHistory.push(previousView);
  }
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
  state.navigationCategoryManualId = '';
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

function refreshSearchSensitiveDetailView() {
  if (isSelectedEventDetailView()) {
    renderCurrentDetailView();
  }
}

async function readFromSelectedEvent() {
  const anchor = { ...captureFocusAnchor(), detailType: 'inspector' };
  if (!anchor.hadSelection) return;
  hideSearchAssist();
  state.searchScope = 'session';
  state.searchFilters = { file: '', kind: '', status: '' };
  state.searchValidation = state.searchValidation.filter((item) => !['file', 'kind', 'status', 'layer'].includes(item.operator));
  state.layerId = 'main';
  el.layerSelect.value = state.layerId;
  localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  syncSearchInputValue();
  state.searchStructureKey = structuredSearchKey();
  syncSearchAssistControls();
  renderSearchAssistChips();
  beginSearchTargetContextTransition();
  clearQueuedSearchNavigations();
  updateProfileApplicabilityUi();
  await loadTimeline(false, { keepScroll: true });
  const restored = await restoreFocus(anchor);
  setMobileView('events');
  if (restored?.id) scrollToTimelineEvent(restored.id);
  updateMetricActionStates();
}

function renderDetailShell({ title, subtitle = '', actions = '', body = '', closeable = true, backable = state.detailHistory.length > 0, headerClass = '' }) {
  updateDetailViewChrome();
  const hasChromeControls = backable || closeable;
  const resolvedHeaderClass = [headerClass, hasChromeControls ? 'detailChromeHeader' : ''].filter(Boolean).join(' ');
  const backButton = backable
    ? `<button class="detailIconBtn detailBackBtn" type="button" data-detail-action="back" aria-label="${escapeHtml(t('back'))}" title="${escapeHtml(t('back'))}">&larr;</button>`
    : '';
  const closeButton = closeable
    ? `<button class="detailIconBtn detailCloseBtn" type="button" data-detail-action="close" aria-label="${escapeHtml(t('close'))}" title="${escapeHtml(t('close'))}">&times;</button>`
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
  state.searchSurfaceContexts.detail = detailSearchSurfaceContextKey();
  syncProfileInfoSlot();
  refreshSearchHighlights({ preserveActive: true });
}

function renderProfileRulesPane(options = {}) {
  state.detailView = { type: 'profileRules' };
  state.detailSelectionKey = '';
  state.selectedEventId = '';
  state.navigationCategoryId = '';
  state.navigationCategoryManualId = '';
  if (options.reveal === true) setMobileView('detail', { scroll: false });
  updateSelectedTimelineEvent();
  if (state.searchScope === 'project') {
    el.detail.innerHTML = '';
    state.searchSurfaceContexts.detail = '';
    return;
  }
  if (!profileAppliesToActiveLayer()) {
    const layer = activeLayerId();
    const fixedRuleText = layer === 'protocol'
      ? t('protocolFixedRules')
      : t('rawFixedRules');
    renderDetailShell({
      title: t('foldingStrategy'),
      subtitle: t('fixedRuleSubtitle', { layer: activeLayerLabel() }),
      actions: `<button class="smallBtn" type="button" data-detail-action="view-main-layer">${escapeHtml(t('viewMainTimeline'))}</button>`,
      headerClass: 'profileDetailHeader',
      closeable: false,
      backable: false,
      body: `<section class="profileRules profileRulesInactive">
        <div class="notice info">
          <p>${escapeHtml(t('fixedProfileRules'))}</p>
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
  const status = dirty ? t('unsavedPreview') : '';
  const profileOptions = state.profiles.map((item) => {
    const name = dirty && item.id === state.profileId && isBuiltinProfile(item.id)
      ? nextCustomProfileName(item.id)
      : item.name;
    return `<option value="${escapeHtml(item.id)}"${item.id === state.profileId ? ' selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
  const stateOptions = (value, includeDisabled = false, states = DISPLAY_STATES) => [
    includeDisabled ? `<option value=""${value ? '' : ' selected'}>${escapeHtml(t('disabled'))}</option>` : '',
    ...states.map((stateId) => `<option value="${stateId}"${stateId === value ? ' selected' : ''}>${escapeHtml(displayStateLabel(stateId))}</option>`),
  ].join('');
  const rules = normalizeRules(draft.rules);
  const conditionMap = new Map(rules.conditions.map((condition) => [condition.id, condition.state]));
  const renderKindRow = (kind) => {
    const display = rules.kindStates[kind] || '';
    return `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(kindLabel(kind))}</strong>
        <span>${escapeHtml(kind)}</span>
      </span>
      <select data-profile-kind="${escapeHtml(kind)}">
        <option value=""${display ? '' : ' selected'}>${escapeHtml(displayStateLabel(rules.fallback))} (${escapeHtml(t('default'))})</option>
        ${DISPLAY_STATES.map((stateId) => `<option value="${stateId}"${stateId === display ? ' selected' : ''}>${escapeHtml(displayStateLabel(stateId))}</option>`).join('')}
      </select>
    </label>`;
  };
  const explicitKinds = knownEventKinds().filter((kind) => rules.kindStates[kind]);
  const defaultKinds = knownEventKinds().filter((kind) => !rules.kindStates[kind]);
  const renderKindGroup = (entry) => `<section class="profileRuleGroup">
    <h4>${escapeHtml(t(`kindGroup${entry.group.id[0].toUpperCase()}${entry.group.id.slice(1)}Name`))}</h4>
    <p>${escapeHtml(t(`kindGroup${entry.group.id[0].toUpperCase()}${entry.group.id.slice(1)}Description`))}</p>
    <div class="profileRuleList">${entry.kinds.map(renderKindRow).join('')}</div>
  </section>`;
  const explicitKindRows = groupedEditableKinds(explicitKinds).map(renderKindGroup).join('');
  const defaultKindRows = groupedEditableKinds(defaultKinds).map(renderKindGroup).join('');
  const activeConditionRows = conditionDefinitions().filter((condition) => conditionMap.has(condition.id)).map((condition) => (
    `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(condition.name)}</strong>
        <span title="${escapeHtml(condition.description)}">${escapeHtml(condition.description)}</span>
      </span>
      <select data-profile-condition="${escapeHtml(condition.id)}">${stateOptions(conditionMap.get(condition.id) || '', true, CONDITION_DISPLAY_STATES)}</select>
    </label>`
  )).join('');
  const inactiveConditionRows = conditionDefinitions().filter((condition) => !conditionMap.has(condition.id)).map((condition) => (
    `<label class="profileRuleRow">
      <span>
        <strong>${escapeHtml(condition.name)}</strong>
        <span title="${escapeHtml(condition.description)}">${escapeHtml(condition.description)}</span>
      </span>
      <select data-profile-condition="${escapeHtml(condition.id)}">${stateOptions('', true, CONDITION_DISPLAY_STATES)}</select>
    </label>`
  )).join('');
  const defaultKindNames = defaultKinds.map((kind) => kindLabel(kind)).join(', ');
  const saveIcon = `<svg class="profileActionIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 3h12l2 2v16H5z"></path>
    <path d="M8 3v6h8V3"></path>
    <path d="M8 21v-7h8v7"></path>
  </svg>`;
  const cancelIcon = `<svg class="profileActionIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12"></path>
    <path d="M18 6L6 18"></path>
  </svg>`;
  const editActions = dirty
    ? `<span class="profileActionButtons">
      <button class="smallBtn profileActionIconBtn" type="button" data-detail-action="save-profile" aria-label="${escapeHtml(t('saveProfileChanges'))}" title="${escapeHtml(t('save'))}">${saveIcon}</button>
      <button class="smallBtn profileActionIconBtn" type="button" data-detail-action="cancel-profile" aria-label="${escapeHtml(t('cancelProfileChanges'))}" title="${escapeHtml(t('cancel'))}">${cancelIcon}</button>
    </span>`
    : '';
  const actions = `<div class="profileActionStack">
      <div class="profilePickerCompact" data-profile-picker-host="detail">
        <select data-profile-picker aria-label="${escapeHtml(t('strategy'))}">${profileOptions}</select>
      </div>
      ${editActions}
  </div>`;
  renderDetailShell({
    title: t('foldingStrategy'),
    subtitle: [status, draft.description].filter(Boolean).join(' | '),
    actions,
    headerClass: 'profileDetailHeader',
    closeable: false,
    backable: false,
    body: `<section class="profileRules">
      <section class="profileRuleSection">
        <div class="profileRuleSectionHeader">
          <h3>${escapeHtml(t('eventKinds'))}</h3>
        </div>
        <div class="profileRuleList">${explicitKindRows || `<div class="profileRuleEmpty">${escapeHtml(t('noExplicitKindRules'))}</div>`}</div>
      </section>
      <details class="profileRuleDetails">
        <summary>
          <span>${escapeHtml(t('defaultKindCount', { count: defaultKinds.length }))}</span>
          <label class="profileDefaultInline">
            <span>${escapeHtml(t('default'))}</span>
            <select data-profile-fallback>${stateOptions(rules.fallback)}</select>
          </label>
        </summary>
        <p>${escapeHtml(defaultKindNames)}</p>
        <div class="profileRuleList">${defaultKindRows}</div>
      </details>
      <section class="profileRuleSection">
        <h3>${escapeHtml(t('conditions'))}</h3>
        <div class="profileRuleList">${activeConditionRows || `<div class="profileRuleEmpty">${escapeHtml(t('noActiveConditions'))}</div>`}</div>
      </section>
      <details class="profileRuleDetails">
        <summary>${escapeHtml(t('inactiveConditions', { count: conditionDefinitions().length - conditionMap.size }))}</summary>
        <div class="profileRuleList">${inactiveConditionRows}</div>
      </details>
    </section>`,
  });
}

function rerenderCurrentInspectorNavigation() {
  if (state.detailView.type !== 'inspector') return;
  const item = selectedEventInCurrentTimeline();
  if (item) showInspector(item, { replace: true });
}

function showInspector(event, options = {}) {
  const layer = activeLayerId();
  const key = detailKey(state.selectedSessionId, layer, event.id);
  const refs = sourceRefs(event);
  const preview = event.snippet || event.preview || '';
  const detail = state.detailCache[key];
  const chips = renderChips(inspectorChipValues(event));
  state.selectedEventId = event.id;
  state.detailSelectionKey = key;
  if (options.replace) replaceDetailView(eventDetailView('inspector', event.id, options));
  else pushDetailView(eventDetailView('inspector', event.id, options));
  setMobileView('detail');
  updateSelectedTimelineEvent();
  const navigationKey = navigationCacheKey();
  const userRequestedNavigation = state.detailView.origin === DETAIL_VIEW_ORIGIN_USER
    && (options.replace !== true || options.retryNavigation === true);
  if (userRequestedNavigation && state.navigationLoadErrorKey === navigationKey) {
    state.navigationLoadErrorKey = '';
  }
  let navigationPending = currentNavigationPending();
  const shouldLoadNavigation = state.detailView.origin !== DETAIL_VIEW_ORIGIN_SEARCH
    && !currentNavigationCache()
    && !navigationPending
    && state.navigationLoadErrorKey !== navigationKey;
  if (shouldLoadNavigation) {
    navigationPending = ensureNavigationEvents();
    navigationPending.then(() => {
      if (state.navigationLoadErrorKey === navigationKey) state.navigationLoadErrorKey = '';
      rerenderCurrentInspectorNavigation();
    }).catch((error) => {
      if (state.navigationCache.key === navigationKey) {
        state.navigationCache = { key: '', events: [], total: 0, pending: null };
      }
      state.navigationLoadErrorKey = navigationKey;
      showError(error);
      rerenderCurrentInspectorNavigation();
    });
  }
  renderDetailShell({
    title: event.label,
    actions: [renderBackToProjectResultsAction(), renderReadFromHereAction(), renderInspectorNavigation(event, { pending: Boolean(navigationPending) })].filter(Boolean).join(''),
    body: `<div class="inspector">
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${shouldShowInspectorSummary(event, preview, detail) ? `<section class="inspectorSection"><h3>${escapeHtml(t('summary'))}</h3><div class="inspectorLead">${escapeHtml(preview)}</div></section>` : ''}
    <section class="inspectorSection">
      <h3>${escapeHtml(t('metadata'))}</h3>
      <dl class="inspectorMeta">${renderInspectorMetadata(event, refs, detail)}</dl>
    </section>
    ${renderInspectorSource(event, refs, detail)}
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
  if (options.replace) replaceDetailView(eventDetailView('rawRefs', event.id, options));
  else pushDetailView(eventDetailView('rawRefs', event.id, options));
  setMobileView('detail');
  updateSelectedTimelineEvent();
  if (!refs.length) {
    renderDetailShell({
      title: t('rawRefs'),
      subtitle: rawRefsSubtitle(event),
      actions: [renderBackToProjectResultsAction(), renderReadFromHereAction(), `<button class="smallBtn" type="button" data-detail-action="inspect">${escapeHtml(t('inspectEvent'))}</button>`].filter(Boolean).join(''),
      body: `<div class="rawRefsView">
      <div class="notice warning"><p>${escapeHtml(t('noRawRows'))}</p></div>
    </div>`,
    });
    return;
  }
  const payloads = await Promise.all(refs.map((ref) => api(`/api/raw?file=${encodeURIComponent(ref.file)}&line=${encodeURIComponent(ref.line)}`)));
  if (state.detailSelectionKey !== rawKey) return;
  renderDetailShell({
    title: t('rawRefs'),
    subtitle: rawRefsSubtitle(event),
    actions: [renderBackToProjectResultsAction(), renderReadFromHereAction(), `<button class="smallBtn" type="button" data-detail-action="inspect">${escapeHtml(t('inspectEvent'))}</button>`].filter(Boolean).join(''),
    body: `<div class="rawRefsView">
    <p class="rawMeta">${escapeHtml(t('rawRowsForEvent', { count: refs.length, plural: refs.length === 1 ? '' : 's', eventId: event.id }))}</p>
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
  resetSearchTransientExpansions();
  resetProfileDraft();
  syncProfileInfoSlot();
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
  return t('customProfileName', { name: base.name, count });
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
  el.profileSelect.innerHTML = renderProfileOptions();
  el.profileSelect.value = state.profileId;
  syncProfileInfoSlot();
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
  if (state.projectLoadingRoot || state.projectJobId) return;
  const action = state.selectingProject && state.repoRoot ? exitProjectChooser : showProjectChooser;
  action({ autoRestore: false }).catch(showError);
});

el.localeSelect?.addEventListener('change', () => {
  changeLocale(el.localeSelect.value).catch(showError);
});

el.projectCancelBtn?.addEventListener('click', () => {
  const jobId = state.projectJobId;
  if (!jobId) return;
  clearProjectPollTimer();
  api(`/api/project/status?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' })
    .then((data) => handleProjectJobResponse(data))
    .catch((error) => handleProjectJobError(jobId, error));
});

el.sessionList.addEventListener('click', (event) => {
  const projectResult = event.target.closest('[data-project-result-session-id]');
  if (projectResult) {
    drillDownProjectResult(projectResult.dataset.projectResultSessionId).catch(showError);
    return;
  }
  const item = event.target.closest('[data-session-id]');
  if (item) {
    state.projectReturnContext = null;
    selectSession(item.dataset.sessionId, { mobileView: 'events' }).catch(showError);
  }
});

el.sessionList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const projectResult = event.target.closest('[data-project-result-session-id]');
  if (!projectResult) return;
  event.preventDefault();
  drillDownProjectResult(projectResult.dataset.projectResultSessionId).catch(showError);
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

el.sessionHeader?.addEventListener('click', (event) => {
  if (!event.target.closest('[data-search-back-to-project]')) return;
  backToProjectResults().catch(showError);
});

for (const button of el.mobileViewButtons) {
  button.addEventListener('click', () => setMobileView(button.dataset.mobileView));
}

el.timeline.addEventListener('click', (event) => {
  if (event.target.closest('[data-search-back-to-project]')) {
    backToProjectResults().catch(showError);
    return;
  }
  const article = event.target.closest('[data-event-id]');
  if (!article) return;
  hideSearchAssist();
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

function showImagePreviewError(event) {
  const image = event.target.closest?.('.imagePreviewGrid img');
  if (!image) return;
  image.closest('figure')?.classList.add('failed');
}

el.timeline.addEventListener('error', showImagePreviewError, true);
el.detail.addEventListener('error', showImagePreviewError, true);

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
  if (action === 'read-from-here') {
    readFromSelectedEvent().catch(showError);
    return;
  }
  if (action === 'back-to-project-results') {
    backToProjectResults().catch(showError);
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
    showInspector(item, { replace: true, origin: DETAIL_VIEW_ORIGIN_USER, retryNavigation: true });
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
    state.profileDraft.rules = normalizeRules(state.profileDraft.rules);
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
    state.profileDraft.rules = normalizeRules(state.profileDraft.rules);
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
    state.profileDraft.rules = normalizeRules(state.profileDraft.rules);
    renderTimeline();
    renderProfileRulesPane();
    return;
  }
  const select = event.target.closest('[data-navigation-category]');
  if (!select) return;
  state.navigationCategoryId = select.value;
  state.navigationCategoryManualId = select.value;
  const item = currentSelectedEvent();
  if (item) showInspector(item, { replace: true, origin: DETAIL_VIEW_ORIGIN_USER });
});

el.profileSelect.addEventListener('change', () => {
  changeProfile(el.profileSelect.value).catch(showError);
});

el.layerSelect.addEventListener('change', () => {
  changeLayer(el.layerSelect.value).catch(showError);
});

el.resetFoldsBtn.addEventListener('click', () => {
  delete state.overrides[state.selectedSessionId];
  saveOverrides();
  updateResetFoldsButton();
  renderTimeline();
});

el.loadMoreBtn.addEventListener('click', () => {
  hideSearchAssist();
  loadTimeline(true).catch(showError);
});
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
  if (event.target.closest('[data-search-project-fallback]')) {
    setSearchScope('project').catch(showError);
    return;
  }
  if (event.target.closest('[data-search-back-to-project]')) {
    backToProjectResults().catch(showError);
    return;
  }
  const clear = event.target.closest('[data-clear-filter]')?.dataset.clearFilter;
  if (clear) {
    clearActiveFilter(clear);
    return;
  }
  const nav = event.target.closest('[data-search-match-nav]')?.dataset.searchMatchNav;
  if (nav === 'previous') {
    hideSearchAssist();
    queueSearchNavigation(-1).catch(showError);
  } else if (nav === 'next') {
    hideSearchAssist();
    queueSearchNavigation(1).catch(showError);
  }
});
for (const button of el.searchScopeButtons) {
  button.addEventListener('click', () => setSearchScope(button.dataset.searchScope).catch(showError));
}
el.searchActionRegion?.addEventListener('click', (event) => {
  const clear = event.target.closest('[data-clear-filter]')?.dataset.clearFilter;
  if (clear) clearActiveFilter(clear);
});
el.searchField?.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-search-match-nav]')?.dataset.searchMatchNav;
  if (nav === 'previous') {
    hideSearchAssist();
    queueSearchNavigation(-1).catch(showError);
  } else if (nav === 'next') {
    hideSearchAssist();
    queueSearchNavigation(1).catch(showError);
  } else if (
    event.target === el.searchField
    || (event.target.closest('.searchInputRow') && !event.target.closest('.searchScopeControl'))
  ) {
    el.searchInput.focus();
  }
});
const timelinePane = el.timeline.closest('.timelinePane');
timelinePane?.addEventListener('scroll', onTimelinePaneScroll, { passive: true });
timelinePane?.addEventListener('wheel', onTimelineUserScrollIntent, { passive: true });
timelinePane?.addEventListener('touchstart', onTimelineUserScrollIntent, { passive: true });
timelinePane?.addEventListener('pointerdown', onTimelineUserScrollIntent, { passive: true });
timelinePane?.addEventListener('keydown', onTimelineUserScrollIntent);
window.addEventListener('resize', () => {
  queueVisibleDetailLoad();
  syncProfileInfoSlot();
  syncSearchInlineLayout();
});

const reload = debounce(() => {
  syncSearchAssistControls();
  renderSearchAssistChips();
  updateProfileApplicabilityUi();
  if (state.detailView.type === 'profileRules') renderProfileRulesPane();
  refreshActiveSearch({ structural: true }).catch(showError);
}, 220);
const refreshFind = debounce(() => {
  refreshActiveSearch({ structural: false }).catch(showError);
}, SEARCH_HIGHLIGHT_INPUT_DELAY_MS);

el.searchInput.addEventListener('focus', showSearchAssist);
el.searchInput.addEventListener('click', showSearchAssist);
el.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    hideSearchAssist();
    return;
  }
  if (event.key === 'Enter') {
    const search = currentSearchState();
    if (search.scope === 'project') {
      event.preventDefault();
      hideSearchAssist();
      commitTypedSearchInput();
      refreshFind.cancel();
      reload.cancel();
      loadProjectResults()
        .then(() => focusFirstProjectResult())
        .catch(showError);
    } else if (search.q) {
      event.preventDefault();
      hideSearchAssist();
      queueSearchNavigation(event.shiftKey ? -1 : 1).catch(showError);
    } else if (!el.searchAssist?.hidden) {
      event.preventDefault();
      hideSearchAssist();
      el.searchInput.blur();
    }
  }
});
el.searchInput.addEventListener('input', () => {
  showSearchAssist();
  const requestedLayer = commitTypedSearchInput();
  const clearedTransientExpansions = reconcileSearchTransientExpansions();
  beginSearchTargetContextTransition();
  syncSearchAssistControls();
  renderSearchAssistChips();
  if (clearedTransientExpansions) renderTimeline();
  scheduleSearchHighlightRefresh({ allowPreload: false, syncDetail: true, passive: true });
  const nextStructureKey = structuredSearchKey();
  const structureChanged = state.searchStructureKey && state.searchStructureKey !== nextStructureKey;
  state.searchStructureKey = nextStructureKey;
  if (requestedLayer) {
    refreshFind.cancel();
    reload.cancel();
    changeLayer(requestedLayer).catch(showError);
    return;
  }
  if (structureChanged) {
    refreshFind.cancel();
    reload();
  } else {
    refreshFind();
  }
});
el.searchInput.addEventListener('change', () => {
  const requestedLayer = commitTypedSearchInput();
  if (reconcileSearchTransientExpansions()) renderTimeline();
  const nextStructureKey = structuredSearchKey();
  if (requestedLayer) {
    state.searchStructureKey = nextStructureKey;
    refreshFind.cancel();
    reload.cancel();
    changeLayer(requestedLayer).catch(showError);
    return;
  }
  if (nextStructureKey !== state.searchStructureKey) {
    state.searchStructureKey = nextStructureKey;
    refreshFind.cancel();
    reload();
  } else {
    refreshFind();
  }
});

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

const reloadForSearchContextChange = () => {
  beginSearchTargetContextTransition();
  if (state.searchScope === 'session') loadSessions().catch(showError);
};
el.sortSelect.addEventListener('input', reloadForSearchContextChange);
el.sortSelect.addEventListener('change', reloadForSearchContextChange);

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

applyStaticLocale();
init().catch(showError);
