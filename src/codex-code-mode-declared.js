'use strict';

const acorn = require('acorn');

const MAX_SOURCE_LENGTH = 100_000;
const MAX_DECLARED_CALLS = 24;
const MAX_LITERAL_DEPTH = 16;
const MAX_LITERAL_NODES = 1_000;

const KNOWN_CODE_MODE_TOOLS = new Set([
  'apply_patch',
  'close_agent',
  'create_goal',
  'exec_command',
  'get_goal',
  'image_gen__imagegen',
  'list_available_plugins_to_install',
  'list_mcp_resource_templates',
  'list_mcp_resources',
  'read_mcp_resource',
  'request_plugin_install',
  'request_user_input',
  'send_input',
  'shell_command',
  'spawn_agent',
  'update_goal',
  'update_plan',
  'view_image',
  'wait_agent',
  'web__run',
]);

function unsupported(reason) {
  return {
    supported: false,
    reason,
    calls: [],
    hasCompleteOutputAssociation: false,
  };
}

function literalBudget() {
  return { nodes: 0 };
}

function consumeLiteralNode(budget, depth) {
  budget.nodes += 1;
  return depth <= MAX_LITERAL_DEPTH && budget.nodes <= MAX_LITERAL_NODES;
}

function materializeLiteral(node, budget, depth = 0) {
  if (!node || !consumeLiteralNode(budget, depth)) return { ok: false, value: null };

  if (node.type === 'Literal') {
    if (node.regex || typeof node.bigint === 'string') return { ok: false, value: null };
    if (node.value === null || ['string', 'boolean'].includes(typeof node.value)
        || (typeof node.value === 'number' && Number.isFinite(node.value))) {
      return { ok: true, value: node.value };
    }
    return { ok: false, value: null };
  }

  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    const value = node.quasis[0]?.value?.cooked;
    return typeof value === 'string' ? { ok: true, value } : { ok: false, value: null };
  }

  if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) {
    const argument = materializeLiteral(node.argument, budget, depth + 1);
    if (!argument.ok || typeof argument.value !== 'number') return { ok: false, value: null };
    return { ok: true, value: node.operator === '-' ? -argument.value : argument.value };
  }

  if (node.type === 'ArrayExpression') {
    const value = [];
    for (const element of node.elements) {
      if (!element || element.type === 'SpreadElement') return { ok: false, value: null };
      const item = materializeLiteral(element, budget, depth + 1);
      if (!item.ok) return { ok: false, value: null };
      value.push(item.value);
    }
    return { ok: true, value };
  }

  if (node.type === 'ObjectExpression') {
    const value = Object.create(null);
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.kind !== 'init' || property.method
          || property.computed || property.shorthand) {
        return { ok: false, value: null };
      }
      let key = '';
      if (property.key.type === 'Identifier') key = property.key.name;
      else if (property.key.type === 'Literal'
          && ['string', 'number'].includes(typeof property.key.value)) key = String(property.key.value);
      else return { ok: false, value: null };
      if (key === '__proto__') return { ok: false, value: null };

      const item = materializeLiteral(property.value, budget, depth + 1);
      if (!item.ok) return { ok: false, value: null };
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: item.value,
      });
    }
    return { ok: true, value };
  }

  return { ok: false, value: null };
}

function directToolCall(node) {
  if (!node || node.type !== 'AwaitExpression') return null;
  const call = node.argument;
  if (!call || call.type !== 'CallExpression' || call.optional || call.arguments.length > 1) return null;
  const callee = call.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.optional || callee.computed
      || callee.object?.type !== 'Identifier' || callee.object.name !== 'tools'
      || callee.property?.type !== 'Identifier') {
    return null;
  }
  return { call, toolName: callee.property.name };
}

function declaredCallFromAwait(awaitNode, resultVariable, sourceOrder, budget) {
  const direct = directToolCall(awaitNode);
  if (!direct) return { ok: false, reason: 'unsupported_tool_call' };
  if (!KNOWN_CODE_MODE_TOOLS.has(direct.toolName)) return { ok: false, reason: 'unknown_tool' };
  const request = direct.call.arguments.length
    ? materializeLiteral(direct.call.arguments[0], budget)
    : { ok: true, value: null };
  if (!request.ok) return { ok: false, reason: 'dynamic_arguments' };
  return {
    ok: true,
    value: {
      toolName: direct.toolName,
      requestValue: request.value,
      resultVariable,
      sourceOrder,
      requestEvidence: 'declared_source',
      resultAssociation: 'none',
      resultText: '',
    },
  };
}

function emittedVariable(statement) {
  if (statement?.type !== 'ExpressionStatement') return '';
  const expression = statement.expression;
  if (!expression || expression.type !== 'CallExpression' || expression.optional
      || expression.callee?.type !== 'Identifier' || expression.callee.name !== 'text'
      || expression.arguments.length !== 1 || expression.arguments[0]?.type !== 'Identifier') {
    return '';
  }
  return expression.arguments[0].name;
}

function applyBoundedOutputAssociation(calls, emissions, outputFragments) {
  if (!Array.isArray(outputFragments) || outputFragments.length === 0) return false;
  if (outputFragments.some((fragment) => typeof fragment !== 'string' || fragment.length === 0)) return false;
  const boundCalls = calls.filter((call) => call.resultVariable);
  if (!boundCalls.length || boundCalls.length !== calls.length || emissions.length !== boundCalls.length
      || outputFragments.length !== emissions.length) {
    return false;
  }
  if (boundCalls.some((call, index) => call.resultVariable !== emissions[index])) return false;

  for (let index = 0; index < boundCalls.length; index += 1) {
    boundCalls[index].resultAssociation = 'bounded';
    boundCalls[index].resultText = outputFragments[index];
  }
  return true;
}

function projectDeclaredCodeModeCalls(source, options = {}) {
  const text = String(source || '');
  if (!text.trim()) return unsupported('empty_source');
  if (text.length > MAX_SOURCE_LENGTH) return unsupported('source_too_large');

  let program;
  try {
    program = acorn.parse(text, {
      allowAwaitOutsideFunction: true,
      ecmaVersion: 'latest',
      sourceType: 'script',
    });
  } catch {
    return unsupported('syntax_error');
  }

  const calls = [];
  const emissions = [];
  const variables = new Set();
  const budget = literalBudget();

  for (const statement of program.body) {
    if (statement.type === 'EmptyStatement') continue;

    if (statement.type === 'VariableDeclaration') {
      if (statement.kind !== 'const' || statement.declarations.length !== 1) return unsupported('unsupported_binding');
      const declaration = statement.declarations[0];
      if (declaration.id?.type !== 'Identifier' || variables.has(declaration.id.name)) return unsupported('unsupported_binding');
      const parsed = declaredCallFromAwait(declaration.init, declaration.id.name, calls.length, budget);
      if (!parsed.ok) return unsupported(parsed.reason);
      variables.add(declaration.id.name);
      calls.push(parsed.value);
    } else if (statement.type === 'ExpressionStatement') {
      const variable = emittedVariable(statement);
      if (variable) {
        if (!variables.has(variable)) return unsupported('unknown_emission');
        emissions.push(variable);
      } else {
        const parsed = declaredCallFromAwait(statement.expression, '', calls.length, budget);
        if (!parsed.ok) return unsupported(parsed.reason);
        calls.push(parsed.value);
      }
    } else {
      return unsupported('unsupported_control_flow');
    }

    if (calls.length > MAX_DECLARED_CALLS) return unsupported('too_many_calls');
  }

  if (!calls.length) return unsupported('no_declared_calls');
  const hasCompleteOutputAssociation = applyBoundedOutputAssociation(
    calls,
    emissions,
    options.outputFragments,
  );
  return {
    supported: true,
    reason: '',
    calls,
    hasCompleteOutputAssociation,
  };
}

module.exports = {
  projectDeclaredCodeModeCalls,
};
