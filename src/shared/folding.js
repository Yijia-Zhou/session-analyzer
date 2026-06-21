(function initFolding(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionFolding = api;
}(typeof globalThis !== 'undefined' ? globalThis : window, function createFoldingApi() {
  'use strict';

  const DISPLAY_STATES = ['expanded', 'summary', 'collapsed', 'hidden'];
  const CONDITION_DISPLAY_STATES = ['expanded', 'summary'];
  const DISPLAY_STATE_PRIORITY = {
    hidden: 0,
    collapsed: 1,
    summary: 2,
    expanded: 3,
  };

  const EDITABLE_EVENT_KINDS = [
    'user_message',
    'assistant_message',
    'proposed_plan',
    'reasoning',
    'command',
    'patch',
    'mcp_call',
    'js_repl',
    'other_tool_call',
    'web_search',
    'goal',
    'hook',
    'developer_message',
    'error',
    'warning',
    'abort',
    'rollback',
    'compaction',
    'usage_limit_warning',
    'subagent',
    'review',
  ];

  const EDITABLE_KIND_GROUPS = [
    {
      id: 'conversationPlanning',
      priority: 10,
      kindOrder: [
        'user_message',
        'assistant_message',
        'proposed_plan',
        'plan_update',
        'goal',
      ],
    },
    {
      id: 'commonWork',
      priority: 20,
      kindOrder: [
        'command',
        'user_shell_command',
        'patch',
        'web_search',
      ],
    },
    {
      id: 'issuesRisks',
      priority: 30,
      kindOrder: [
        'error',
        'warning',
      ],
    },
    {
      id: 'toolsAndInternals',
      priority: 80,
      kindOrder: [
        'reasoning',
        'mcp_call',
        'js_repl',
        'other_tool_call',
        'hook',
        'developer_message',
        'review',
        'subagent',
        'abort',
        'rollback',
        'compaction',
        'usage_limit_warning',
      ],
    },
    {
      id: 'other',
      priority: 100,
      kindOrder: [],
    },
  ];

  const KIND_GROUP_BY_KIND = new Map();
  for (const group of EDITABLE_KIND_GROUPS) {
    group.kindOrder.forEach((kind, index) => {
      KIND_GROUP_BY_KIND.set(kind, { groupId: group.id, groupPriority: group.priority, kindPriority: index });
    });
  }

  function editableKindGroup(kind) {
    return KIND_GROUP_BY_KIND.get(kind) || {
      groupId: 'other',
      groupPriority: 100,
      kindPriority: Number.MAX_SAFE_INTEGER,
    };
  }

  const CONDITION_DEFINITIONS = [
    {
      id: 'searchHit',
      name: 'Search hit',
      description: 'Events matching the current search query.',
    },
    {
      id: 'importantEvent',
      name: 'Important event',
      description: 'User/assistant messages, patches, goals, errors, aborts, rollbacks, compactions, plans, plan updates, update_plan calls, failed events, and abnormal severity.',
    },
    {
      id: 'updatePlanCall',
      name: 'update_plan call',
      description: 'Calls to the update_plan tool and protocol plan updates.',
    },
    {
      id: 'userInputRequest',
      name: 'User input request',
      description: 'Calls to request_user_input that collect user choices during a conversation.',
    },
    {
      id: 'readableReasoning',
      name: 'Readable reasoning',
      description: 'Reasoning entries that contain readable text in the Main timeline.',
    },
    {
      id: 'failedStatus',
      name: 'Failed status',
      description: 'Events whose status is failed.',
    },
    {
      id: 'errorSeverity',
      name: 'Error severity',
      description: 'Events whose severity is error.',
    },
    {
      id: 'abnormalSeverity',
      name: 'Abnormal severity',
      description: 'Events whose severity is not normal.',
    },
    {
      id: 'reviewCommand',
      name: 'Review command',
      description: 'Command previews containing common verification or source-control review terms.',
    },
    {
      id: 'touchedFiles',
      name: 'Touched files',
      description: 'Events that reference changed or touched files.',
    },
  ];

  const CONDITION_IDS = new Set(CONDITION_DEFINITIONS.map((condition) => condition.id));

  function isUpdatePlanEvent(event = {}) {
    return event.kind === 'plan_update'
      || event.toolName === 'update_plan'
      || event.subtype === 'update_plan'
      || event.label === 'update_plan';
  }

  function isUserInputRequestEvent(event = {}) {
    return event.toolName === 'request_user_input'
      || event.subtype === 'request_user_input'
      || event.label === 'request_user_input';
  }

  function moreVisibleState(left, right) {
    return DISPLAY_STATE_PRIORITY[left] >= DISPLAY_STATE_PRIORITY[right] ? left : right;
  }

  function normalizeRules(rules) {
    const source = rules && typeof rules === 'object' ? rules : {};
    const kindStates = Object.create(null);
    for (const [kind, display] of Object.entries(source.kindStates || {}).sort(([left], [right]) => left.localeCompare(right))) {
      if (DISPLAY_STATES.includes(display)) kindStates[kind] = display;
    }
    const fallback = DISPLAY_STATES.includes(source.fallback) ? source.fallback : 'summary';
    const conditionStates = new Map();
    for (const condition of Array.isArray(source.conditions) ? source.conditions : []) {
      const id = String(condition?.id || '');
      const display = condition?.state;
      if (!CONDITION_IDS.has(id) || !CONDITION_DISPLAY_STATES.includes(display)) continue;
      conditionStates.set(id, conditionStates.has(id) ? moreVisibleState(conditionStates.get(id), display) : display);
    }
    const conditions = CONDITION_DEFINITIONS
      .filter((condition) => conditionStates.has(condition.id))
      .map((condition) => ({ id: condition.id, state: conditionStates.get(condition.id) }));
    return { kindStates, fallback, conditions };
  }

  function importantEvent(event = {}) {
    return ['user_message', 'assistant_message', 'patch', 'goal', 'error', 'warning', 'abort', 'rollback', 'compaction', 'proposed_plan', 'review'].includes(event.kind)
      || isUpdatePlanEvent(event)
      || event.severity !== 'normal'
      || event.status === 'failed';
  }

  function conditionMatches(conditionId, event = {}) {
    if (conditionId === 'searchHit') return Boolean(event.hasSearchHit);
    if (conditionId === 'importantEvent') return importantEvent(event);
    if (conditionId === 'updatePlanCall') return isUpdatePlanEvent(event);
    if (conditionId === 'userInputRequest') return isUserInputRequestEvent(event);
    if (conditionId === 'readableReasoning') return event.kind === 'reasoning' && Boolean(event.hasReadableReasoning);
    if (conditionId === 'failedStatus') return event.status === 'failed';
    if (conditionId === 'errorSeverity') return event.severity === 'error';
    if (conditionId === 'abnormalSeverity') return event.severity !== 'normal';
    if (conditionId === 'reviewCommand') return event.kind === 'command' && /\b(test|tests|build|lint|typecheck|check|compile|compileall|pytest|unittest|vitest|jest|mocha|ruff|eslint|biome|tsc|mypy|pyright|clippy|vet|git|diff|status)\b/i.test(event.preview || '');
    if (conditionId === 'touchedFiles') return Boolean(event.touchedFiles?.length);
    return false;
  }

  function displayStateFromRules(event = {}, rules) {
    const normalized = normalizeRules(rules);
    const matches = [];
    if (Object.hasOwn(normalized.kindStates, event.kind)) matches.push(normalized.kindStates[event.kind]);
    for (const condition of normalized.conditions) {
      if (conditionMatches(condition.id, event)) matches.push(condition.state);
    }
    return matches.reduce(moreVisibleState, null) || normalized.fallback;
  }

  function normalizeOverrides(overrides) {
    const normalized = Object.create(null);
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return normalized;
    for (const [sessionId, eventStates] of Object.entries(overrides)) {
      if (!eventStates || typeof eventStates !== 'object' || Array.isArray(eventStates)) continue;
      const validEventStates = Object.create(null);
      for (const [eventId, display] of Object.entries(eventStates)) {
        if (DISPLAY_STATES.includes(display)) validEventStates[eventId] = display;
      }
      if (Object.keys(validEventStates).length) normalized[sessionId] = validEventStates;
    }
    return normalized;
  }

  return {
    DISPLAY_STATES,
    CONDITION_DISPLAY_STATES,
    DISPLAY_STATE_PRIORITY,
    EDITABLE_EVENT_KINDS,
    EDITABLE_KIND_GROUPS,
    editableKindGroup,
    CONDITION_DEFINITIONS,
    isUpdatePlanEvent,
    isUserInputRequestEvent,
    normalizeRules,
    conditionMatches,
    displayStateFromRules,
    normalizeOverrides,
  };
}));
