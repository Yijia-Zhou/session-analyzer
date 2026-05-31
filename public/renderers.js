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

  function normalizeHighlightLanguage(language) {
    const normalized = String(language || '').trim().toLowerCase();
    const aliases = {
      ps1: 'powershell',
      pwsh: 'powershell',
      shell: 'bash',
      sh: 'bash',
      zsh: 'bash',
      fish: 'bash',
      cmd: 'bash',
      batch: 'bash',
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      html: 'xml',
      htm: 'xml',
      md: 'markdown',
    };
    return aliases[normalized] || normalized;
  }

  function languageForPath(filePath) {
    const ext = String(filePath || '').toLowerCase().split(/[\\/]/).pop().split('.').pop();
    const languages = {
      js: 'javascript',
      jsx: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      json: 'json',
      py: 'python',
      ps1: 'powershell',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      css: 'css',
      scss: 'css',
      html: 'xml',
      htm: 'xml',
      xml: 'xml',
      svg: 'xml',
      diff: 'diff',
      patch: 'diff',
    };
    return languages[ext] || '';
  }

  function highlightCode(value, language) {
    const source = String(value || '');
    const hljs = globalThis.hljs;
    const normalized = normalizeHighlightLanguage(language);
    if (!hljs || !normalized || !hljs.getLanguage?.(normalized)) return escapeHtml(source);
    try {
      return hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(source);
    }
  }

  function renderMarkdown(section) {
    return `<section class="eventSection mdBlock">${renderSectionTitle(section)}${section.html || ''}</section>`;
  }

  function renderCode(section) {
    const language = section.language || 'text';
    const languageClass = `language-${escapeHtml(language)}`;
    const title = section.title ? `<span>${escapeHtml(section.title)}</span>` : '<span>Code</span>';
    return `<section class="eventSection"><div class="codeFence"><div class="codeFenceHead">${title}<code>${escapeHtml(language)}</code></div><pre><code class="${languageClass} hljs">${highlightCode(section.code || '', language)}</code></pre></div></section>`;
  }

  function renderTerminal(section) {
    const stream = section.stream === 'stderr' ? 'stderr' : 'stdout';
    const language = section.language || 'text';
    const title = section.title || stream;
    return `<section class="eventSection"><div class="codeFence terminalBlock ${stream}"><div class="codeFenceHead"><span>${escapeHtml(title)}</span><code>${escapeHtml(language)}</code></div><pre><code class="language-${escapeHtml(language)}">${escapeHtml(section.text || '')}</code></pre></div></section>`;
  }

  function isCommandSection(section) {
    return section?.type === 'code' && String(section.title || '').toLowerCase() === 'command';
  }

  function isTerminalOutputSection(section) {
    return section?.type === 'terminal' && ['stdout', 'stderr'].includes(section.stream || section.title);
  }

  function renderCommandRunSegment(section, role) {
    const stream = section.stream === 'stderr' ? 'stderr' : 'stdout';
    const language = section.language || 'text';
    const title = section.title || (role === 'command' ? 'Command' : stream);
    const source = role === 'command' ? section.code : section.text;
    const roleClass = role === 'command' ? 'commandRunCommand' : `commandRunOutput ${stream}`;
    const code = role === 'command' ? highlightCode(source || '', language) : escapeHtml(source || '');
    const highlightClass = role === 'command' ? ' hljs' : '';
    return `<div class="commandRunSegment ${roleClass}"><div class="commandRunHead"><span>${escapeHtml(title)}</span><code>${escapeHtml(language)}</code></div><pre><code class="language-${escapeHtml(language)}${highlightClass}">${code}</code></pre></div>`;
  }

  function renderCommandRun(sections) {
    const body = sections.map((section, index) => renderCommandRunSegment(section, index === 0 ? 'command' : 'output')).join('');
    return `<section class="eventSection commandRun">${body}</section>`;
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

  function renderPatch(section) {
    const files = (section.files || []).map((file) => {
      const language = languageForPath(file.path);
      const hunks = (file.hunks || []).map((hunk) => {
        const header = hunk.header ? `<div class="patchHunkHeader">${escapeHtml(hunk.header)}</div>` : '';
        const lines = (hunk.lines || []).map((line) => {
          const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
          const oldNo = line.oldLine == null ? '' : String(line.oldLine);
          const newNo = line.newLine == null ? '' : String(line.newLine);
          const reliableLineNumber = line.lineNumberReliable !== false && hunk.lineNumbers !== false && file.lineNumbers !== false;
          const lineNo = reliableLineNumber ? (line.kind === 'added' ? newNo : line.kind === 'removed' ? oldNo : (newNo || oldNo)) : '';
          const lineNoClass = reliableLineNumber ? 'patchLineNo' : 'patchLineNo muted';
          return `<div class="patchLine ${escapeHtml(line.kind || 'context')}"><span class="${lineNoClass}">${escapeHtml(lineNo)}</span><span class="patchSign">${sign}</span><code class="${language ? `language-${escapeHtml(language)} hljs` : ''}">${highlightCode(line.content || '', language)}</code></div>`;
        }).join('');
        return `<div class="patchHunk">${header}${lines}</div>`;
      }).join('');
      return `<article class="patchFile"><header><strong>${escapeHtml(file.path || '')}</strong><span>${escapeHtml(file.changeType || 'update')}</span><em>+${escapeHtml(file.additions || 0)} / -${escapeHtml(file.deletions || 0)}</em></header>${hunks}</article>`;
    }).join('');
    return `<section class="eventSection patchBlock">${files}</section>`;
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

  function renderUserInput(section) {
    const questions = (section.questions || []).map((question) => {
      const options = (question.options || []).map((option) => {
        const selected = option.selected ? ' selected' : '';
        const selectedLabel = option.selected ? '<span class="userInputSelected">Selected</span>' : '';
        return `<li class="userInputOption${selected}"><div><strong>${escapeHtml(option.label || '')}</strong>${selectedLabel}</div>${option.description ? `<p>${escapeHtml(option.description)}</p>` : ''}</li>`;
      }).join('');
      const answers = (question.answers || []).map((answer) => `<span>${escapeHtml(answer)}</span>`).join('');
      return `<article class="userInputQuestion"><header><strong>${escapeHtml(question.title || 'Question')}</strong></header>${question.prompt ? `<p class="userInputPrompt">${escapeHtml(question.prompt)}</p>` : ''}${options ? `<ul class="userInputOptions">${options}</ul>` : ''}${answers ? `<div class="userInputAnswer"><strong>Answer</strong>${answers}</div>` : ''}</article>`;
    }).join('');
    return `<section class="eventSection"><div class="userInputBlock">${renderSectionTitle(section)}${questions}</div></section>`;
  }

  function planStatusClass(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'completed') return ' completed';
    if (normalized === 'in_progress') return ' inProgress';
    if (normalized === 'pending') return ' pending';
    if (normalized === 'failed' || normalized === 'blocked') return ' blocked';
    return ' unknown';
  }

  function renderPlanUpdate(section) {
    const explanation = section.explanationHtml ? `<div class="planUpdateExplanation">${section.explanationHtml}</div>` : '';
    const steps = (section.steps || []).map((item) => `<li class="planUpdateStep"><span class="planStatus${planStatusClass(item.status)}">${escapeHtml(item.status || 'unknown')}</span><span>${escapeHtml(item.step || '')}</span></li>`).join('');
    return `<section class="eventSection"><div class="planUpdateBlock">${renderSectionTitle(section)}${explanation}${steps ? `<ol class="planUpdateSteps">${steps}</ol>` : ''}</div></section>`;
  }

  function collaborationStatusClass(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'completed' || normalized === 'success') return ' completed';
    if (normalized === 'running' || normalized === 'in_progress') return ' running';
    if (normalized === 'pending' || normalized === 'pending_init') return ' pending';
    if (normalized === 'failed' || normalized === 'blocked' || normalized === 'declined') return ' failed';
    return ' unknown';
  }

  function renderCollaboration(section) {
    const targets = (section.targets || []).map((target) => `<span>${escapeHtml(target)}</span>`).join('');
    const fields = (section.fields || []).map((entry) => `<div><dt>${escapeHtml(entry.key || '')}</dt><dd>${escapeHtml(entry.value || '')}</dd></div>`).join('');
    const statuses = (section.statuses || []).map((item) => `<li><span>${escapeHtml(item.label || '')}</span><strong class="collaborationStatus${collaborationStatusClass(item.status)}">${escapeHtml(item.status || 'unknown')}</strong></li>`).join('');
    const timedOut = section.timedOut ? '<span class="collaborationStatus failed">timed out</span>' : '';
    const message = section.messageHtml ? `<article class="collaborationBody"><h4>Message</h4><div>${section.messageHtml}</div></article>` : '';
    const result = section.resultHtml ? `<article class="collaborationBody"><h4>Result</h4><div>${section.resultHtml}</div></article>` : '';
    return `<section class="eventSection"><div class="collaborationBlock">${renderSectionTitle(section)}${targets ? `<div class="collaborationTargets"><strong>Targets</strong>${targets}</div>` : ''}${fields ? `<dl class="collaborationFields">${fields}</dl>` : ''}${statuses || timedOut ? `<div class="collaborationStatuses">${timedOut}${statuses ? `<ul>${statuses}</ul>` : ''}</div>` : ''}${message}${result}</div></section>`;
  }

  function isSafeImagePreviewUrl(value) {
    return /^\/api\/sessions\/[^/?#]+\/events\/[^/?#]+\/image-previews\/[^/?#]+$/.test(String(value || ''));
  }

  function renderImagePreview(section) {
    const images = (section.images || []).filter((image) => isSafeImagePreviewUrl(image.src)).map((image) => `<figure><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || 'Image preview')}" loading="lazy" decoding="async"><p class="imagePreviewError">Image preview could not be loaded.</p>${image.detail ? `<figcaption>${escapeHtml(image.detail)}</figcaption>` : ''}</figure>`).join('');
    const notice = section.notice || (!images ? 'Image preview is unavailable.' : '');
    const noticeHtml = notice ? `<div class="notice info"><p>${escapeHtml(notice)}</p></div>` : '';
    return `<section class="eventSection"><div class="imagePreviewBlock">${renderSectionTitle(section)}${images ? `<div class="imagePreviewGrid">${images}</div>` : ''}${noticeHtml}</div></section>`;
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
      case 'patch':
        return renderPatch(section);
      case 'kv':
        return renderKv(section);
      case 'token_usage':
        return renderTokenUsage(section);
      case 'usage_limits':
        return renderUsageLimits(section);
      case 'user_input':
        return renderUserInput(section);
      case 'plan_update':
        return renderPlanUpdate(section);
      case 'collaboration':
        return renderCollaboration(section);
      case 'image_preview':
        return renderImagePreview(section);
      case 'notice':
        return renderNotice(section);
      case 'raw_json':
        return renderRawJson(section);
      default:
        return renderRawJson({ title: section.title || 'Raw JSON', value: section.value || section });
    }
  }

  function renderSections(sections) {
    const output = [];
    const items = sections || [];
    for (let index = 0; index < items.length; index += 1) {
      const section = items[index];
      if (isCommandSection(section)) {
        const commandSections = [section];
        let cursor = index + 1;
        while (cursor < items.length && isTerminalOutputSection(items[cursor])) {
          commandSections.push(items[cursor]);
          cursor += 1;
        }
        output.push(renderCommandRun(commandSections));
        index = cursor - 1;
      } else {
        output.push(renderSection(section));
      }
    }
    return output.join('');
  }

  function renderTimelineSections(sections, fallbackPreview = '') {
    const body = renderSections(sections);
    if (body) return body;
    const preview = String(fallbackPreview || '').trim();
    return preview ? `<div class="eventPreview eventExpandedFallback">${escapeHtml(preview)}</div>` : '';
  }

  return {
    escapeHtml,
    renderSection,
    renderSections,
    renderTimelineSections,
  };
}));
