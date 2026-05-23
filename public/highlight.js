(function initSessionSearchHighlighter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionSearchHighlighter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SKIP_SELECTOR = 'script, style, textarea, input, select, option, button, mark, a';

  function searchTerms(query) {
    return [...new Set(String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean))]
      .sort((a, b) => b.length - a.length || a.localeCompare(b));
  }

  function lowerAt(text, start, length) {
    return text.slice(start, start + length).toLowerCase();
  }

  function highlightedParts(text, terms) {
    const source = String(text || '');
    const needles = searchTerms((terms || []).join(' '));
    if (!source || !needles.length) return [{ text: source, match: false }];

    const parts = [];
    let plainStart = 0;
    let i = 0;
    while (i < source.length) {
      const matched = needles.find((term) => lowerAt(source, i, term.length) === term);
      if (!matched) {
        i += 1;
        continue;
      }
      if (plainStart < i) parts.push({ text: source.slice(plainStart, i), match: false });
      parts.push({ text: source.slice(i, i + matched.length), match: true });
      i += matched.length;
      plainStart = i;
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
    const lower = text.toLowerCase();
    return terms.some((term) => lower.includes(term));
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
    highlightedParts,
    searchTerms,
  };
}));
