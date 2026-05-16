(function initSessionRenderers(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionRenderers = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function renderSectionTitle(section) {
    return section.title && !section.hideTitle ? `<div class="sectionTitle">${escapeHtml(section.title)}</div>` : '';
  }

  function renderInlineTitle(section) {
    return escapeHtml(section.title || 'Details');
  }

  function renderMarkdown(section) {
    return `<section class="eventSection mdBlock">${renderSectionTitle(section)}${section.html || ''}</section>`;
  }

  function renderCode(section) {
    const languageClass = section.language ? ` language-${escapeHtml(section.language)}` : '';
    const title = section.title ? `<div class="codeHead">${escapeHtml(section.title)}</div>` : '';
    return `<section class="eventSection"><div class="codeBlock">${title}<pre><code class="${languageClass.trim()}">${escapeHtml(section.code || '')}</code></pre></div></section>`;
  }

  function renderTerminal(section) {
    const stream = section.stream === 'stderr' ? 'stderr' : 'stdout';
    return `<section class="eventSection"><div class="terminalBlock ${stream}">${renderSectionTitle(section)}<pre>${escapeHtml(section.text || '')}</pre></div></section>`;
  }

  function renderJson(section) {
    return `<section class="eventSection"><div class="jsonBlock">${renderSectionTitle(section)}<pre>${escapeHtml(JSON.stringify(section.value, null, 2))}</pre></div></section>`;
  }

  function renderDiff(section) {
    const lines = String(section.text || '').split(/\r?\n/).map((line) => {
      let cls = 'context';
      if (line.startsWith('+') && !line.startsWith('+++')) cls = 'added';
      else if (line.startsWith('-') && !line.startsWith('---')) cls = 'removed';
      else if (line.startsWith('@@')) cls = 'hunk';
      return `<span class="diffLine ${cls}">${escapeHtml(line)}</span>`;
    }).join('');
    return `<section class="eventSection"><div class="diffBlock">${renderSectionTitle(section)}<pre>${lines}</pre></div></section>`;
  }

  function renderKv(section) {
    const rows = (section.entries || []).map((entry) => `<tr><th>${escapeHtml(entry.key || '')}</th><td>${escapeHtml(entry.value || '')}</td></tr>`).join('');
    return `<section class="eventSection"><div class="kvWrap">${renderSectionTitle(section)}<table class="kvTable"><tbody>${rows}</tbody></table></div></section>`;
  }

  function renderTokenUsage(section) {
    const items = (section.items || []).map((item) => {
      const primary = item.primary ? ' primary' : '';
      return `<div class="tokenUsageItem${primary}"><span class="tokenUsageLabel">${escapeHtml(item.label || '')}</span><strong>${escapeHtml(item.formatted ?? item.value ?? '')}</strong></div>`;
    }).join('');
    return `<section class="eventSection"><div class="tokenUsageBlock">${renderSectionTitle(section)}<div class="tokenUsageGrid">${items}</div></div></section>`;
  }

  function renderUsageLimits(section) {
    const items = (section.items || []).map((item) => `<div class="usageLimitItem"><strong>${escapeHtml(item.label || '')}</strong><span>${escapeHtml(item.remaining || '')} remaining</span><em>Resets ${escapeHtml(item.reset || '')}</em></div>`).join('');
    return `<section class="eventSection"><div class="usageLimitBlock">${renderSectionTitle(section)}${items}</div></section>`;
  }

  function renderNotice(section) {
    const level = section.level || 'info';
    return `<section class="eventSection"><div class="notice ${escapeHtml(level)}">${renderSectionTitle(section)}<p>${escapeHtml(section.text || '')}</p></div></section>`;
  }

  function renderRawJson(section) {
    const open = section.expanded ? ' open' : '';
    return `<section class="eventSection"><details class="rawJsonDetails"${open}><summary>${renderInlineTitle(section)}</summary><div class="jsonBlock"><pre>${escapeHtml(JSON.stringify(section.value, null, 2))}</pre></div></details></section>`;
  }

  function renderSection(section) {
    if (!section || !section.type) return '';
    switch (section.type) {
      case 'markdown':
        return renderMarkdown(section);
      case 'code':
        return renderCode(section);
      case 'terminal':
        return renderTerminal(section);
      case 'json':
        return renderJson(section);
      case 'diff':
        return renderDiff(section);
      case 'kv':
        return renderKv(section);
      case 'token_usage':
        return renderTokenUsage(section);
      case 'usage_limits':
        return renderUsageLimits(section);
      case 'notice':
        return renderNotice(section);
      case 'raw_json':
        return renderRawJson(section);
      default:
        return renderRawJson({ title: section.title || 'Raw JSON', value: section.value || section });
    }
  }

  function renderSections(sections) {
    return (sections || []).map(renderSection).join('');
  }

  return {
    escapeHtml,
    renderSection,
    renderSections,
  };
}));
