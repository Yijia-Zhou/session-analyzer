'use strict';

const MarkdownIt = require('markdown-it');
// Only discard presentation syntax. URLs, image metadata, entities and escapes
// can themselves be the search evidence, so keep them literal for comparison.
const excerptMarkdown = new MarkdownIt({ html: false, linkify: false })
  .disable(['link', 'image', 'autolink', 'entity', 'escape']);

function excerptHitLine(excerpt) {
  if (!Number.isSafeInteger(excerpt?.hitLine) || !Number.isSafeInteger(excerpt?.startLine)) return '';
  const index = excerpt.hitLine - excerpt.startLine;
  return index >= 0 ? String(excerpt.text || '').split('\n')[index] || '' : '';
}

function normalizedText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function excerptCoveredByText(excerpt, bodyText, { markdown = false } = {}) {
  let line = excerptHitLine(excerpt);
  // excerptText retains 360 UTF-16 units and adds these clipping markers.
  if (line.length === 362 && line.startsWith('…') && line.endsWith('…')) line = line.slice(1, -1);
  else if (line.length === 361 && line.endsWith('…')) line = line.slice(0, -1);
  const body = normalizedText(bodyText);
  const literal = normalizedText(line);
  if (!literal || !body) return false;
  if (body.includes(literal)) return true;
  if (!markdown) return false;
  const tokens = excerptMarkdown.parse(line, {});
  // A clipped fragment may not be parseable as the original Markdown. Do not
  // infer coverage for code blocks, tables or other structurally ambiguous text.
  const allowed = /^(paragraph|heading|bullet_list|ordered_list|list_item|blockquote)_(open|close)$/;
  if (tokens.some((token) => token.type !== 'inline' && !allowed.test(token.type))) return false;
  const pieces = [];
  for (const token of tokens.filter((item) => item.type === 'inline')) {
    for (const child of token.children || []) {
      if (child.type === 'text' || child.type === 'code_inline') pieces.push(child.content);
      else if (child.type === 'softbreak' || child.type === 'hardbreak') pieces.push('\n');
      else if (!/^(strong|em)_(open|close)$/.test(child.type)) return false;
    }
    pieces.push('\n');
  }
  const readable = normalizedText(pieces.join(''));
  return Boolean(readable && body.includes(readable));
}

function readableEvidenceText(root) {
  if (!root) return '';
  const win = root.ownerDocument.defaultView;
  function excluded(node) {
    if (node.matches('script, style, [hidden], [aria-hidden="true"], details:not([open]), .searchSupplement, .notice, .eventPreview, .sectionTitle, .codeFenceHead, button:not([data-file-activity])')) return true;
    const style = win.getComputedStyle(node);
    return style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
      || (['hidden', 'clip'].includes(style.overflowY) && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1);
  }
  if (root.classList.contains('mdBlock')) {
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (excluded(parent)) return '';
      if (parent.classList.contains('eventBody')) break;
    }
  }
  function visit(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    // Scrollable text is readable; clipped text is not. Ordinary page scroll
    // position must not make an excerpt appear and disappear.
    if (excluded(node)) return '\n';
    if (node.tagName === 'BR') return '\n';
    const text = [...node.childNodes].map(visit).join('');
    return ['inline', 'contents'].includes(win.getComputedStyle(node).display) ? text : `\n${text}\n`;
  }
  return visit(root);
}

function queryCoveredByBody(query, body) {
  const needle = normalizedText(query).toLowerCase();
  return Boolean(needle && normalizedText(readableEvidenceText(body)).toLowerCase().includes(needle));
}

function excerptCoveredByBody(excerpt, body) {
  return excerptCoveredByText(excerpt, readableEvidenceText(body))
    || [...(body?.querySelectorAll('.mdBlock') || [])].some((block) => (
      excerptCoveredByText(excerpt, readableEvidenceText(block), { markdown: true })
    ));
}

// Ephemeral reading state; capped and bound to query/reference and event scope.
const disclosureState = new Map();
function rememberDisclosure(key, value) {
  disclosureState.delete(key);
  disclosureState.set(key, { ...value });
  if (disclosureState.size > 100) disclosureState.delete(disclosureState.keys().next().value);
}

function excerptLocation(excerpt, t) {
  if (excerpt?.representation !== 'search_projection') return '';
  const { startLine, endLine, hitLine, text } = excerpt;
  if (![startLine, endLine, hitLine].every(Number.isSafeInteger)
      || startLine < 1 || hitLine < startLine || hitLine > endLine
      || typeof text !== 'string' || endLine - startLine + 1 !== text.split('\n').length) return '';
  return t(startLine === endLine ? 'searchExcerptSingleLine' : 'searchExcerptLineRange', {
    start: startLine, end: endLine, hit: hitLine,
  });
}

function renderSupplement(data, { escapeHtml, t }) {
  if (!data) return '';
  const saved = disclosureState.get(data.key);
  const history = data.mode === 'history';
  const excerpt = data.excerpt;
  const text = excerpt?.text || data.text || '';
  const location = excerptLocation(excerpt, t);
  const markup = text.split('\n').map((line, index) => (
    history && index + excerpt.startLine === excerpt.hitLine
      ? `<mark class="historyHitLine">${escapeHtml(line)}</mark>` : `<span>${escapeHtml(line)}</span>`
  )).join('\n');
  return `<div class="searchSupplement" data-supplement-key="${escapeHtml(data.key)}" data-supplement-event="${escapeHtml(data.eventId)}" hidden>
    ${history ? `<div class="historyMatchPreview"><span>${escapeHtml(t('historyMatch'))}</span><mark>${escapeHtml(excerptHitLine(excerpt))}</mark></div>` : ''}
    <details class="searchSupplementDetails${history ? ' historyMatch' : ''}"${saved?.open ? ' open' : ''}>
      <summary>${escapeHtml(t('historyMatchDetails'))}</summary>
      <p>${escapeHtml(t('historyExcerpt'))}</p>
      ${location ? `<p class="searchSupplementLocation" title="${escapeHtml(t('searchExcerptLineBasis'))}">${escapeHtml(location)}</p>` : ''}
      <pre class="searchSupplementText${history ? ' historyExcerpt' : ''}">${markup}</pre>
    </details></div>`;
}

function restoreSupplementScroll(wrapper) {
  const details = wrapper.querySelector('details');
  const text = wrapper.querySelector('pre');
  if (!details?.open || !text || wrapper.hidden) return;
  const saved = disclosureState.get(wrapper.dataset.supplementKey);
  if (saved?.scrollTop != null) text.scrollTop = saved.scrollTop;
  else {
    const hit = text.querySelector('.historyHitLine');
    if (hit) text.scrollTop = Math.max(0, hit.offsetTop - 24);
  }
}

function saveSupplementState(wrapper) {
  rememberDisclosure(wrapper.dataset.supplementKey, {
    open: wrapper.querySelector('details')?.open === true,
    scrollTop: wrapper.querySelector('pre')?.scrollTop || 0,
  });
}

module.exports = { excerptHitLine, excerptCoveredByText, readableEvidenceText, queryCoveredByBody, excerptCoveredByBody, renderSupplement, restoreSupplementScroll, saveSupplementState };
