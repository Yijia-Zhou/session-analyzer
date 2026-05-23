(function initSearchQuery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionSearchQuery = api;
}(typeof globalThis !== 'undefined' ? globalThis : window, function createSearchQueryApi() {
  'use strict';

  const OPERATOR_VALUES = {
    kind: new Set([
      'user_message',
      'assistant_message',
      'command',
      'patch',
      'mcp',
      'js_repl',
      'tool_operation',
      'plan_artifact',
      'protocol',
      'error',
      'compaction',
      'web_search',
    ]),
    layer: new Set(['main', 'protocol', 'raw']),
    status: new Set(['failed', 'success', 'completed']),
  };

  const OPERATORS = new Set(['file', 'kind', 'status', 'layer']);

  function tokenize(input) {
    const source = String(input || '');
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      while (i < source.length && /\s/.test(source[i])) i += 1;
      if (i >= source.length) break;
      const start = i;
      let quoted = false;
      while (i < source.length) {
        const ch = source[i];
        if (ch === '"') quoted = !quoted;
        if (!quoted && /\s/.test(ch)) break;
        i += 1;
      }
      tokens.push({ raw: source.slice(start, i) });
    }
    return tokens;
  }

  function unquote(value) {
    const text = String(value || '').trim();
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
      return text.slice(1, -1);
    }
    return text.replace(/^"+|"+$/g, '');
  }

  function parseOperatorToken(raw) {
    const colon = String(raw || '').indexOf(':');
    if (colon <= 0) return null;
    const operator = raw.slice(0, colon).toLowerCase();
    if (!OPERATORS.has(operator)) return null;

    const rawValue = raw.slice(colon + 1);
    const value = operator === 'file' ? unquote(rawValue) : unquote(rawValue).toLowerCase();
    if (!value) return { operator, value: '', valid: true, empty: true };
    if (OPERATOR_VALUES[operator] && !OPERATOR_VALUES[operator].has(value)) return null;
    return { operator, value, valid: true, empty: false };
  }

  function parseSearchInput(input) {
    const filters = { q: '', file: '', kind: '', status: '', layer: '' };
    const text = [];
    const tokens = tokenize(input).map((token) => {
      const parsed = parseOperatorToken(token.raw);
      if (parsed?.valid) {
        if (!parsed.empty) filters[parsed.operator] = parsed.value;
        return { ...token, ...parsed };
      }
      text.push(unquote(token.raw));
      return { ...token, operator: '', value: unquote(token.raw), valid: false, empty: false };
    });
    filters.q = text.filter(Boolean).join(' ').trim();
    return { ...filters, tokens };
  }

  function formatOperatorValue(value) {
    const text = String(value || '');
    return /\s/.test(text) ? `"${text.replace(/"/g, '')}"` : text;
  }

  function joinTokens(tokens) {
    return tokens.map((token) => token.raw).filter(Boolean).join(' ').trim();
  }

  function removeOperator(input, operator) {
    return joinTokens(tokenize(input).filter((token) => parseOperatorToken(token.raw)?.operator !== operator));
  }

  function removeFreeText(input) {
    return joinTokens(tokenize(input).filter((token) => parseOperatorToken(token.raw)?.valid));
  }

  function upsertOperator(input, operator, value) {
    const cleaned = removeOperator(input, operator);
    const expression = `${operator}:${formatOperatorValue(value)}`;
    return [cleaned, expression].filter(Boolean).join(' ').trim();
  }

  function structuredSearchKey(filters, layerId = '', sortValue = '') {
    const search = filters || {};
    return [
      search.kind || '',
      search.status || '',
      search.file || '',
      search.layer || '',
      layerId || '',
      sortValue || '',
    ].join('\u001f');
  }

  return {
    parseSearchInput,
    removeFreeText,
    removeOperator,
    structuredSearchKey,
    upsertOperator,
  };
}));
