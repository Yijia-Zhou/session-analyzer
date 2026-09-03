'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRAJECTORY_ITEM_KINDS,
  TRAJECTORY_LANES,
  TRAJECTORY_SEQUENCE_ZOOM_LEVELS,
  buildTrajectoryDensityBins,
  buildTrajectoryPresentation,
  compactTrajectoryText,
  nearestTrajectoryEventIndex,
  projectTrajectoryEvents,
  reliableTrajectoryTurnId,
  trajectoryEventFraction,
  trajectoryEventIdsFromNarrative,
  trajectoryLaneForEvent,
  trajectoryOverviewRenderMode,
  trajectorySequenceZoomStep,
} = require('../src/browser/trajectory-presentation');

test('trajectory lane classification is source-neutral and unknown Main events stay visible', () => {
  const cases = [
    [{ kind: 'user_message' }, TRAJECTORY_LANES.INPUT],
    [{ kind: 'developer_message' }, TRAJECTORY_LANES.INPUT],
    [{ kind: 'user_shell_command', toolName: 'shell' }, TRAJECTORY_LANES.INPUT],
    [{ kind: 'assistant_message' }, TRAJECTORY_LANES.MODEL],
    [{ kind: 'reasoning' }, TRAJECTORY_LANES.MODEL],
    [{ kind: 'proposed_plan' }, TRAJECTORY_LANES.MODEL],
    [{ kind: 'plan_update' }, TRAJECTORY_LANES.MODEL],
    [{ kind: 'goal' }, TRAJECTORY_LANES.MODEL],
    [{ kind: 'command' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'read' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'patch' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'mcp_call' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'code_mode_operation' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'background_command' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'async_agent' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'async_workflow' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'future_kind', subtype: 'web_search' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'future_kind', toolName: 'future_tool' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'future_kind', role: 'assistant' }, TRAJECTORY_LANES.MODEL],
    [{ kind: 'future_kind', role: 'assistant', toolName: 'future_tool' }, TRAJECTORY_LANES.TOOLS],
    [{ kind: 'future_kind', role: 'human' }, TRAJECTORY_LANES.INPUT],
    [{ kind: 'review' }, TRAJECTORY_LANES.OTHER],
    [{ kind: 'future_kind' }, TRAJECTORY_LANES.OTHER],
  ];
  for (const [event, expected] of cases) {
    for (const sourceKind of ['codex', 'claude-code', 'deepseek-harness']) {
      assert.equal(trajectoryLaneForEvent({ ...event, sourceKind }), expected);
    }
  }
});

test('trajectory projection validates stable individual identity without mutating canonical events', () => {
  const events = [
    { id: 'u', kind: 'user_message', preview: 'hello' },
    { id: 'a', kind: 'assistant_message', preview: 'world' },
  ];
  const snapshot = structuredClone(events);
  const projected = projectTrajectoryEvents(events, {
    displayStateForEvent: (event) => (event.id === 'u' ? 'expanded' : 'not-a-state'),
  });

  assert.deepEqual(events, snapshot);
  assert.equal(projected[0].event, events[0]);
  assert.equal(projected[0].displayState, 'expanded');
  assert.equal(projected[1].displayState, 'summary');
  assert.ok(Object.isFrozen(projected));
  assert.ok(projected.every(Object.isFrozen));
  assert.throws(() => projectTrajectoryEvents([{}]), /must have an ID/);
  assert.throws(() => projectTrajectoryEvents([{ id: 'same' }, { id: 'same' }]), /must be unique/);
  assert.throws(() => projectTrajectoryEvents([null]), /must be an object/);
});

test('trajectory narrative preserves order through reversible non-causal tool groups', () => {
  const events = [
    { id: 'u-1', kind: 'user_message', turnId: 'turn:1' },
    { id: 'a-1', kind: 'assistant_message', turnId: 'turn:1' },
    { id: 't-1', kind: 'command', toolName: 'pwsh', turnId: 'turn:1' },
    { id: 't-2', kind: 'patch', toolName: 'edit', turnId: 'turn:1', status: 'failed' },
    { id: 'hidden-break', kind: 'warning', turnId: 'turn:1' },
    { id: 't-3', kind: 'read', toolName: 'read', turnId: 'turn:1' },
    { id: 't-4', kind: 'web_search', toolName: 'web', turnId: 'turn:2' },
    { id: 'unknown', kind: 'future_kind' },
  ];
  const model = buildTrajectoryPresentation(events, {
    displayStateForEvent: (event) => (event.id === 'hidden-break' ? 'hidden' : 'collapsed'),
  });

  assert.deepEqual(trajectoryEventIdsFromNarrative(model.narrativeItems), events.map((event) => event.id));
  assert.deepEqual(
    model.narrativeItems
      .filter((item) => item.kind === TRAJECTORY_ITEM_KINDS.TURN_BOUNDARY)
      .map((item) => item.turnId),
    ['turn:1', 'turn:2'],
  );
  const groups = model.narrativeItems.filter((item) => item.kind === TRAJECTORY_ITEM_KINDS.TOOL_GROUP);
  assert.deepEqual(groups.map((group) => group.eventIds), [
    ['t-1', 't-2'],
    ['t-3'],
    ['t-4'],
  ]);
  assert.equal(groups[0].failureCount, 1);
  assert.deepEqual(groups[0].toolNames, ['pwsh', 'edit']);
  for (const group of groups) {
    assert.equal(Object.hasOwn(group, 'parentAssistantId'), false);
    assert.equal(Object.hasOwn(group, 'request'), false);
    assert.equal(Object.hasOwn(group, 'step'), false);
    assert.equal(Object.hasOwn(group, 'duration'), false);
    assert.equal(Object.hasOwn(group, 'rawRefs'), false);
  }
  const unknown = model.narrativeItems.find((item) => item.eventId === 'unknown');
  assert.equal(unknown.kind, TRAJECTORY_ITEM_KINDS.OTHER);
  assert.equal(unknown.event.lane, TRAJECTORY_LANES.OTHER);
});

test('trajectory reliable turn boundaries do not infer missing or redacted ownership', () => {
  assert.equal(reliableTrajectoryTurnId('turn:17'), 'turn:17');
  assert.equal(reliableTrajectoryTurnId(' unknown '), null);
  assert.equal(reliableTrajectoryTurnId('[embedded data URL omitted; see raw refs]'), null);
  assert.equal(reliableTrajectoryTurnId('[redacted]'), null);
  assert.equal(reliableTrajectoryTurnId(''), null);
  assert.equal(reliableTrajectoryTurnId(null), null);

  const model = buildTrajectoryPresentation([
    { id: 'a', kind: 'assistant_message' },
    { id: 't', kind: 'command', turnId: 'unknown' },
    { id: 'b', kind: 'assistant_message', turnId: 'turn:2' },
  ]);
  assert.deepEqual(
    model.narrativeItems
      .filter((item) => item.kind === TRAJECTORY_ITEM_KINDS.TURN_BOUNDARY)
      .map((item) => item.turnId),
    ['turn:2'],
  );
  assert.equal(model.narrativeItems.some((item) => item.turnId === null), false);
});

test('trajectory overview density is pixel-bounded and retains exact identity separately', () => {
  const events = Array.from({ length: 1000 }, (_, index) => ({
    id: `event-${index}`,
    kind: index % 3 === 0 ? 'user_message' : index % 3 === 1 ? 'assistant_message' : 'command',
  }));
  const model = buildTrajectoryPresentation(events);
  const bins = buildTrajectoryDensityBins(model.projectedEvents, 320);

  assert.equal(model.overview.eventCount, 1000);
  assert.deepEqual(model.overview.eventIds, events.map((event) => event.id));
  assert.equal(trajectoryOverviewRenderMode(1000, 900), 'density');
  assert.equal(trajectoryOverviewRenderMode(300, 900), 'markers');
  assert.ok(bins.length <= 320);
  assert.equal(bins.reduce((sum, bin) => sum + bin.eventCount, 0), 1000);
  assert.equal(
    Object.values(model.overview.laneIndexes).reduce((sum, indexes) => sum + indexes.length, 0),
    1000,
  );
});

test('trajectory overview click mapping prefers the requested lane and falls back safely', () => {
  const projected = projectTrajectoryEvents([
    { id: 'u', kind: 'user_message' },
    { id: 'a', kind: 'assistant_message' },
    { id: 't', kind: 'command' },
    { id: 'x', kind: 'future_kind' },
  ]);
  assert.equal(nearestTrajectoryEventIndex(projected, 0.7, TRAJECTORY_LANES.TOOLS), 2);
  assert.equal(nearestTrajectoryEventIndex(projected, 0.99, TRAJECTORY_LANES.INPUT), 0);
  assert.equal(nearestTrajectoryEventIndex(projected, 0.99, 'not-a-lane'), 3);
  assert.equal(nearestTrajectoryEventIndex([], 0.5, TRAJECTORY_LANES.MODEL), -1);
  assert.equal(trajectoryEventFraction(2, 4), 0.625);
  assert.equal(trajectoryEventFraction(4, 4), null);
});

test('trajectory compact text and zoom levels remain bounded presentation helpers', () => {
  assert.equal(compactTrajectoryText(' first\n\nsecond\tthird '), 'first second third');
  assert.equal(compactTrajectoryText('abcdefghij', 6), 'abcde…');
  assert.deepEqual(TRAJECTORY_SEQUENCE_ZOOM_LEVELS, [1, 2, 4, 8, 16]);
  assert.equal(trajectorySequenceZoomStep(1, 'out'), 1);
  assert.equal(trajectorySequenceZoomStep(1, 'in'), 2);
  assert.equal(trajectorySequenceZoomStep(8, 'out'), 4);
  assert.equal(trajectorySequenceZoomStep(16, 'in'), 16);
  assert.equal(trajectorySequenceZoomStep(999, 'in'), 2);
  assert.throws(() => trajectorySequenceZoomStep(1, 'sideways'), /direction/);
});

for (const eventCount of [300, 1000, 1800]) {
  test(`trajectory ${eventCount}-event projection characterizes reversible bounded shape`, (t) => {
    const events = Array.from({ length: eventCount }, (_, index) => {
      const position = index % 12;
      const kind = position === 0
        ? 'user_message'
        : position === 1 || position === 11
          ? 'assistant_message'
          : position === 10
            ? 'future_main_kind'
            : ['command', 'read', 'patch', 'mcp_call'][position % 4];
      return {
        id: `shape-${eventCount}-${index}`,
        kind,
        toolName: kind === 'future_main_kind' ? '' : undefined,
        turnId: `turn:${Math.floor(index / 12)}`,
        preview: `event ${index}`,
      };
    });
    const started = process.hrtime.bigint();
    const model = buildTrajectoryPresentation(events, {
      displayStateForEvent: (_event, index) => (index % 19 === 0 ? 'hidden' : 'collapsed'),
    });
    const bins = buildTrajectoryDensityBins(model.projectedEvents, 720);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.deepEqual(trajectoryEventIdsFromNarrative(model.narrativeItems), events.map((event) => event.id));
    assert.equal(model.overview.eventCount, eventCount);
    assert.ok(bins.length <= 720);
    assert.equal(bins.reduce((sum, bin) => sum + bin.eventCount, 0), eventCount);
    assert.ok(model.narrativeItems.length < eventCount);
    t.diagnostic(JSON.stringify({
      eventCount,
      projectionMs: Number(elapsedMs.toFixed(3)),
      narrativeItemCount: model.narrativeItems.length,
      toolGroupCount: model.narrativeItems.filter((item) => item.kind === 'tool-group').length,
      densityBinCount: bins.length,
    }));
  });
}
