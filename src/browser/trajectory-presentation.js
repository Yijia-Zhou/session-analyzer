'use strict';

const TRAJECTORY_LANES = Object.freeze({
  INPUT: 'input',
  MODEL: 'model',
  TOOLS: 'tools',
  OTHER: 'other',
});

const TRAJECTORY_ITEM_KINDS = Object.freeze({
  TURN_BOUNDARY: 'turn-boundary',
  NARRATIVE: 'narrative',
  TOOL_GROUP: 'tool-group',
  OTHER: 'other',
});

const TRAJECTORY_SEQUENCE_ZOOM_LEVELS = Object.freeze([1, 2, 4, 8, 16]);
const TRAJECTORY_MARKER_MIN_PX = 3;
const TRAJECTORY_DISPLAY_STATES = Object.freeze([
  'expanded',
  'summary',
  'collapsed',
  'hidden',
]);

const DISPLAY_STATE_PRIORITY = Object.freeze({
  hidden: 0,
  collapsed: 1,
  summary: 2,
  expanded: 3,
});

const INPUT_KINDS = new Set([
  'developer_message',
  'user_message',
  'user_shell_command',
]);

const MODEL_KINDS = new Set([
  'assistant_message',
  'goal',
  'plan_update',
  'proposed_plan',
  'reasoning',
]);

const TOOL_KINDS = new Set([
  'agent_coordination',
  'async_agent',
  'async_workflow',
  'background_command',
  'code_mode_operation',
  'command',
  'hook',
  'js_repl',
  'mcp_call',
  'other_tool_call',
  'patch',
  'read',
  'subagent',
  'web_search',
]);

const FAILURE_STATUSES = new Set([
  'blocked',
  'declined',
  'error',
  'failed',
]);

function normalizedField(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function reliableTrajectoryTurnId(value) {
  if (typeof value !== 'string') return null;
  const turnId = value.trim();
  if (!turnId) return null;
  const normalized = turnId.toLowerCase();
  if (['n/a', 'none', 'null', 'unknown'].includes(normalized)) return null;
  if (/^\[.*(?:omitted|redacted).*\]$/i.test(turnId)) return null;
  return turnId;
}

function laneForSemanticKind(kind) {
  if (INPUT_KINDS.has(kind)) return TRAJECTORY_LANES.INPUT;
  if (MODEL_KINDS.has(kind)) return TRAJECTORY_LANES.MODEL;
  if (TOOL_KINDS.has(kind)) return TRAJECTORY_LANES.TOOLS;
  return '';
}

function trajectoryLaneForEvent(event) {
  const kindLane = laneForSemanticKind(normalizedField(event?.kind));
  if (kindLane) return kindLane;

  const subtypeLane = laneForSemanticKind(normalizedField(event?.subtype));
  if (subtypeLane) return subtypeLane;

  const role = normalizedField(event?.role);
  if (role === 'user' || role === 'human' || role === 'developer') {
    return TRAJECTORY_LANES.INPUT;
  }
  if (role === 'tool' || role === 'function' || normalizedField(event?.toolName)) {
    return TRAJECTORY_LANES.TOOLS;
  }
  if (role === 'assistant' || role === 'model' || role === 'reasoning') {
    return TRAJECTORY_LANES.MODEL;
  }
  return TRAJECTORY_LANES.OTHER;
}

function compactTrajectoryText(value, maxLength = 160) {
  const limit = Number.isSafeInteger(maxLength) && maxLength > 0 ? maxLength : 160;
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function trajectoryEventPreview(event) {
  const preview = event?.hasSearchHit && event?.snippet
    ? event.snippet
    : event?.preview || event?.snippet || event?.label || '';
  return compactTrajectoryText(preview);
}

function trajectoryEventType(event, fallback = 'Event') {
  return compactTrajectoryText(event?.label || event?.kind || event?.subtype || fallback, 42);
}

function trajectoryToolName(projected) {
  const event = projected?.event || projected || {};
  return compactTrajectoryText(
    event.toolName || event.subtype || event.label || event.kind || projected?.type || '',
    28,
  );
}

function normalizedDisplayState(value) {
  return TRAJECTORY_DISPLAY_STATES.includes(value) ? value : 'summary';
}

function projectedDisplayState(event, index, options) {
  if (typeof options.displayStateForEvent !== 'function') return 'summary';
  return normalizedDisplayState(options.displayStateForEvent(event, index));
}

function projectTrajectoryEvents(events, options = {}) {
  if (!Array.isArray(events)) throw new TypeError('Trajectory events must be an array');
  const ids = new Set();
  const projected = events.map((event, index) => {
    if (!event || typeof event !== 'object') {
      throw new TypeError(`Trajectory event at index ${index} must be an object`);
    }
    const eventId = typeof event.id === 'string' ? event.id.trim() : '';
    if (!eventId) throw new TypeError(`Trajectory event at index ${index} must have an ID`);
    if (ids.has(eventId)) throw new TypeError(`Trajectory event ID must be unique: ${eventId}`);
    ids.add(eventId);
    return Object.freeze({
      event,
      eventId,
      index,
      lane: trajectoryLaneForEvent(event),
      turnId: reliableTrajectoryTurnId(event.turnId),
      preview: trajectoryEventPreview(event),
      type: trajectoryEventType(event, options.eventLabel || 'Event'),
      status: compactTrajectoryText(event.status || '', 28),
      displayState: projectedDisplayState(event, index, options),
    });
  });
  return Object.freeze(projected);
}

function mostVisibleDisplayState(events) {
  let result = 'hidden';
  for (const event of events) {
    const displayState = normalizedDisplayState(event?.displayState);
    if (DISPLAY_STATE_PRIORITY[displayState] > DISPLAY_STATE_PRIORITY[result]) {
      result = displayState;
    }
  }
  return result;
}

function makeToolActivityGroup(events) {
  const frozenEvents = Object.freeze([...events]);
  const eventIds = Object.freeze(frozenEvents.map((event) => event.eventId));
  const toolNames = Object.freeze([
    ...new Set(frozenEvents.map(trajectoryToolName).filter(Boolean)),
  ]);
  return Object.freeze({
    kind: TRAJECTORY_ITEM_KINDS.TOOL_GROUP,
    id: `tools:${eventIds[0]}`,
    events: frozenEvents,
    eventIds,
    toolNames,
    failureCount: frozenEvents.filter((event) => (
      FAILURE_STATUSES.has(normalizedField(event.status))
        || normalizedField(event.event?.severity) === 'error'
    )).length,
    displayState: mostVisibleDisplayState(frozenEvents),
  });
}

function buildTrajectoryNarrativeFromProjected(projectedEvents) {
  if (!Array.isArray(projectedEvents)) {
    throw new TypeError('Projected Trajectory events must be an array');
  }
  const items = [];
  let pendingTools = [];
  let lastReliableTurnId = null;

  const flushTools = () => {
    if (!pendingTools.length) return;
    items.push(makeToolActivityGroup(pendingTools));
    pendingTools = [];
  };

  for (const projected of projectedEvents) {
    if (!projected || typeof projected !== 'object' || !projected.eventId) {
      throw new TypeError('Projected Trajectory event is invalid');
    }
    if (projected.turnId !== null && projected.turnId !== lastReliableTurnId) {
      flushTools();
      items.push(Object.freeze({
        kind: TRAJECTORY_ITEM_KINDS.TURN_BOUNDARY,
        turnId: projected.turnId,
        sequenceIndex: projected.index,
      }));
      lastReliableTurnId = projected.turnId;
    }
    if (projected.lane === TRAJECTORY_LANES.TOOLS) {
      pendingTools.push(projected);
      continue;
    }
    flushTools();
    items.push(Object.freeze({
      kind: projected.lane === TRAJECTORY_LANES.OTHER
        ? TRAJECTORY_ITEM_KINDS.OTHER
        : TRAJECTORY_ITEM_KINDS.NARRATIVE,
      event: projected,
      eventId: projected.eventId,
      displayState: projected.displayState,
    }));
  }
  flushTools();
  return Object.freeze(items);
}

function buildTrajectoryOverview(projectedEvents) {
  if (!Array.isArray(projectedEvents)) {
    throw new TypeError('Projected Trajectory events must be an array');
  }
  const laneIndexes = {
    [TRAJECTORY_LANES.INPUT]: [],
    [TRAJECTORY_LANES.MODEL]: [],
    [TRAJECTORY_LANES.TOOLS]: [],
    [TRAJECTORY_LANES.OTHER]: [],
  };
  for (const projected of projectedEvents) {
    if (!laneIndexes[projected?.lane]) throw new TypeError('Projected Trajectory lane is invalid');
    laneIndexes[projected.lane].push(projected.index);
  }
  for (const lane of Object.keys(laneIndexes)) Object.freeze(laneIndexes[lane]);
  return Object.freeze({
    eventCount: projectedEvents.length,
    eventIds: Object.freeze(projectedEvents.map((event) => event.eventId)),
    events: projectedEvents,
    laneIndexes: Object.freeze(laneIndexes),
  });
}

function buildTrajectoryPresentation(events, options = {}) {
  const projectedEvents = projectTrajectoryEvents(events, options);
  const narrativeItems = buildTrajectoryNarrativeFromProjected(projectedEvents);
  const overview = buildTrajectoryOverview(projectedEvents);
  return Object.freeze({ projectedEvents, narrativeItems, overview });
}

function trajectoryEventIdsFromNarrative(items) {
  if (!Array.isArray(items)) throw new TypeError('Trajectory narrative items must be an array');
  const result = [];
  for (const item of items) {
    if (item?.kind === TRAJECTORY_ITEM_KINDS.TURN_BOUNDARY) continue;
    if (item?.kind === TRAJECTORY_ITEM_KINDS.TOOL_GROUP) {
      result.push(...item.eventIds);
      continue;
    }
    if (item?.eventId) {
      result.push(item.eventId);
      continue;
    }
    throw new TypeError('Trajectory narrative item is invalid');
  }
  return result;
}

function trajectoryOverviewRenderMode(eventCount, plotWidth) {
  if (!Number.isSafeInteger(eventCount) || eventCount < 0) {
    throw new TypeError('Trajectory overview event count must be a non-negative integer');
  }
  if (!Number.isFinite(plotWidth) || plotWidth < 0) {
    throw new TypeError('Trajectory overview width must be a non-negative number');
  }
  if (eventCount === 0 || plotWidth === 0) return 'empty';
  return plotWidth / eventCount >= TRAJECTORY_MARKER_MIN_PX ? 'markers' : 'density';
}

function densityBinIndex(sequenceIndex, eventCount, binCount) {
  if (eventCount <= 1 || binCount <= 1) return 0;
  return Math.min(
    binCount - 1,
    Math.max(0, Math.floor(((sequenceIndex + 0.5) / eventCount) * binCount)),
  );
}

function buildTrajectoryDensityBins(projectedEvents, plotWidth) {
  if (!Array.isArray(projectedEvents)) {
    throw new TypeError('Projected Trajectory events must be an array');
  }
  if (!Number.isFinite(plotWidth) || plotWidth < 1) return Object.freeze([]);
  const binCount = Math.max(1, Math.min(projectedEvents.length, Math.floor(plotWidth)));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    startSequenceIndex: null,
    endSequenceIndex: null,
    eventCount: 0,
    input: 0,
    model: 0,
    tools: 0,
    other: 0,
  }));
  for (const event of projectedEvents) {
    const bin = bins[densityBinIndex(event.index, projectedEvents.length, binCount)];
    if (bin.startSequenceIndex === null) bin.startSequenceIndex = event.index;
    bin.endSequenceIndex = event.index;
    bin.eventCount += 1;
    bin[event.lane] += 1;
  }
  return Object.freeze(bins.filter((bin) => bin.eventCount > 0).map((bin) => Object.freeze(bin)));
}

function trajectorySequenceZoomStep(current, direction) {
  if (direction !== 'in' && direction !== 'out') {
    throw new TypeError('Trajectory sequence zoom direction must be in or out');
  }
  const currentIndex = TRAJECTORY_SEQUENCE_ZOOM_LEVELS.indexOf(current);
  const index = currentIndex === -1 ? 0 : currentIndex;
  const offset = direction === 'in' ? 1 : -1;
  return TRAJECTORY_SEQUENCE_ZOOM_LEVELS[Math.min(
    TRAJECTORY_SEQUENCE_ZOOM_LEVELS.length - 1,
    Math.max(0, index + offset),
  )];
}

function trajectoryEventFraction(sequenceIndex, eventCount) {
  if (!Number.isSafeInteger(sequenceIndex) || sequenceIndex < 0
      || !Number.isSafeInteger(eventCount) || eventCount < 1
      || sequenceIndex >= eventCount) return null;
  return (sequenceIndex + 0.5) / eventCount;
}

function nearestTrajectoryEventIndex(projectedEvents, fraction, preferredLane = '') {
  if (!Array.isArray(projectedEvents) || projectedEvents.length === 0) return -1;
  const clampedFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
  const targetIndex = (clampedFraction * projectedEvents.length) - 0.5;
  const lane = Object.values(TRAJECTORY_LANES).includes(preferredLane) ? preferredLane : '';
  const candidates = lane
    ? projectedEvents.filter((event) => event.lane === lane)
    : projectedEvents;
  const pool = candidates.length ? candidates : projectedEvents;
  let nearest = pool[0];
  let distance = Math.abs(nearest.index - targetIndex);
  for (let index = 1; index < pool.length; index += 1) {
    const candidateDistance = Math.abs(pool[index].index - targetIndex);
    if (candidateDistance < distance) {
      nearest = pool[index];
      distance = candidateDistance;
    }
  }
  return nearest.index;
}

function nearestTrajectoryOverviewEventIndex(projectedEvents, fraction, preferredLane = '') {
  const globalIndex = nearestTrajectoryEventIndex(projectedEvents, fraction);
  if (globalIndex < 0) return -1;
  if (projectedEvents[globalIndex]?.lane === TRAJECTORY_LANES.OTHER) return globalIndex;
  return nearestTrajectoryEventIndex(projectedEvents, fraction, preferredLane);
}

const DEFAULT_LABELS = Object.freeze({
  region: 'Trajectory presentation',
  overview: 'Trajectory overview',
  sequence: 'Sequence',
  loadedSequence: 'Loaded sequence',
  overviewHint: 'Canonical sequence only',
  overviewSelect: 'Select an event from the loaded sequence',
  selectedEvent: 'Selected event',
  zoomOut: 'Zoom out sequence',
  zoomIn: 'Zoom in sequence',
  fitAll: 'Fit all',
  fitSequence: 'Fit the entire loaded sequence',
  panSequence: 'Scroll or drag to pan the loaded sequence',
  narrative: 'Trajectory narrative',
  input: 'Input',
  model: 'Model',
  tools: 'Tools',
  other: 'Other',
  event: 'Event',
  turn: 'Turn',
  toolActivity: 'Tool activity',
  toolCall: 'tool call',
  toolCalls: 'tool calls',
  failed: 'failed',
  empty: 'No Main events are loaded.',
});

function appendTextElement(documentRef, parent, className, text) {
  const element = documentRef.createElement('span');
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function statusSlug(status) {
  return normalizedField(status).replace(/[^a-z0-9]+/g, '-');
}

function compactTurnId(turnId) {
  const withoutPrefix = String(turnId || '').replace(/^turn:/i, '');
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(withoutPrefix)) {
    return `${withoutPrefix.slice(0, 8)}…`;
  }
  return compactTrajectoryText(withoutPrefix, 30);
}

function applyTrajectorySelection(node, selected) {
  node.classList.toggle('selected', selected);
  node.setAttribute('aria-pressed', selected ? 'true' : 'false');
}

function eventButtonClasses(projected, extraClass = '') {
  return [
    'trajectoryEvent',
    extraClass,
    `state-${projected.displayState}`,
    `lane-${projected.lane}`,
    projected.displayState === 'hidden' ? 'hiddenByProfile' : '',
    projected.event?.hasSearchHit ? 'searchHit' : '',
    normalizedField(projected.status) === 'failed' || normalizedField(projected.event?.severity) === 'error'
      ? 'error'
      : '',
  ].filter(Boolean).join(' ');
}

function renderTrajectoryEventButton(documentRef, projected, options = {}) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = eventButtonClasses(projected, options.extraClass);
  button.dataset.eventId = projected.eventId;
  button.dataset.trajectoryEventId = projected.eventId;
  button.dataset.sequenceIndex = String(projected.index);
  button.dataset.lane = projected.lane;
  button.dataset.kind = projected.event?.kind || '';
  button.dataset.displayState = projected.displayState;
  applyTrajectorySelection(button, projected.eventId === options.selectedEventId);
  button.setAttribute('aria-label', [
    projected.type,
    projected.preview,
    projected.status,
  ].filter(Boolean).join(', '));

  appendTextElement(documentRef, button, 'trajectoryEventType', projected.type);
  appendTextElement(documentRef, button, 'trajectoryEventPreview', projected.preview);
  if (projected.status) {
    const status = appendTextElement(documentRef, button, 'trajectoryEventStatus', projected.status);
    status.dataset.status = statusSlug(projected.status);
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    options.onSelect?.(projected.event);
  });
  return button;
}

function toolGroupSummary(group, labels) {
  const countLabel = group.events.length === 1 ? labels.toolCall : labels.toolCalls;
  const names = group.toolNames.slice(0, 3);
  const omittedNameCount = Math.max(0, group.toolNames.length - names.length);
  const nameText = names.length
    ? ` · ${names.join(', ')}${omittedNameCount ? ` +${omittedNameCount}` : ''}`
    : '';
  return `${group.events.length} ${countLabel}${nameText}`;
}

function renderTrajectoryToolGroup(documentRef, group, options) {
  const details = documentRef.createElement('details');
  details.className = [
    'trajectoryToolGroup',
    `state-${group.displayState}`,
    group.displayState === 'hidden' ? 'hiddenByProfile' : '',
  ].filter(Boolean).join(' ');
  details.dataset.trajectoryToolGroupId = group.id;
  details.dataset.eventCount = String(group.events.length);
  details.__trajectoryEventIds = new Set(group.eventIds);

  const summary = documentRef.createElement('summary');
  summary.className = 'trajectoryToolGroupSummary';
  appendTextElement(documentRef, summary, 'trajectoryToolGroupLabel', options.labels.toolActivity);
  appendTextElement(documentRef, summary, 'trajectoryToolGroupCount', toolGroupSummary(group, options.labels));
  if (group.failureCount > 0) {
    const failure = appendTextElement(
      documentRef,
      summary,
      'trajectoryToolGroupFailures',
      String(group.failureCount),
    );
    failure.title = `${group.failureCount} ${options.labels.failed}`;
  }
  details.append(summary);

  const events = documentRef.createElement('div');
  events.className = 'trajectoryToolGroupEvents';
  details.append(events);

  let materialized = false;
  const ensureChildren = () => {
    if (materialized) return false;
    materialized = true;
    const fragment = documentRef.createDocumentFragment();
    for (const projected of group.events) {
      fragment.append(renderTrajectoryEventButton(documentRef, projected, {
        selectedEventId: options.selectedEventId,
        onSelect: options.onSelect,
        extraClass: 'trajectoryToolEvent',
      }));
    }
    events.append(fragment);
    details.dataset.membersMaterialized = 'true';
    options.onGroupMaterialized?.(group.id);
    return true;
  };
  details.__trajectoryEnsureChildren = ensureChildren;

  const selected = group.eventIds.includes(options.selectedEventId);
  const searchExpanded = group.events.some((event) => event.displayState === 'expanded');
  const manuallyExpanded = options.expandedGroupIds?.has(group.id) === true;
  details.open = selected || searchExpanded || manuallyExpanded;
  if (details.open) ensureChildren();
  details.addEventListener('toggle', () => {
    options.onGroupToggle?.(group.id, details.open);
    if (details.open) ensureChildren();
  });
  return details;
}

function renderTrajectoryNarrative(documentRef, model, options) {
  const narrative = documentRef.createElement('section');
  narrative.className = 'trajectoryNarrative';
  narrative.setAttribute('aria-label', options.labels.narrative);
  let narrativeRowCount = 0;
  let toolGroupCount = 0;
  for (const item of model.narrativeItems) {
    if (item.kind === TRAJECTORY_ITEM_KINDS.TURN_BOUNDARY) {
      const boundary = documentRef.createElement('div');
      boundary.className = 'trajectoryTurnBoundary';
      boundary.dataset.turnId = item.turnId;
      boundary.title = item.turnId;
      appendTextElement(
        documentRef,
        boundary,
        'trajectoryTurnBoundaryLabel',
        `${options.labels.turn} · ${compactTurnId(item.turnId)}`,
      );
      narrative.append(boundary);
      continue;
    }
    if (item.kind === TRAJECTORY_ITEM_KINDS.TOOL_GROUP) {
      toolGroupCount += 1;
      narrative.append(renderTrajectoryToolGroup(documentRef, item, options));
      continue;
    }
    narrativeRowCount += 1;
    const row = documentRef.createElement('div');
    row.className = item.kind === TRAJECTORY_ITEM_KINDS.OTHER
      ? 'trajectoryNarrativeRow trajectoryOtherRow'
      : 'trajectoryNarrativeRow';
    row.dataset.lane = item.event.lane;
    row.append(renderTrajectoryEventButton(documentRef, item.event, {
      selectedEventId: options.selectedEventId,
      onSelect: options.onSelect,
      extraClass: item.kind === TRAJECTORY_ITEM_KINDS.OTHER ? 'trajectoryOtherEvent' : '',
    }));
    narrative.append(row);
  }
  narrative.dataset.narrativeRowCount = String(narrativeRowCount);
  narrative.dataset.toolGroupCount = String(toolGroupCount);
  return narrative;
}

function laneCenterY(lane, height) {
  if (lane === TRAJECTORY_LANES.INPUT) return height / 6;
  if (lane === TRAJECTORY_LANES.MODEL) return height / 2;
  if (lane === TRAJECTORY_LANES.TOOLS) return (height * 5) / 6;
  return height / 2;
}

function overviewLaneFromY(y, height) {
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return '';
  if (y < height / 3) return TRAJECTORY_LANES.INPUT;
  if (y < (height * 2) / 3) return TRAJECTORY_LANES.MODEL;
  return TRAJECTORY_LANES.TOOLS;
}

function trajectoryLaneColor(lane) {
  if (lane === TRAJECTORY_LANES.INPUT) return '#2f7b6d';
  if (lane === TRAJECTORY_LANES.MODEL) return '#527f90';
  if (lane === TRAJECTORY_LANES.TOOLS) return '#987331';
  return '#8c6475';
}

function drawTrajectoryOverview(canvas, projectedEvents, width, height) {
  const context = canvas.getContext?.('2d');
  if (!context) return { mode: 'empty', renderedItemCount: 0 };
  const view = canvas.ownerDocument?.defaultView;
  const pixelRatio = Math.max(1, Math.min(2, Number(view?.devicePixelRatio) || 1));
  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  context.strokeStyle = '#dce4e7';
  context.lineWidth = 1;
  for (const lane of [TRAJECTORY_LANES.INPUT, TRAJECTORY_LANES.MODEL, TRAJECTORY_LANES.TOOLS]) {
    const y = Math.round(laneCenterY(lane, height)) + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const mode = trajectoryOverviewRenderMode(projectedEvents.length, width);
  if (mode === 'empty') return { mode, renderedItemCount: 0 };
  if (mode === 'markers') {
    for (const event of projectedEvents) {
      const x = trajectoryEventFraction(event.index, projectedEvents.length) * width;
      context.globalAlpha = event.displayState === 'hidden' ? 0.28 : 0.9;
      context.fillStyle = trajectoryLaneColor(event.lane);
      if (event.lane === TRAJECTORY_LANES.OTHER) {
        context.fillRect(Math.round(x), 5, 1.5, Math.max(1, height - 10));
      } else {
        context.beginPath();
        context.arc(x, laneCenterY(event.lane, height), 2.2, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
    return { mode, renderedItemCount: projectedEvents.length };
  }

  const binCount = Math.max(1, Math.min(projectedEvents.length, Math.floor(width)));
  const bins = buildTrajectoryDensityBins(projectedEvents, width);
  for (const bin of bins) {
    const x = (bin.index / binCount) * width;
    const binWidth = Math.max(1, (width / binCount) + 0.35);
    for (const lane of [TRAJECTORY_LANES.INPUT, TRAJECTORY_LANES.MODEL, TRAJECTORY_LANES.TOOLS]) {
      const count = bin[lane];
      if (!count) continue;
      context.globalAlpha = Math.min(0.95, 0.24 + (Math.log2(count + 1) * 0.2));
      context.fillStyle = trajectoryLaneColor(lane);
      context.fillRect(x, laneCenterY(lane, height) - 3, binWidth, 6);
    }
    if (bin.other) {
      context.globalAlpha = Math.min(0.9, 0.35 + (Math.log2(bin.other + 1) * 0.16));
      context.fillStyle = trajectoryLaneColor(TRAJECTORY_LANES.OTHER);
      context.fillRect(x, 5, Math.max(1, binWidth), Math.max(1, height - 10));
    }
  }
  context.globalAlpha = 1;
  return { mode, renderedItemCount: bins.length };
}

function renderTrajectoryOverview(documentRef, model, options) {
  const overview = documentRef.createElement('section');
  overview.className = 'trajectoryOverview';
  overview.setAttribute('aria-label', options.labels.overview);

  const header = documentRef.createElement('header');
  header.className = 'trajectoryOverviewHeader';
  const heading = documentRef.createElement('div');
  heading.className = 'trajectoryOverviewHeading';
  appendTextElement(documentRef, heading, 'trajectoryOverviewTitle', options.labels.sequence);
  const status = appendTextElement(
    documentRef,
    heading,
    'trajectoryOverviewStatus',
    options.loadedStatus || options.labels.loadedSequence,
  );
  status.setAttribute('aria-live', 'polite');

  const headerActions = documentRef.createElement('div');
  headerActions.className = 'trajectoryOverviewHeaderActions';
  appendTextElement(documentRef, headerActions, 'trajectoryOverviewHint', options.labels.overviewHint);
  const zoomControls = documentRef.createElement('div');
  zoomControls.className = 'trajectoryZoomControls';
  zoomControls.setAttribute('role', 'group');
  zoomControls.setAttribute('aria-label', options.labels.fitSequence);
  const scale = appendTextElement(
    documentRef,
    zoomControls,
    'trajectoryZoomScale',
    options.labels.fitAll,
  );
  scale.setAttribute('aria-live', 'polite');
  const createZoomButton = (action, text, label) => {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.dataset.trajectorySequenceZoom = action;
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    zoomControls.append(button);
    return button;
  };
  const zoomOut = createZoomButton('out', '−', options.labels.zoomOut);
  const zoomIn = createZoomButton('in', '+', options.labels.zoomIn);
  const fit = createZoomButton('fit', options.labels.fitAll, options.labels.fitSequence);
  headerActions.append(zoomControls);
  header.append(heading, headerActions);

  const body = documentRef.createElement('div');
  body.className = 'trajectoryOverviewBody';
  const labels = documentRef.createElement('div');
  labels.className = 'trajectoryOverviewLabels';
  labels.setAttribute('aria-hidden', 'true');
  appendTextElement(documentRef, labels, '', options.labels.input);
  appendTextElement(documentRef, labels, '', options.labels.model);
  appendTextElement(documentRef, labels, '', options.labels.tools);

  const viewport = documentRef.createElement('div');
  viewport.className = 'trajectoryOverviewViewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'group');
  viewport.setAttribute('aria-label', options.labels.overviewSelect);
  viewport.title = options.labels.panSequence;
  const plot = documentRef.createElement('div');
  plot.className = 'trajectoryOverviewPlot';
  const canvas = documentRef.createElement('canvas');
  canvas.className = 'trajectoryOverviewCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  const locator = documentRef.createElement('div');
  locator.className = 'trajectoryOverviewLocator';
  locator.setAttribute('aria-hidden', 'true');
  locator.hidden = true;
  plot.append(canvas, locator);
  viewport.append(plot);
  body.append(labels, viewport);
  overview.append(header, body);

  const view = documentRef.defaultView;
  const viewState = options.viewState && typeof options.viewState === 'object'
    ? options.viewState
    : {};
  let zoom = TRAJECTORY_SEQUENCE_ZOOM_LEVELS.includes(viewState.zoom) ? viewState.zoom : 1;
  let disposed = false;
  let mounted = false;
  let selectedEventId = options.selectedEventId || '';
  let settleFrame = 0;
  let pointerId = null;
  let pointerStartX = 0;
  let pointerStartScrollLeft = 0;
  let pointerMoved = false;
  let suppressClick = false;
  plot.style.width = `${zoom * 100}%`;

  const selectedProjectedEvent = () => model.projectedEvents.find(
    (event) => event.eventId === selectedEventId,
  ) || null;
  const maxScrollLeft = () => Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const clampScrollLeft = (value) => Math.max(0, Math.min(maxScrollLeft(), Number(value) || 0));
  const rememberScroll = () => {
    viewState.zoom = zoom;
    viewState.scrollLeft = viewport.scrollLeft;
  };
  const ensureSelectionVisible = () => {
    const selected = selectedProjectedEvent();
    if (!mounted || !selected || viewport.scrollWidth <= viewport.clientWidth) return false;
    const position = trajectoryEventFraction(selected.index, model.projectedEvents.length)
      * plot.getBoundingClientRect().width;
    const left = viewport.scrollLeft;
    const right = left + viewport.clientWidth;
    const margin = Math.min(28, viewport.clientWidth * 0.08);
    if (position >= left + margin && position <= right - margin) return true;
    viewport.scrollLeft = clampScrollLeft(position - (viewport.clientWidth / 2));
    rememberScroll();
    return true;
  };
  const syncSelection = (eventId) => {
    const selectionChanged = selectedEventId !== (eventId || '');
    selectedEventId = eventId || '';
    const selected = selectedProjectedEvent();
    locator.hidden = !selected;
    if (!selected) {
      locator.removeAttribute('data-trajectory-overview-selected-id');
      locator.removeAttribute('data-lane');
      return false;
    }
    locator.dataset.trajectoryOverviewSelectedId = selected.eventId;
    locator.dataset.lane = selected.lane;
    locator.style.left = `${trajectoryEventFraction(selected.index, model.projectedEvents.length) * 100}%`;
    locator.title = `${options.labels.selectedEvent}: ${selected.type}`;
    if (selectionChanged) ensureSelectionVisible();
    return true;
  };
  const syncZoomControls = () => {
    overview.dataset.sequenceZoom = String(zoom);
    plot.dataset.sequenceZoom = String(zoom);
    scale.textContent = zoom === 1 ? options.labels.fitAll : `${zoom}×`;
    zoomOut.disabled = zoom === TRAJECTORY_SEQUENCE_ZOOM_LEVELS[0];
    zoomIn.disabled = zoom === TRAJECTORY_SEQUENCE_ZOOM_LEVELS.at(-1);
    fit.disabled = zoom === TRAJECTORY_SEQUENCE_ZOOM_LEVELS[0];
    fit.setAttribute('aria-pressed', zoom === 1 ? 'true' : 'false');
  };
  const draw = () => {
    if (disposed || !plot.isConnected) return false;
    const width = Math.max(1, Math.round(plot.getBoundingClientRect().width || viewport.clientWidth || 1));
    const height = Math.max(1, Math.round(canvas.getBoundingClientRect().height || 72));
    const result = drawTrajectoryOverview(canvas, model.projectedEvents, width, height);
    canvas.dataset.renderMode = result.mode;
    canvas.dataset.renderedItemCount = String(result.renderedItemCount);
    canvas.dataset.eventCount = String(model.projectedEvents.length);
    canvas.dataset.plotWidth = String(width);
    return true;
  };
  const settleLayout = (callback) => {
    if (settleFrame) view?.cancelAnimationFrame?.(settleFrame);
    const settle = () => {
      settleFrame = 0;
      if (disposed) return;
      draw();
      callback?.();
      rememberScroll();
    };
    if (typeof view?.requestAnimationFrame === 'function') {
      settleFrame = view.requestAnimationFrame(settle);
    } else {
      settle();
    }
  };
  const setZoom = (nextZoom, fitSequence = false) => {
    if (!TRAJECTORY_SEQUENCE_ZOOM_LEVELS.includes(nextZoom)) return false;
    const oldPlotWidth = Math.max(1, plot.getBoundingClientRect().width || viewport.scrollWidth || 1);
    const selected = selectedProjectedEvent();
    const selectedFraction = selected
      ? trajectoryEventFraction(selected.index, model.projectedEvents.length)
      : null;
    const centerFraction = Math.max(0, Math.min(
      1,
      (viewport.scrollLeft + (viewport.clientWidth / 2)) / oldPlotWidth,
    ));
    const anchorFraction = zoom === 1 && nextZoom > 1 && selectedFraction !== null
      ? selectedFraction
      : centerFraction;
    zoom = nextZoom;
    viewState.zoom = zoom;
    plot.style.width = `${zoom * 100}%`;
    syncZoomControls();
    settleLayout(() => {
      viewport.scrollLeft = fitSequence
        ? 0
        : clampScrollLeft((anchorFraction * plot.getBoundingClientRect().width) - (viewport.clientWidth / 2));
    });
    return true;
  };
  const selectAt = (fraction, lane) => {
    const index = nearestTrajectoryOverviewEventIndex(model.projectedEvents, fraction, lane);
    if (index < 0) return false;
    options.onSelect?.(model.projectedEvents[index].event);
    return true;
  };

  zoomOut.addEventListener('click', () => setZoom(trajectorySequenceZoomStep(zoom, 'out')));
  zoomIn.addEventListener('click', () => setZoom(trajectorySequenceZoomStep(zoom, 'in')));
  fit.addEventListener('click', () => setZoom(1, true));
  canvas.addEventListener('click', (event) => {
    if (suppressClick) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    selectAt(
      (event.clientX - bounds.left) / bounds.width,
      overviewLaneFromY(event.clientY - bounds.top, bounds.height),
    );
  });
  viewport.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (!model.projectedEvents.length) return;
    const selected = selectedProjectedEvent();
    let index = selected?.index ?? 0;
    if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    if (event.key === 'ArrowRight') index = Math.min(model.projectedEvents.length - 1, index + 1);
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = model.projectedEvents.length - 1;
    event.preventDefault();
    event.stopPropagation();
    options.onSelect?.(model.projectedEvents[index].event);
  });
  viewport.addEventListener('scroll', rememberScroll, { passive: true });
  viewport.addEventListener('wheel', (event) => {
    const maximum = maxScrollLeft();
    if (maximum <= 0) return;
    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const next = Math.max(0, Math.min(maximum, viewport.scrollLeft + delta));
    event.preventDefault();
    event.stopPropagation();
    if (next === viewport.scrollLeft) return;
    viewport.scrollLeft = next;
    rememberScroll();
  }, { passive: false });

  const finishPointerPan = (event) => {
    if (pointerId === null || (event && event.pointerId !== pointerId)) return;
    const activePointerId = pointerId;
    pointerId = null;
    try {
      viewport.releasePointerCapture?.(activePointerId);
    } catch {}
    suppressClick = pointerMoved;
    if (suppressClick) view?.requestAnimationFrame?.(() => { suppressClick = false; });
    pointerMoved = false;
    viewport.classList.remove('panning');
    rememberScroll();
  };
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || maxScrollLeft() <= 0 || event.target?.closest?.('button')) return;
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartScrollLeft = viewport.scrollLeft;
    pointerMoved = false;
    viewport.setPointerCapture?.(pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const delta = event.clientX - pointerStartX;
    if (Math.abs(delta) > 3) {
      pointerMoved = true;
      viewport.classList.add('panning');
    }
    if (!pointerMoved) return;
    event.preventDefault();
    viewport.scrollLeft = clampScrollLeft(pointerStartScrollLeft - delta);
    rememberScroll();
  });
  viewport.addEventListener('pointerup', finishPointerPan);
  viewport.addEventListener('pointercancel', finishPointerPan);
  viewport.addEventListener('lostpointercapture', finishPointerPan);

  const ResizeObserverType = view?.ResizeObserver;
  const resizeObserver = typeof ResizeObserverType === 'function'
    ? new ResizeObserverType(() => draw())
    : null;
  return {
    node: overview,
    mount() {
      mounted = true;
      syncSelection(selectedEventId);
      syncZoomControls();
      draw();
      resizeObserver?.observe(viewport);
      settleLayout(() => {
        viewport.scrollLeft = clampScrollLeft(viewState.scrollLeft);
      });
    },
    syncSelection,
    draw,
    dispose() {
      disposed = true;
      mounted = false;
      if (settleFrame) view?.cancelAnimationFrame?.(settleFrame);
      resizeObserver?.disconnect();
    },
  };
}

function renderTrajectoryPresentation({
  root,
  events,
  selectedEventId = '',
  loadedEventCount,
  totalEventCount,
  loadedStatus = '',
  viewState = null,
  displayStateForEvent,
  labels: labelOverrides = {},
  expandedGroupIds = new Set(),
  onGroupToggle,
  onGroupMaterialized,
  onSelect,
}) {
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('Trajectory root must be a DOM element');
  }
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const model = buildTrajectoryPresentation(events, {
    displayStateForEvent,
    eventLabel: labels.event,
  });
  const documentRef = root.ownerDocument || document;
  const shell = documentRef.createElement('section');
  shell.className = 'trajectoryPresentation';
  shell.setAttribute('aria-label', labels.region);
  shell.dataset.eventCount = String(model.projectedEvents.length);
  root.classList.add('trajectoryPresentationRoot');

  let overviewController = null;
  if (!model.projectedEvents.length) {
    const notice = documentRef.createElement('p');
    notice.className = 'trajectoryEmpty';
    notice.textContent = labels.empty;
    shell.append(notice);
  } else {
    overviewController = renderTrajectoryOverview(documentRef, model, {
      labels,
      selectedEventId,
      loadedEventCount,
      totalEventCount,
      loadedStatus,
      viewState,
      onSelect,
    });
    shell.append(overviewController.node, renderTrajectoryNarrative(documentRef, model, {
      labels,
      selectedEventId,
      expandedGroupIds,
      onGroupToggle,
      onGroupMaterialized,
      onSelect,
    }));
  }
  disposeTrajectoryPresentation(root);
  root.replaceChildren(shell);
  root.__trajectoryOverviewController = overviewController;
  overviewController?.mount();
  return model;
}

function disposeTrajectoryPresentation(root) {
  root?.__trajectoryOverviewController?.dispose?.();
  if (root) root.__trajectoryOverviewController = null;
}

function trajectoryGroupForEvent(root, eventId) {
  return [...(root?.querySelectorAll?.('[data-trajectory-tool-group-id]') || [])]
    .find((group) => group.__trajectoryEventIds?.has(eventId)) || null;
}

function revealTrajectoryEvent(root, eventId, options = {}) {
  if (!root?.querySelector) return false;
  let node = root.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`);
  if (!node) {
    const group = trajectoryGroupForEvent(root, eventId);
    if (group) {
      group.open = true;
      group.__trajectoryEnsureChildren?.();
      node = root.querySelector(`[data-trajectory-event-id="${CSS.escape(eventId)}"]`);
    }
  }
  if (!node) return false;
  if (options.scroll && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ block: 'center', behavior: options.behavior || 'smooth' });
  }
  return true;
}

function syncTrajectorySelection(root, selectedEventId) {
  if (!root?.querySelectorAll) return false;
  if (selectedEventId) revealTrajectoryEvent(root, selectedEventId);
  let found = false;
  for (const eventNode of root.querySelectorAll('[data-trajectory-event-id]')) {
    const selected = eventNode.dataset.trajectoryEventId === selectedEventId;
    applyTrajectorySelection(eventNode, selected);
    if (selected) found = true;
  }
  root.__trajectoryOverviewController?.syncSelection?.(selectedEventId);
  return found;
}

module.exports = {
  DEFAULT_LABELS,
  TRAJECTORY_DISPLAY_STATES,
  TRAJECTORY_ITEM_KINDS,
  TRAJECTORY_LANES,
  TRAJECTORY_MARKER_MIN_PX,
  TRAJECTORY_SEQUENCE_ZOOM_LEVELS,
  buildTrajectoryDensityBins,
  buildTrajectoryNarrativeFromProjected,
  buildTrajectoryOverview,
  buildTrajectoryPresentation,
  compactTrajectoryText,
  disposeTrajectoryPresentation,
  nearestTrajectoryEventIndex,
  nearestTrajectoryOverviewEventIndex,
  projectTrajectoryEvents,
  reliableTrajectoryTurnId,
  renderTrajectoryPresentation,
  revealTrajectoryEvent,
  syncTrajectorySelection,
  trajectoryEventFraction,
  trajectoryEventIdsFromNarrative,
  trajectoryEventPreview,
  trajectoryEventType,
  trajectoryLaneForEvent,
  trajectoryOverviewRenderMode,
  trajectorySequenceZoomStep,
  trajectoryToolName,
};
