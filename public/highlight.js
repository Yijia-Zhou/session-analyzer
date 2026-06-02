(function initSessionSearchHighlighter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionSearchHighlighter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SKIP_SELECTOR = 'script, style, textarea, input, select, option, button, mark, a';

  function searchTerms(query) {
    const phrase = String(query || '').trim();
    return phrase ? [phrase] : [];
  }

  function displayedMatchTotal(fullTextTotal, renderedMarkCount) {
    const full = Number.isFinite(Number(fullTextTotal)) ? Math.max(0, Number(fullTextTotal)) : 0;
    const rendered = Number.isFinite(Number(renderedMarkCount)) ? Math.max(0, Number(renderedMarkCount)) : 0;
    return Math.max(full, rendered);
  }

  function phraseRegex(query, flags = '') {
    const phrase = String(query || '').trim();
    if (!phrase) return null;
    const pattern = phrase
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    return new RegExp(pattern, flags.includes('i') ? flags : `${flags}i`);
  }

  function highlightedParts(text, terms) {
    const source = String(text || '');
    const regex = phraseRegex((terms || []).join(' '), 'g');
    if (!source || !regex) return [{ text: source, match: false }];

    const parts = [];
    let plainStart = 0;
    for (const match of source.matchAll(regex)) {
      if (plainStart < match.index) parts.push({ text: source.slice(plainStart, match.index), match: false });
      parts.push({ text: match[0], match: true });
      plainStart = match.index + match[0].length;
    }
    if (plainStart < source.length) parts.push({ text: source.slice(plainStart), match: false });
    return parts.length ? parts : [{ text: source, match: false }];
  }

  function clear(rootNode) {
    if (!rootNode?.querySelectorAll) return;
    const marks = [...rootNode.querySelectorAll('mark.searchMark')];
    for (const mark of marks) {
      const text = rootNode.ownerDocument.createTextNode(mark.textContent || '');
      mark.replaceWith(text);
      text.parentNode?.normalize();
    }
  }

  function textNodeAccepted(node, terms) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) return false;
    const text = node.nodeValue || '';
    if (!text.trim()) return false;
    return Boolean(phraseRegex((terms || []).join(' '))?.test(text));
  }

  function apply(rootNode, terms) {
    if (!rootNode?.ownerDocument || !terms?.length) return [];
    const doc = rootNode.ownerDocument;
    const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return textNodeAccepted(node, terms) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    const marks = [];
    for (const textNode of nodes) {
      const parts = highlightedParts(textNode.nodeValue || '', terms);
      if (!parts.some((part) => part.match)) continue;
      const fragment = doc.createDocumentFragment();
      for (const part of parts) {
        if (!part.text) continue;
        if (!part.match) {
          fragment.appendChild(doc.createTextNode(part.text));
          continue;
        }
        const mark = doc.createElement('mark');
        mark.className = 'searchMark';
        mark.textContent = part.text;
        marks.push(mark);
        fragment.appendChild(mark);
      }
      textNode.replaceWith(fragment);
    }
    return marks;
  }

  return {
    apply,
    clear,
    displayedMatchTotal,
    highlightedParts,
    searchTerms,
  };
}));
