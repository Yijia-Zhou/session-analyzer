'use strict';

const TOOL_LIFECYCLE_FAMILY = Object.freeze({
  COMMAND: 'command',
  PATCH: 'patch',
  MCP_TOOL: 'mcp_tool',
  IMAGE_GENERATION: 'image_generation',
  DYNAMIC_TOOL: 'dynamic_tool',
  APPROVAL: 'approval',
  HOOK: 'hook',
  COLLABORATION: 'collaboration',
});

const TOOL_LIFECYCLE_PHASE = Object.freeze({
  START: 'start',
  PROGRESS: 'progress',
  INTERACTION: 'interaction',
  TERMINAL: 'terminal',
  SINGLE: 'single',
});

function descriptor(wireType, family, phase, representativeRank, standaloneAdmission = false) {
  return Object.freeze({
    wireType,
    family,
    phase,
    representativeRank,
    callGroupAdmission: true,
    standaloneAdmission,
  });
}

const TOOL_LIFECYCLE_DESCRIPTORS = Object.freeze([
  descriptor('exec_command_begin', TOOL_LIFECYCLE_FAMILY.COMMAND, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('exec_command_update', TOOL_LIFECYCLE_FAMILY.COMMAND, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('exec_command_delta', TOOL_LIFECYCLE_FAMILY.COMMAND, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('exec_command_end', TOOL_LIFECYCLE_FAMILY.COMMAND, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),
  descriptor('exec_command_declined', TOOL_LIFECYCLE_FAMILY.COMMAND, TOOL_LIFECYCLE_PHASE.TERMINAL, 4),

  descriptor('patch_apply_begin', TOOL_LIFECYCLE_FAMILY.PATCH, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('patch_apply_update', TOOL_LIFECYCLE_FAMILY.PATCH, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('patch_apply_delta', TOOL_LIFECYCLE_FAMILY.PATCH, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('patch_apply_end', TOOL_LIFECYCLE_FAMILY.PATCH, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),
  descriptor('patch_apply_declined', TOOL_LIFECYCLE_FAMILY.PATCH, TOOL_LIFECYCLE_PHASE.TERMINAL, 4),

  descriptor('mcp_tool_call_begin', TOOL_LIFECYCLE_FAMILY.MCP_TOOL, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('mcp_tool_call_update', TOOL_LIFECYCLE_FAMILY.MCP_TOOL, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('mcp_tool_call_delta', TOOL_LIFECYCLE_FAMILY.MCP_TOOL, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('mcp_tool_call_end', TOOL_LIFECYCLE_FAMILY.MCP_TOOL, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),
  descriptor('mcp_tool_call_declined', TOOL_LIFECYCLE_FAMILY.MCP_TOOL, TOOL_LIFECYCLE_PHASE.TERMINAL, 4),

  descriptor('image_generation_call_begin', TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('image_generation_call_update', TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('image_generation_call_delta', TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('image_generation_call_end', TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),
  descriptor('image_generation_call_declined', TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 4),
  descriptor('image_generation_end', TOOL_LIFECYCLE_FAMILY.IMAGE_GENERATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),

  descriptor('dynamic_tool_call_begin', TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('dynamic_tool_call_update', TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('dynamic_tool_call_delta', TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL, TOOL_LIFECYCLE_PHASE.PROGRESS, 2),
  descriptor('dynamic_tool_call_end', TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),
  descriptor('dynamic_tool_call_declined', TOOL_LIFECYCLE_FAMILY.DYNAMIC_TOOL, TOOL_LIFECYCLE_PHASE.TERMINAL, 4),

  descriptor('approval_request_begin', TOOL_LIFECYCLE_FAMILY.APPROVAL, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('approval_request_end', TOOL_LIFECYCLE_FAMILY.APPROVAL, TOOL_LIFECYCLE_PHASE.TERMINAL, 3),
  descriptor('approval_request_declined', TOOL_LIFECYCLE_FAMILY.APPROVAL, TOOL_LIFECYCLE_PHASE.TERMINAL, 4),

  descriptor('hook_begin', TOOL_LIFECYCLE_FAMILY.HOOK, TOOL_LIFECYCLE_PHASE.START, 1, true),
  descriptor('hook_end', TOOL_LIFECYCLE_FAMILY.HOOK, TOOL_LIFECYCLE_PHASE.TERMINAL, 3, true),
  descriptor('hook_declined', TOOL_LIFECYCLE_FAMILY.HOOK, TOOL_LIFECYCLE_PHASE.TERMINAL, 4, true),
  descriptor('hook_started', TOOL_LIFECYCLE_FAMILY.HOOK, TOOL_LIFECYCLE_PHASE.START, 1, true),
  descriptor('hook_completed', TOOL_LIFECYCLE_FAMILY.HOOK, TOOL_LIFECYCLE_PHASE.TERMINAL, 3, true),

  descriptor('collab_agent_spawn_begin', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('collab_agent_spawn_end', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 3, true),
  descriptor('collab_agent_interaction_begin', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('collab_agent_interaction_end', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 3, true),
  descriptor('collab_waiting_begin', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('collab_waiting_end', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 3, true),
  descriptor('collab_close_begin', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.START, 1),
  descriptor('collab_close_end', TOOL_LIFECYCLE_FAMILY.COLLABORATION, TOOL_LIFECYCLE_PHASE.TERMINAL, 3, true),
]);

const DESCRIPTOR_BY_WIRE_TYPE = new Map(
  TOOL_LIFECYCLE_DESCRIPTORS.map((entry) => [entry.wireType, entry]),
);

const TOOL_LIFECYCLE_EVENT_TYPES = Object.freeze(
  TOOL_LIFECYCLE_DESCRIPTORS.map((entry) => entry.wireType),
);

function toolLifecycleDescriptorFor(wireType) {
  return DESCRIPTOR_BY_WIRE_TYPE.get(String(wireType || '')) || null;
}

function isToolLifecycleEventType(wireType) {
  return Boolean(toolLifecycleDescriptorFor(wireType));
}

function isToolLifecycleFamily(wireType, family) {
  return toolLifecycleDescriptorFor(wireType)?.family === family;
}

function isToolLifecycleCallGroupType(wireType) {
  return toolLifecycleDescriptorFor(wireType)?.callGroupAdmission === true;
}

function isToolLifecycleStandaloneType(wireType) {
  return toolLifecycleDescriptorFor(wireType)?.standaloneAdmission === true;
}

function toolLifecycleRepresentativeRank(wireType) {
  return toolLifecycleDescriptorFor(wireType)?.representativeRank || 0;
}

module.exports = {
  TOOL_LIFECYCLE_DESCRIPTORS,
  TOOL_LIFECYCLE_EVENT_TYPES,
  TOOL_LIFECYCLE_FAMILY,
  TOOL_LIFECYCLE_PHASE,
  isToolLifecycleCallGroupType,
  isToolLifecycleEventType,
  isToolLifecycleFamily,
  isToolLifecycleStandaloneType,
  toolLifecycleDescriptorFor,
  toolLifecycleRepresentativeRank,
};
