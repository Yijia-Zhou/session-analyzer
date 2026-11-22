'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { sha256 } = require('./history-eval-common');

const DISABLED_FEATURES = Object.freeze(['shell_tool', 'unified_exec', 'multi_agent', 'multi_agent_v2',
  'apps', 'plugins', 'browser_use', 'browser_use_external', 'computer_use', 'view_image', 'code_mode',
  'image_generation', 'hooks', 'memories', 'incremental_tools', 'goals']);

function commonConfig({ model = 'gpt-6.1-terra', effort = 'max', modelCatalog } = {}) {
  const config = { model_reasoning_effort: effort, approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
    'features.code_mode_host': true, 'agents.enabled': false, cli_auth_credentials_store: 'file',
    'skills.bundled.enabled': false, 'skills.include_instructions': false, project_doc_max_bytes: 0,
    'mcp_servers.history_eval.required': true, 'mcp_servers.history_eval.enabled_tools': ['history_eval'],
    'mcp_servers.history_eval.tools.history_eval.approval_mode': 'approve',
    'mcp_servers.history_eval.omit_tools_from': ['deferred', 'code_mode'],
    'mcp_servers.history_eval.tool_timeout_sec': 180, 'mcp_servers.history_eval.startup_timeout_sec': 180 };
  for (const feature of DISABLED_FEATURES) config[`features.${feature}`] = false;
  if (modelCatalog && !path.isAbsolute(modelCatalog)) throw new Error('modelCatalog requires an absolute path');
  const modelCatalogSha256 = modelCatalog ? sha256(fs.readFileSync(modelCatalog)) : null;
  return { model, flags: ['exec', '--json', '--ignore-user-config', '--ignore-rules', '--strict-config', '--skip-git-repo-check'],
    projectTrust: 'command-line-current-cwd-only', modelCatalogSha256, config };
}
function commonConfigSha256(options) { return sha256(JSON.stringify(commonConfig(options))); }

// Shared by the real worker and the local fake-provider exposure probe. A CLI
// upgrade requires probing again: these settings alone are not exposure proof.
function buildCodexArgs({ model = 'gpt-6.1-terra', effort = 'max', nodePath = process.execPath,
  mcpScript, mcpConfig, cwd, answerPath, provider, modelCatalog }) {
  for (const [name, value] of Object.entries({ mcpScript, mcpConfig, cwd, nodePath })) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${name} requires an absolute path`);
  }
  if (typeof model !== 'string' || !model || !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw new Error('Invalid worker model or effort');
  const common = commonConfig({ model, effort, modelCatalog });
  const args = [...common.flags, '-m', model, '-C', cwd];
  const config = {
    ...common.config,
    'mcp_servers.history_eval.command': nodePath, 'mcp_servers.history_eval.args': [mcpScript, mcpConfig],
    [`projects.${JSON.stringify(cwd)}.trust_level`]: 'trusted',
  };
  if (modelCatalog) config.model_catalog_json = modelCatalog;
  if (provider) {
    const baseUrl = new URL(provider.baseUrl);
    if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname)
      || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('Probe provider must be loopback HTTP');
    const id = 'history_eval_probe';
    Object.assign(config, { model_provider: id,
      [`model_providers.${id}.name`]: 'Local tool exposure probe; no inference',
      [`model_providers.${id}.base_url`]: baseUrl.href,
      [`model_providers.${id}.wire_api`]: 'responses',
      [`model_providers.${id}.requires_openai_auth`]: false,
      [`model_providers.${id}.request_max_retries`]: 0,
      [`model_providers.${id}.stream_max_retries`]: 0,
      [`model_providers.${id}.stream_idle_timeout_ms`]: 1000,
    });
  }
  for (const [key, value] of Object.entries(config)) args.push('-c', `${key}=${JSON.stringify(value)}`);
  if (answerPath) args.push('--output-last-message', path.resolve(answerPath));
  args.push('-');
  return args;
}

module.exports = { DISABLED_FEATURES, buildCodexArgs, commonConfig, commonConfigSha256 };
