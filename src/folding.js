'use strict';

const DISPLAY_STATES = ['expanded', 'summary', 'collapsed', 'hidden'];

const EDITABLE_EVENT_KINDS = [
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
  'protocol',
  'event',
];

const CONDITION_DEFINITIONS = [
  {
    id: 'searchHit',
    name: 'Search hit',
    description: 'Events matching the current search query.',
  },
  {
    id: 'importantEvent',
    name: 'Important event',
    description: 'User/assistant messages, patches, errors, aborts, rollbacks, compactions, plans, update_plan calls, failed events, and abnormal severity.',
  },
  {
    id: 'updatePlanCall',
    name: 'update_plan call',
    description: 'Calls to the update_plan tool.',
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
    description: 'Command previews containing test, build, lint, typecheck, git, diff, or status.',
  },
  {
    id: 'touchedFiles',
    name: 'Touched files',
    description: 'Events that reference changed or touched files.',
  },
];

function profileRules(kindStates, fallback, conditions = []) {
  return { kindStates, fallback, conditions };
}

const foldingProfiles = [
  {
    id: 'narrative',
    name: '叙事时间线',
    description: '展开用户意图、关键回复、错误和改动摘要，折叠 reasoning 与长工具输出。',
    rules: profileRules(
      {
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
      'summary',
      [
        { id: 'abnormalSeverity', state: 'expanded' },
        { id: 'failedStatus', state: 'expanded' },
      ],
    ),
  },
  {
    id: 'debug',
    name: '问题排查',
    description: '突出错误、失败命令、stderr、abort、rollback 和异常工具结果。',
    rules: profileRules(
      {
        command: 'summary',
        patch: 'summary',
        mcp: 'summary',
        js_repl: 'summary',
        tool_operation: 'summary',
        error: 'summary',
        abort: 'summary',
        rollback: 'summary',
      },
      'collapsed',
      [
        { id: 'errorSeverity', state: 'expanded' },
        { id: 'failedStatus', state: 'expanded' },
      ],
    ),
  },
  {
    id: 'changes',
    name: '改动审查',
    description: '突出 patch、触达文件、测试构建命令和与代码修改相关的回复。',
    rules: profileRules(
      {
        patch: 'expanded',
        plan_artifact: 'expanded',
        user_message: 'collapsed',
        assistant_message: 'collapsed',
      },
      'hidden',
      [
        { id: 'reviewCommand', state: 'summary' },
        { id: 'touchedFiles', state: 'summary' },
      ],
    ),
  },
  {
    id: 'search',
    name: '搜索聚焦',
    description: '展开搜索命中和相邻关键事件，压缩非命中事件。',
    rules: profileRules(
      {},
      'hidden',
      [
        { id: 'searchHit', state: 'expanded' },
        { id: 'importantEvent', state: 'summary' },
      ],
    ),
  },
  {
    id: 'planning',
    name: '计划阅读',
    description: '突出计划产物和计划相关对话，保留失败、错误和改动摘要。',
    rules: profileRules(
      {
        plan_artifact: 'expanded',
        user_message: 'summary',
        assistant_message: 'summary',
        patch: 'summary',
        error: 'summary',
        abort: 'summary',
        rollback: 'summary',
        compaction: 'summary',
      },
      'hidden',
      [
        { id: 'updatePlanCall', state: 'expanded' },
        { id: 'failedStatus', state: 'summary' },
        { id: 'abnormalSeverity', state: 'summary' },
      ],
    ),
  },
  {
    id: 'conversation',
    name: '对话阅读',
    description: '展开用户与助手消息，弱化工具内部细节。',
    rules: profileRules(
      {
        user_message: 'expanded',
        assistant_message: 'expanded',
        plan_artifact: 'expanded',
        error: 'summary',
        abort: 'summary',
        rollback: 'summary',
        compaction: 'summary',
      },
      'hidden',
    ),
  },
  {
    id: 'tools',
    name: '工具调试',
    description: '展开 shell、patch、MCP、web/search 调用摘要和状态。',
    rules: profileRules(
      {
        command: 'summary',
        patch: 'summary',
        mcp: 'summary',
        js_repl: 'summary',
        tool_operation: 'summary',
        web_search: 'summary',
      },
      'collapsed',
      [
        { id: 'abnormalSeverity', state: 'summary' },
      ],
    ),
  },
  {
    id: 'compact',
    name: '完整紧凑',
    description: '所有事件保留在时间线上，正文默认一行预览。',
    rules: profileRules({}, 'collapsed'),
  },
];

module.exports = {
  CONDITION_DEFINITIONS,
  DISPLAY_STATES,
  EDITABLE_EVENT_KINDS,
  foldingProfiles,
};
