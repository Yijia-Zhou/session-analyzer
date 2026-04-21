'use strict';

const foldingProfiles = [
  {
    id: 'narrative',
    name: '叙事时间线',
    description: '展开用户意图、关键回复、错误和改动摘要，折叠 reasoning 与长工具输出。',
  },
  {
    id: 'debug',
    name: '问题排查',
    description: '突出错误、失败命令、stderr、abort、rollback 和异常工具结果。',
  },
  {
    id: 'changes',
    name: '改动审查',
    description: '突出 patch、触达文件、测试构建命令和与代码修改相关的回复。',
  },
  {
    id: 'search',
    name: '搜索聚焦',
    description: '展开搜索命中和相邻关键事件，压缩非命中事件。',
  },
  {
    id: 'conversation',
    name: '对话阅读',
    description: '展开用户与助手消息，弱化工具内部细节。',
  },
  {
    id: 'tools',
    name: '工具调试',
    description: '展开 shell、patch、MCP、web/search 调用摘要和状态。',
  },
  {
    id: 'context',
    name: '上下文/成本',
    description: '突出 token、compact、turn boundary、rollback 和 subagent 事件。',
  },
  {
    id: 'compact',
    name: '完整紧凑',
    description: '所有事件保留在时间线上，正文默认一行预览。',
  },
];

module.exports = { foldingProfiles };

