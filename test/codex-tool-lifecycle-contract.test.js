'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../src/codex-tool-lifecycle-contract');

const START = 'start';
const PROGRESS = 'progress';
const TERMINAL = 'terminal';

function expectedFamily(family, members, standaloneTypes = []) {
  const standalone = new Set(standaloneTypes);
  return members.map(([wireType, phase, representativeRank]) => ({
    wireType,
    family,
    phase,
    representativeRank,
    callGroupAdmission: true,
    standaloneAdmission: standalone.has(wireType),
  }));
}

const EXPECTED_DESCRIPTORS = [
  ...expectedFamily('command', [
    ['exec_command_begin', START, 1],
    ['exec_command_update', PROGRESS, 2],
    ['exec_command_delta', PROGRESS, 2],
    ['exec_command_end', TERMINAL, 3],
    ['exec_command_declined', TERMINAL, 4],
  ]),
  ...expectedFamily('patch', [
    ['patch_apply_begin', START, 1],
    ['patch_apply_update', PROGRESS, 2],
    ['patch_apply_delta', PROGRESS, 2],
    ['patch_apply_end', TERMINAL, 3],
    ['patch_apply_declined', TERMINAL, 4],
  ]),
  ...expectedFamily('mcp_tool', [
    ['mcp_tool_call_begin', START, 1],
    ['mcp_tool_call_update', PROGRESS, 2],
    ['mcp_tool_call_delta', PROGRESS, 2],
    ['mcp_tool_call_end', TERMINAL, 3],
    ['mcp_tool_call_declined', TERMINAL, 4],
  ]),
  ...expectedFamily('image_generation', [
    ['image_generation_call_begin', START, 1],
    ['image_generation_call_update', PROGRESS, 2],
    ['image_generation_call_delta', PROGRESS, 2],
    ['image_generation_call_end', TERMINAL, 3],
    ['image_generation_call_declined', TERMINAL, 4],
    ['image_generation_end', TERMINAL, 3],
  ]),
  ...expectedFamily('dynamic_tool', [
    ['dynamic_tool_call_begin', START, 1],
    ['dynamic_tool_call_update', PROGRESS, 2],
    ['dynamic_tool_call_delta', PROGRESS, 2],
    ['dynamic_tool_call_end', TERMINAL, 3],
    ['dynamic_tool_call_declined', TERMINAL, 4],
  ]),
  ...expectedFamily('approval', [
    ['approval_request_begin', START, 1],
    ['approval_request_end', TERMINAL, 3],
    ['approval_request_declined', TERMINAL, 4],
  ]),
  ...expectedFamily('hook', [
    ['hook_begin', START, 1],
    ['hook_end', TERMINAL, 3],
    ['hook_declined', TERMINAL, 4],
    ['hook_started', START, 1],
    ['hook_completed', TERMINAL, 3],
  ], [
    'hook_begin',
    'hook_end',
    'hook_declined',
    'hook_started',
    'hook_completed',
  ]),
  ...expectedFamily('collaboration', [
    ['collab_agent_spawn_begin', START, 1],
    ['collab_agent_spawn_end', TERMINAL, 3],
    ['collab_agent_interaction_begin', START, 1],
    ['collab_agent_interaction_end', TERMINAL, 3],
    ['collab_waiting_begin', START, 1],
    ['collab_waiting_end', TERMINAL, 3],
    ['collab_close_begin', START, 1],
    ['collab_close_end', TERMINAL, 3],
  ], [
    'collab_agent_spawn_end',
    'collab_agent_interaction_end',
    'collab_waiting_end',
    'collab_close_end',
  ]),
];

test('tool lifecycle contract records every current exact member and policy once', () => {
  assert.deepEqual(TOOL_LIFECYCLE_FAMILY, {
    COMMAND: 'command',
    PATCH: 'patch',
    MCP_TOOL: 'mcp_tool',
    IMAGE_GENERATION: 'image_generation',
    DYNAMIC_TOOL: 'dynamic_tool',
    APPROVAL: 'approval',
    HOOK: 'hook',
    COLLABORATION: 'collaboration',
  });
  assert.deepEqual(TOOL_LIFECYCLE_PHASE, {
    START: 'start',
    PROGRESS: 'progress',
    INTERACTION: 'interaction',
    TERMINAL: 'terminal',
    SINGLE: 'single',
  });
  assert.deepEqual(TOOL_LIFECYCLE_DESCRIPTORS, EXPECTED_DESCRIPTORS);
  assert.deepEqual(
    TOOL_LIFECYCLE_EVENT_TYPES,
    EXPECTED_DESCRIPTORS.map((entry) => entry.wireType),
  );
  assert.equal(new Set(TOOL_LIFECYCLE_EVENT_TYPES).size, TOOL_LIFECYCLE_EVENT_TYPES.length);
  assert.ok(Object.isFrozen(TOOL_LIFECYCLE_DESCRIPTORS));
  assert.ok(Object.isFrozen(TOOL_LIFECYCLE_EVENT_TYPES));
  for (const entry of TOOL_LIFECYCLE_DESCRIPTORS) assert.ok(Object.isFrozen(entry));
});

test('tool lifecycle projections preserve exact family, rank, and admission semantics', () => {
  for (const expected of EXPECTED_DESCRIPTORS) {
    assert.equal(toolLifecycleDescriptorFor(expected.wireType), TOOL_LIFECYCLE_DESCRIPTORS
      .find((entry) => entry.wireType === expected.wireType));
    assert.equal(isToolLifecycleEventType(expected.wireType), true);
    assert.equal(isToolLifecycleFamily(expected.wireType, expected.family), true);
    assert.equal(isToolLifecycleCallGroupType(expected.wireType), expected.callGroupAdmission);
    assert.equal(isToolLifecycleStandaloneType(expected.wireType), expected.standaloneAdmission);
    assert.equal(toolLifecycleRepresentativeRank(expected.wireType), expected.representativeRank);
  }
});

test('tool lifecycle contract never infers unknown lookalikes or upstream-only shapes', () => {
  const unknownTypes = [
    'exec_command_output_delta',
    'exec_command_future_end',
    'patch_apply_updated',
    'mcp_tool_call_progress',
    'image_generation_begin',
    'image_generation_call_complete',
    'dynamic_tool_call_request',
    'dynamic_tool_call_response',
    'approval_request_completed',
    'hook_complete',
    'collab_resume_begin',
    'collab_resume_end',
    'sub_agent_activity',
  ];

  for (const wireType of unknownTypes) {
    assert.equal(toolLifecycleDescriptorFor(wireType), null);
    assert.equal(isToolLifecycleEventType(wireType), false);
    assert.equal(isToolLifecycleCallGroupType(wireType), false);
    assert.equal(isToolLifecycleStandaloneType(wireType), false);
    assert.equal(toolLifecycleRepresentativeRank(wireType), 0);
    for (const family of Object.values(TOOL_LIFECYCLE_FAMILY)) {
      assert.equal(isToolLifecycleFamily(wireType, family), false);
    }
  }
});
