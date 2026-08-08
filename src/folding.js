'use strict';

const folding = require('./shared/folding');

function profileRules(kindStates, fallback, conditions = []) {
  return { kindStates, codeModeRequestStates: {}, fallback, conditions };
}

const foldingProfiles = [
  {
    id: 'narrative',
    name: '叙事时间线',
    description: '类似在开发时看到的内容，适合想快速回忆这段开发到底发生了什么：目标怎么提出、过程如何推进、最后得到什么结果。',
    rules: profileRules(
      {
        user_message: 'expanded',
        assistant_message: 'expanded',
        patch: 'expanded',
        error: 'expanded',
        abort: 'expanded',
        rollback: 'expanded',
        compaction: 'expanded',
        review: 'expanded',
        goal: 'expanded',
        hook: 'summary',
        proposed_plan: 'expanded',
        reasoning: 'collapsed',
        command: 'collapsed',
        mcp_call: 'collapsed',
        js_repl: 'collapsed',
        other_tool_call: 'collapsed',
        web_search: 'collapsed',
        usage_limit_warning: 'collapsed',
      },
      'summary',
      [
        { id: 'abnormalSeverity', state: 'expanded' },
        { id: 'failedStatus', state: 'expanded' },
      ],
    ),
  },
  {
    id: 'conversation',
    name: '对话阅读',
    description: '先只看自然语言内容：需求提出和细化过程、agent报告的执行计划和结果，暂时跳过工具及代码细节。',
    rules: profileRules(
      {
        user_message: 'expanded',
        assistant_message: 'expanded',
        proposed_plan: 'expanded',
        goal: 'expanded',
        error: 'summary',
        abort: 'summary',
        rollback: 'summary',
        compaction: 'expanded',
      },
      'hidden',
      [
        { id: 'updatePlanCall', state: 'expanded' },
        { id: 'userInputRequest', state: 'expanded' },
        { id: 'readableReasoning', state: 'summary' },
      ],
    ),
  },
  {
    id: 'changes',
    name: '改动审查',
    description: '聚焦文件改动：动了哪些文件、做了哪些修改、有没有进行相应审查和验证。',
    rules: profileRules(
      {
        patch: 'expanded',
        review: 'summary',
        proposed_plan: 'collapsed',
        user_message: 'collapsed',
        assistant_message: 'collapsed',
      },
      'hidden',
      [
        { id: 'reviewCommand', state: 'summary' },
        { id: 'touchedFiles', state: 'collapsed' },
        { id: 'failedStatus', state: 'collapsed' },
      ],
    ),
  },
  {
    id: 'debug',
    name: '错误聚焦',
    description: '聚焦工具调用等流程中的失败、报错和中断点，看当前工作流是否存在易错模式。',
    rules: profileRules(
      {
        error: 'expanded',
        warning: 'summary',
        abort: 'summary',
        rollback: 'summary',
      },
      'hidden',
      [
        { id: 'errorSeverity', state: 'expanded' },
        { id: 'failedStatus', state: 'expanded' },
        { id: 'abnormalSeverity', state: 'summary' },
      ],
    ),
  },
  {
    id: 'planning',
    name: '计划阅读',
    description: '适合检查任务是否按预期推进：计划是怎样的、执行到哪一步、哪些意外情况可能改变了下一步。',
    rules: profileRules(
      {
        proposed_plan: 'expanded',
        goal: 'expanded',
        user_message: 'collapsed',
        assistant_message: 'collapsed',
        reasoning: 'collapsed',
        command: 'collapsed',
        user_shell_command: 'collapsed',
        patch: 'collapsed',
        mcp_call: 'collapsed',
        js_repl: 'collapsed',
        other_tool_call: 'collapsed',
        web_search: 'collapsed',
        error: 'collapsed',
        warning: 'collapsed',
        abort: 'collapsed',
        rollback: 'collapsed',
        compaction: 'collapsed',
        usage_limit_warning: 'collapsed',
        review: 'collapsed',
        hook: 'collapsed',
        subagent: 'collapsed',
      },
      'hidden',
      [
        { id: 'updatePlanCall', state: 'expanded' },
      ],
    ),
  },
  {
    id: 'search',
    name: '搜索聚焦',
    description: '适合带着关键词阅读；有搜索结果时优先聚焦命中片段，避免被其它内容干扰。',
    rules: profileRules(
      {},
      'hidden',
      [
        { id: 'searchHit', state: 'expanded' },
        { id: 'importantEvent', state: 'collapsed' },
      ],
    ),
  },
  {
    id: 'compact',
    name: '完整紧凑',
    description: '适合担心漏掉细节时扫完整个过程，所有事件都保留，但默认折叠到最省空间。',
    rules: profileRules({}, 'collapsed'),
  },
].map((profile) => ({
  ...profile,
  rules: folding.normalizeRules(profile.rules),
}));

module.exports = {
  ...folding,
  foldingProfiles,
};
