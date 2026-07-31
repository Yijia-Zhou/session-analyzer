'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const agentCoordination = require('../src/shared/agent-coordination');
const codeModeTools = require('../src/shared/code-mode-tools');
const { knownCodeModeToolNames } = require('../src/codex-code-mode-declared');
const folding = require('../src/shared/folding');
const i18n = require('../src/shared/i18n');

const EXPECTED_DIRECT_TOOLS = {
  apply_patch: { title: 'Apply patch', ordinaryKind: 'patch', previewFields: ['patch'] },
  create_goal: { title: 'Create goal', ordinaryKind: 'goal', previewFields: ['objective'] },
  exec_command: { title: 'Shell command', ordinaryKind: 'command', previewFields: ['command', 'cmd', 'workdir'] },
  get_goal: { title: 'Get goal', ordinaryKind: 'goal', previewFields: [] },
  image_gen__imagegen: { title: 'Image generation', ordinaryKind: 'other_tool_call', previewFields: ['prompt'] },
  list_available_plugins_to_install: { title: 'List available plugins', ordinaryKind: 'other_tool_call', previewFields: [] },
  list_mcp_resource_templates: { title: 'List MCP resource templates', ordinaryKind: 'other_tool_call', previewFields: ['server', 'cursor'] },
  list_mcp_resources: { title: 'List MCP resources', ordinaryKind: 'other_tool_call', previewFields: ['server', 'cursor'] },
  read_mcp_resource: { title: 'Read MCP resource', ordinaryKind: 'other_tool_call', previewFields: ['uri', 'server'] },
  request_plugin_install: { title: 'Request plugin install', ordinaryKind: 'other_tool_call', previewFields: ['plugin', 'plugin_id', 'name'] },
  request_user_input: { title: 'User input', ordinaryKind: 'other_tool_call', previewFields: ['question'] },
  shell_command: { title: 'Shell command', ordinaryKind: 'command', previewFields: ['command', 'cmd', 'workdir'] },
  update_goal: { title: 'Update goal', ordinaryKind: 'goal', previewFields: ['status'] },
  update_plan: { title: 'Plan update', ordinaryKind: 'other_tool_call', previewFields: ['explanation'] },
  view_image: { title: 'Image inspection', ordinaryKind: 'other_tool_call', previewFields: ['path', 'detail'] },
  web__run: { title: 'Web request', ordinaryKind: 'other_tool_call', previewFields: ['search_query', 'open', 'url'] },
};

test('shared Code Mode registry is the source of direct-tool declaration, folding, and label metadata', () => {
  assert.deepEqual(Object.keys(codeModeTools.CODE_MODE_TOOL_DEFINITIONS), Object.keys(EXPECTED_DIRECT_TOOLS));

  for (const [toolName, expected] of Object.entries(EXPECTED_DIRECT_TOOLS)) {
    const definition = codeModeTools.codeModeToolDefinition(toolName);
    assert.deepEqual(definition, { declared: true, ...expected }, toolName);
    assert.equal(Object.isFrozen(definition), true, toolName);
    assert.equal(Object.isFrozen(definition.previewFields), true, toolName);
    assert.equal(codeModeTools.isDeclaredCodeModeTool(toolName), true, toolName);
    assert.equal(codeModeTools.codeModeToolOrdinaryKind(toolName), expected.ordinaryKind, toolName);
    assert.equal(folding.ordinaryKindForCodeModeRequest(toolName), expected.ordinaryKind, toolName);
    assert.equal(i18n.codeModeRequestLabel(toolName, 'en'), expected.title, toolName);
    assert.equal(
      i18n.codeModeRequestLabel(toolName, 'zh-CN'),
      i18n.sectionTitle(expected.title, 'zh-CN'),
      toolName,
    );
  }

  const expectedDeclaredTools = [
    ...Object.keys(EXPECTED_DIRECT_TOOLS),
    ...agentCoordination.agentCoordinationToolNames(),
  ].sort();
  assert.deepEqual(codeModeTools.declaredCodeModeToolNames().sort(), expectedDeclaredTools);
  assert.deepEqual(knownCodeModeToolNames().sort(), expectedDeclaredTools);
});

test('shared Code Mode registry composes Agent Coordination without widening unknown-tool support', () => {
  for (const toolName of agentCoordination.agentCoordinationToolNames()) {
    const definition = agentCoordination.agentCoordinationDefinition(toolName);
    assert.equal(codeModeTools.codeModeToolDefinition(toolName), definition, toolName);
    assert.equal(codeModeTools.isDeclaredCodeModeTool(toolName), true, toolName);
    assert.equal(codeModeTools.codeModeToolOrdinaryKind(toolName), 'agent_coordination', toolName);
    assert.equal(folding.ordinaryKindForCodeModeRequest(toolName), 'agent_coordination', toolName);
    assert.equal(i18n.codeModeRequestLabel(toolName, 'en'), definition.title, toolName);
  }

  for (const toolName of ['unknown_tool', 'constructor', '__proto__', 'toString']) {
    assert.equal(codeModeTools.codeModeToolDefinition(toolName), null, toolName);
    assert.equal(codeModeTools.isDeclaredCodeModeTool(toolName), false, toolName);
    assert.equal(codeModeTools.codeModeToolOrdinaryKind(toolName), 'other_tool_call', toolName);
  }
});
