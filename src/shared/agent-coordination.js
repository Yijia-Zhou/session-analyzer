(function initAgentCoordination(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionAgentCoordination = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAgentCoordinationApi() {
  'use strict';

  const AGENT_COORDINATION_KIND = 'agent_coordination';
  const AGENT_COORDINATION_TOOLS = Object.freeze({
    spawn_agent: Object.freeze({ action: 'spawn', title: 'Spawn subagent', previewFields: Object.freeze(['task_name', 'message']) }),
    list_agents: Object.freeze({ action: 'observe', title: 'List subagents', previewFields: Object.freeze(['path_prefix']) }),
    wait_agent: Object.freeze({ action: 'wait', title: 'Wait for subagent', previewFields: Object.freeze(['targets', 'target', 'timeout_ms']) }),
    send_message: Object.freeze({ action: 'communicate', title: 'Send message to subagent', previewFields: Object.freeze(['target', 'message']) }),
    send_input: Object.freeze({ action: 'communicate', title: 'Send input to subagent', previewFields: Object.freeze(['target', 'message']) }),
    followup_task: Object.freeze({ action: 'delegate', title: 'Delegate follow-up task', previewFields: Object.freeze(['target', 'message']) }),
    interrupt_agent: Object.freeze({ action: 'control', title: 'Interrupt subagent', previewFields: Object.freeze(['target']) }),
    close_agent: Object.freeze({ action: 'control', title: 'Close subagent', previewFields: Object.freeze(['target']) }),
  });

  function agentCoordinationDefinition(toolName) {
    const key = String(toolName || '').trim();
    return Object.hasOwn(AGENT_COORDINATION_TOOLS, key) ? AGENT_COORDINATION_TOOLS[key] : null;
  }

  function isAgentCoordinationTool(toolName) {
    return Boolean(agentCoordinationDefinition(toolName));
  }

  function agentCoordinationToolNames() {
    return Object.keys(AGENT_COORDINATION_TOOLS);
  }

  return {
    AGENT_COORDINATION_KIND,
    AGENT_COORDINATION_TOOLS,
    agentCoordinationDefinition,
    agentCoordinationToolNames,
    isAgentCoordinationTool,
  };
}));
