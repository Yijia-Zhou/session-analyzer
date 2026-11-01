'use strict';

// Independently synthetic SDK 0.3.220 / 0.3.301 envelopes. These are stream
// output shapes, not persisted native Claude project records.
function sdkToolProgress(overrides = {}) {
  return {
    type: 'tool_progress', session_id: 'sdk-session', uuid: 'sdk-tool-progress',
    tool_use_id: 'sdk-tool-call', tool_name: 'Read', parent_tool_use_id: null,
    elapsed_time_seconds: 1, ...overrides,
  };
}

function sdkTaskProgress(overrides = {}) {
  return {
    type: 'system', subtype: 'task_progress', session_id: 'sdk-session',
    uuid: 'sdk-task-progress', task_id: 'sdk-task', description: 'Private synthetic task progress.',
    usage: { total_tokens: 5, tool_uses: 1, duration_ms: 10 }, ...overrides,
  };
}

function sdkResult(overrides = {}) {
  const subtype = overrides.subtype || 'success';
  return {
    type: 'result', subtype, session_id: 'sdk-session', uuid: 'sdk-result',
    duration_ms: 0, duration_api_ms: 0, is_error: subtype !== 'success', num_turns: 0,
    stop_reason: null, total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {}, permission_denials: [],
    ...(subtype === 'success' ? { result: 'Private synthetic SDK result.' }
      : { errors: ['Private synthetic SDK failure.'] }),
    ...overrides,
  };
}

module.exports = { sdkToolProgress, sdkTaskProgress, sdkResult };
