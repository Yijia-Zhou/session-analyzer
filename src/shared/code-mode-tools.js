(function initCodeModeTools(root, factory) {
  const agentCoordination = typeof module === 'object' && module.exports
    ? require('./agent-coordination')
    : root.sessionAgentCoordination;
  const api = factory(agentCoordination);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionCodeModeTools = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCodeModeToolsApi(agentCoordination) {
  'use strict';

  const DEFAULT_ORDINARY_KIND = 'other_tool_call';

  function definition(title, ordinaryKind, previewFields) {
    return Object.freeze({
      declared: true,
      title,
      ordinaryKind,
      previewFields: Object.freeze([...previewFields]),
    });
  }

  // This registry owns stable, cross-surface metadata only. Per-tool request
  // sections, result parsing, and dynamic titles remain with their specialized
  // detail renderers.
  const CODE_MODE_TOOL_DEFINITIONS = Object.freeze({
    apply_patch: definition('Apply patch', 'patch', ['patch']),
    create_goal: definition('Create goal', 'goal', ['objective']),
    exec_command: definition('Exec command', 'command', ['command', 'cmd', 'workdir']),
    get_goal: definition('Get goal', 'goal', []),
    image_gen__imagegen: definition('Image generation', DEFAULT_ORDINARY_KIND, ['prompt']),
    list_available_plugins_to_install: definition('List available plugins', DEFAULT_ORDINARY_KIND, []),
    list_mcp_resource_templates: definition('List MCP resource templates', DEFAULT_ORDINARY_KIND, ['server', 'cursor']),
    list_mcp_resources: definition('List MCP resources', DEFAULT_ORDINARY_KIND, ['server', 'cursor']),
    read_mcp_resource: definition('Read MCP resource', DEFAULT_ORDINARY_KIND, ['uri', 'server']),
    request_plugin_install: definition('Request plugin install', DEFAULT_ORDINARY_KIND, ['plugin', 'plugin_id', 'name']),
    request_user_input: definition('User input', DEFAULT_ORDINARY_KIND, ['question']),
    shell_command: definition('Shell command', 'command', ['command', 'cmd', 'workdir']),
    update_goal: definition('Update goal', 'goal', ['status']),
    update_plan: definition('Plan update', DEFAULT_ORDINARY_KIND, ['explanation']),
    view_image: definition('Image inspection', DEFAULT_ORDINARY_KIND, ['path', 'detail']),
    web__run: definition('Web request', DEFAULT_ORDINARY_KIND, ['search_query', 'open', 'url']),
  });

  function normalizedToolName(toolName) {
    return String(toolName || '').trim();
  }

  function directCodeModeToolDefinition(toolName) {
    const key = normalizedToolName(toolName);
    return Object.hasOwn(CODE_MODE_TOOL_DEFINITIONS, key) ? CODE_MODE_TOOL_DEFINITIONS[key] : null;
  }

  function codeModeToolDefinition(toolName) {
    const name = normalizedToolName(toolName);
    return directCodeModeToolDefinition(name)
      || agentCoordination?.agentCoordinationDefinition(name)
      || null;
  }

  function isDeclaredCodeModeTool(toolName) {
    const direct = directCodeModeToolDefinition(toolName);
    return Boolean(direct?.declared)
      || Boolean(agentCoordination?.isAgentCoordinationTool(normalizedToolName(toolName)));
  }

  function declaredCodeModeToolNames() {
    const direct = Object.entries(CODE_MODE_TOOL_DEFINITIONS)
      .filter(([, item]) => item.declared)
      .map(([toolName]) => toolName);
    const coordinated = agentCoordination?.agentCoordinationToolNames?.() || [];
    return [...new Set([...direct, ...coordinated])];
  }

  function codeModeToolOrdinaryKind(toolName) {
    const direct = directCodeModeToolDefinition(toolName);
    if (direct) return direct.ordinaryKind;
    if (agentCoordination?.isAgentCoordinationTool(normalizedToolName(toolName))) {
      return agentCoordination.AGENT_COORDINATION_KIND || 'agent_coordination';
    }
    return DEFAULT_ORDINARY_KIND;
  }

  return {
    CODE_MODE_TOOL_DEFINITIONS,
    DEFAULT_ORDINARY_KIND,
    codeModeToolDefinition,
    codeModeToolOrdinaryKind,
    declaredCodeModeToolNames,
    isDeclaredCodeModeTool,
  };
}));
