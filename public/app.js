'use strict';

const state = {
  sessions: [],
  selectedSessionId: '',
  offset: 0,
  limit: 150,
  currentEvents: [],
  profiles: [],
  profileId: localStorage.getItem('sessionAnalyzer.profile') || 'narrative',
  layerId: localStorage.getItem('sessionAnalyzer.layer') || 'main',
  overrides: JSON.parse(localStorage.getItem('sessionAnalyzer.overrides') || '{}'),
};

const el = {
  stateLine: document.getElementById('stateLine'),
  searchInput: document.getElementById('searchInput'),
  profileSelect: document.getElementById('profileSelect'),
  layerSelect: document.getElementById('layerSelect'),
  kindFilter: document.getElementById('kindFilter'),
  statusFilter: document.getElementById('statusFilter'),
  fileFilter: document.getElementById('fileFilter'),
  sortSelect: document.getElementById('sortSelect'),
  sessionList: document.getElementById('sessionList'),
  sessionHeader: document.getElementById('sessionHeader'),
  analysisPanel: document.getElementById('analysisPanel'),
  timeline: document.getElementById('timeline'),
  detail: document.getElementById('detail'),
  resetFoldsBtn: document.getElementById('resetFoldsBtn'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
};

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function currentQuery(extra = {}) {
  const params = new URLSearchParams();
  const q = el.searchInput.value.trim();
  const kind = el.kindFilter.value;
  const status = el.statusFilter.value;
  const file = el.fileFilter.value.trim();
  if (q) params.set('q', q);
  if (kind) params.set('kind', kind);
  if (status) params.set('status', status);
  if (file) params.set('file', file);
  if (state.layerId) params.set('layer', state.layerId);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== '' && value != null) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function init() {
  const appState = await api('/api/state');
  state.profiles = appState.foldingProfiles || [];
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
  await loadSessions();
}

async function loadSessions() {
  const data = await api(`/api/sessions${currentQuery({ sort: el.sortSelect.value })}`);
  state.sessions = data.sessions;
  renderSessions();
  if (!state.selectedSessionId && data.sessions[0]) {
    await selectSession(data.sessions[0].id);
  } else if (state.selectedSessionId && !data.sessions.some((session) => session.id === state.selectedSessionId)) {
    state.selectedSessionId = '';
    state.currentEvents = [];
    el.timeline.innerHTML = '';
    el.analysisPanel.innerHTML = '';
    el.sessionHeader.innerHTML = '<h2>No matching session</h2><p>Adjust the search or filters.</p>';
  } else if (state.selectedSessionId) {
    await selectSession(state.selectedSessionId);
  }
}

function renderSessions() {
  el.sessionList.innerHTML = state.sessions.map((session) => {
    const active = session.id === state.selectedSessionId ? ' active' : '';
    return `<button class="sessionItem${active}" type="button" data-session-id="${escapeHtml(session.id)}">
      <span class="sessionTitle">${escapeHtml(session.title)}</span>
      <span class="meta">${escapeHtml(fmtDate(session.updatedAt || session.startedAt))} | ${escapeHtml(fmtBytes(session.bytes))}</span>
      <span class="chips">
        <span class="chip">${session.counts.messages} msgs</span>
        <span class="chip">${session.counts.toolCalls} tools</span>
        <span class="chip">${session.counts.failedCommands} failed</span>
        <span class="chip">${session.protocolCount} protocol</span>
      </span>
    </button>`;
  }).join('');
}

async function selectSession(sessionId) {
  state.selectedSessionId = sessionId;
  state.offset = 0;
  state.currentEvents = [];
  renderSessions();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (session) {
    el.sessionHeader.innerHTML = `<h2>${escapeHtml(session.title)}</h2>
      <p>${escapeHtml(session.sourceFile)} | ${escapeHtml(fmtDate(session.startedAt))} - ${escapeHtml(fmtDate(session.updatedAt))}</p>`;
  }
  await Promise.all([loadAnalysis(sessionId), loadTimeline(false)]);
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
  renderTimeline();
  el.loadMoreBtn.disabled = state.offset >= data.total;
  el.loadMoreBtn.textContent = state.offset >= data.total ? `Loaded ${state.offset}` : `Load more (${state.offset}/${data.total})`;
}

function displayState(event) {
  if (state.layerId === 'protocol') {
    return event.kind === 'protocol' ? 'summary' : 'collapsed';
  }
  if (state.layerId === 'raw') {
    return ['event_msg', 'response_item'].includes(event.recordType) ? 'collapsed' : 'summary';
  }

  const sessionOverrides = state.overrides[state.selectedSessionId] || {};
  if (sessionOverrides[event.id]) return sessionOverrides[event.id];
  const q = el.searchInput.value.trim();
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

function renderTimeline() {
  el.timeline.innerHTML = state.currentEvents.map((event) => {
    const ds = displayState(event);
    const classes = ['event', ds, event.severity, event.hasSearchHit ? 'searchHit' : '', ds === 'hidden' ? 'hiddenByProfile' : ''].filter(Boolean).join(' ');
    const chips = [
      event.layer ? `<span class="chip">${escapeHtml(event.layer)}</span>` : '',
      event.status ? `<span class="chip">${escapeHtml(event.status)}</span>` : '',
      event.toolName ? `<span class="chip">${escapeHtml(event.toolName)}</span>` : '',
      event.touchedFiles?.length ? `<span class="chip">${event.touchedFiles.length} files</span>` : '',
      event.rawRefs?.length ? `<span class="chip">${event.rawRefs.length} raw</span>` : '',
      event.channels?.length ? `<span class="chip">${escapeHtml(event.channels.join(','))}</span>` : '',
    ].join('');
    const preview = event.snippet || event.preview || event.label;
    const sourceText = event.source ? `${event.source.file}:${event.source.line}` : '';
    return `<article class="${classes}" data-event-id="${escapeHtml(event.id)}">
      <div class="eventHeader">
        <span class="eventKind">${escapeHtml(event.label)}</span>
        <span class="chips">${chips}</span>
        <span class="eventTime">${escapeHtml(fmtDate(event.timestamp))}</span>
      </div>
      <div class="eventPreview">${escapeHtml(preview)}</div>
      <div class="eventTools">
        <button class="smallBtn" type="button" data-action="toggle">${ds === 'expanded' ? 'Collapse' : 'Expand'}</button>
        <button class="smallBtn" type="button" data-action="raw">Raw refs</button>
        <span class="rawMeta">${escapeHtml(sourceText)}</span>
      </div>
    </article>`;
  }).join('');
}

function setOverride(eventId, value) {
  if (!state.overrides[state.selectedSessionId]) state.overrides[state.selectedSessionId] = {};
  state.overrides[state.selectedSessionId][eventId] = value;
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
}

async function showRaw(event) {
  const refs = event.rawRefs?.length ? event.rawRefs : [event.source];
  const payloads = await Promise.all(refs.map((ref) => api(`/api/raw?file=${encodeURIComponent(ref.file)}&line=${encodeURIComponent(ref.line)}`)));
  el.detail.innerHTML = `<h2>${escapeHtml(event.label)}</h2>
    <p class="rawMeta">${escapeHtml(event.layer || 'main')} | ${escapeHtml(event.kind)}</p>
    ${payloads.map((raw) => `<p class="rawMeta">${escapeHtml(raw.file)}:${raw.line}</p><pre>${escapeHtml(JSON.stringify(raw.parsed, null, 2) || raw.raw)}</pre>`).join('')}`;
}

el.sessionList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-session-id]');
  if (item) selectSession(item.dataset.sessionId).catch(showError);
});

el.timeline.addEventListener('click', (event) => {
  const article = event.target.closest('[data-event-id]');
  if (!article) return;
  const item = state.currentEvents.find((candidate) => candidate.id === article.dataset.eventId);
  if (!item) return;
  const action = event.target.dataset.action || 'raw';
  if (action === 'toggle') {
    const next = article.classList.contains('expanded') ? 'collapsed' : 'expanded';
    setOverride(item.id, next);
    renderTimeline();
  } else {
    showRaw(item).catch(showError);
  }
});

el.profileSelect.addEventListener('change', () => {
  state.profileId = el.profileSelect.value;
  localStorage.setItem('sessionAnalyzer.profile', state.profileId);
  renderTimeline();
});

el.layerSelect.addEventListener('change', () => {
  state.layerId = el.layerSelect.value;
  localStorage.setItem('sessionAnalyzer.layer', state.layerId);
  loadSessions().catch(showError);
});

el.resetFoldsBtn.addEventListener('click', () => {
  delete state.overrides[state.selectedSessionId];
  localStorage.setItem('sessionAnalyzer.overrides', JSON.stringify(state.overrides));
  renderTimeline();
});

el.loadMoreBtn.addEventListener('click', () => loadTimeline(true).catch(showError));

const reload = debounce(() => {
  loadSessions().catch(showError);
}, 220);

for (const input of [el.searchInput, el.kindFilter, el.statusFilter, el.fileFilter, el.sortSelect]) {
  input.addEventListener('input', reload);
  input.addEventListener('change', reload);
}

document.addEventListener('keydown', (event) => {
  if (event.altKey && event.key === 'ArrowRight') {
    const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
    const next = state.profiles[(i + 1) % state.profiles.length];
    if (next) {
      state.profileId = next.id;
      el.profileSelect.value = next.id;
      localStorage.setItem('sessionAnalyzer.profile', state.profileId);
      renderTimeline();
    }
  }
  if (event.altKey && event.key === 'ArrowLeft') {
    const i = state.profiles.findIndex((profile) => profile.id === state.profileId);
    const next = state.profiles[(i - 1 + state.profiles.length) % state.profiles.length];
    if (next) {
      state.profileId = next.id;
      el.profileSelect.value = next.id;
      localStorage.setItem('sessionAnalyzer.profile', state.profileId);
      renderTimeline();
    }
  }
});

function showError(error) {
  el.stateLine.textContent = error.message;
  console.error(error);
}

init().catch(showError);
