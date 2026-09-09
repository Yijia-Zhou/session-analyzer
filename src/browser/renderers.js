(function initSessionRenderers(root, factory) {
  const commandHighlighting = typeof module === 'object' && module.exports
    ? require('../shared/command-highlighting')
    : root.sessionCommandHighlighting;
  const i18n = typeof module === 'object' && module.exports
    ? require('../shared/i18n')
    : root.sessionI18n;
  const codeModePresentationContract = typeof module === 'object' && module.exports
    ? require('../shared/code-mode-presentation-contract')
    : root.sessionCodeModePresentationContract;
  const detailPurpose = typeof module === 'object' && module.exports
    ? require('../shared/detail-purpose')
    : root.sessionDetailPurpose;
  const api = factory(commandHighlighting, i18n, codeModePresentationContract, detailPurpose);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.sessionRenderers = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (commandHighlighting, i18n, codeModePresentationContract, detailPurpose) => {
  'use strict';

  function locale() {
    return globalThis.sessionAnalyzerLocale || i18n.DEFAULT_LOCALE;
  }

  function tr(key, vars = {}) {
    return i18n.t(locale(), 'renderer', key, vars);
  }

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

  function escapeRegExp(value) {
    return String(value || '').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }

  const SHELL_EXTERNAL_COMMAND_WORDS = commandHighlighting.SHELL_EXTERNAL_COMMAND_WORDS;
  const SHELL_EXTERNAL_COMMAND_REGEX_SOURCE = SHELL_EXTERNAL_COMMAND_WORDS.map(escapeRegExp).join('|');
  const SHELL_EXTERNAL_COMMAND_PATTERN = SHELL_EXTERNAL_COMMAND_WORDS.length
    ? new RegExp(`([\\r\\n;|{}()]|&amp;)([ \\t]*)(${SHELL_EXTERNAL_COMMAND_REGEX_SOURCE})(\\.exe)?(?=\\s|$)`, 'gi')
    : null;
  const SHELL_EXTERNAL_COMMAND_LINE_START_PATTERN = SHELL_EXTERNAL_COMMAND_WORDS.length
    ? new RegExp(`^([ \\t]*)(${SHELL_EXTERNAL_COMMAND_REGEX_SOURCE})(\\.exe)?(?=\\s|$)`, 'i')
    : null;
  const BASH_OPTION_PATTERN = /(^|[\s])(-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)(?=\s|$)/g;
  const HLJS_SPAN_CLASS_PATTERN = /\bclass=(["'])[^"']*\bhljs-[^"']*\1/i;

  function textEndsAtLineStart(text, startsAtLineStart = false) {
    const source = String(text || '');
    const index = Math.max(source.lastIndexOf('\n'), source.lastIndexOf('\r'));
    if (index < 0) return startsAtLineStart && /^[ \t]*$/.test(source);
    return /^[ \t]*$/.test(source.slice(index + 1));
  }

  function highlightExternalCommandWordsInText(htmlText, startsAtLineStart = false) {
    if (!SHELL_EXTERNAL_COMMAND_PATTERN) return String(htmlText || '');
    let output = String(htmlText || '').replace(SHELL_EXTERNAL_COMMAND_PATTERN, (_match, prefix, spacing, command, extension = '') => (
      `${prefix}${spacing}<span class="hljs-built_in">${command}${extension}</span>`
    ));
    if (startsAtLineStart && SHELL_EXTERNAL_COMMAND_LINE_START_PATTERN) {
      output = output.replace(SHELL_EXTERNAL_COMMAND_LINE_START_PATTERN, (_match, spacing, command, extension = '') => (
        `${spacing}<span class="hljs-built_in">${command}${extension}</span>`
      ));
    }
    return output;
  }

  function mapHighlightTextSegments(html, mapper, initialState = {}, protectedMapper = null) {
    const source = String(html || '');
    let output = '';
    let cursor = 0;
    let hljsSpanDepth = 0;
    const state = { ...initialState };
    const tagPattern = /<\/?span\b[^>]*>|<[^>]*>/gi;
    for (const match of source.matchAll(tagPattern)) {
      const text = source.slice(cursor, match.index);
      if (hljsSpanDepth) {
        if (protectedMapper) protectedMapper(text, state);
        output += text;
      } else {
        output += mapper(text, state);
      }
      const tag = match[0];
      output += tag;
      if (/^<span\b/i.test(tag) && HLJS_SPAN_CLASS_PATTERN.test(tag)) hljsSpanDepth += 1;
      else if (/^<\/span\b/i.test(tag) && hljsSpanDepth > 0) hljsSpanDepth -= 1;
      cursor = match.index + tag.length;
    }
    const tail = source.slice(cursor);
    if (hljsSpanDepth) {
      if (protectedMapper) protectedMapper(tail, state);
      output += tail;
    } else {
      output += mapper(tail, state);
    }
    return output;
  }

  function highlightExternalCommandWords(html) {
    return mapHighlightTextSegments(html, (text, state) => {
      const output = highlightExternalCommandWordsInText(text, state.atLineStart);
      if (text) state.atLineStart = textEndsAtLineStart(text, state.atLineStart);
      return output;
    }, { atLineStart: true }, (text, state) => {
      if (text) state.atLineStart = textEndsAtLineStart(text, state.atLineStart);
    });
  }

  function unhighlightBashBuiltinsInWindowsPaths(html) {
    return String(html || '').replace(/<span class="hljs-built_in">([^<]+)<\/span>(\\[^\s<]*)/g, '$1$2');
  }

  function highlightBashOptionsInText(htmlText) {
    return String(htmlText || '').replace(BASH_OPTION_PATTERN, (_match, prefix, option) => (
      `${prefix}<span class="hljs-literal">${option}</span>`
    ));
  }

  function highlightBashOptions(html) {
    return mapHighlightTextSegments(html, (text) => highlightBashOptionsInText(text));
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
      const highlighted = hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value;
      if (normalized === 'powershell') return highlightExternalCommandWords(highlighted);
      if (normalized === 'bash') return unhighlightBashBuiltinsInWindowsPaths(highlightBashOptions(highlightExternalCommandWords(highlighted)));
      return highlighted;
    } catch {
      return escapeHtml(source);
    }
  }

  function renderMarkdown(section) {
    const roleClass = section.role === 'web_result' ? ' webResultMarkdown' : '';
    return `<section class="eventSection mdBlock${roleClass}">${renderSectionTitle(section)}${section.html || ''}</section>`;
  }

  function renderWebRequest(section) {
    const groups = (section.groups || []).map((group) => {
      const items = (group.items || []).map((item) => {
        const entries = (item.entries || []).map((entry) => `<span class="webRequestMetaItem"><strong>${escapeHtml(entry.key || '')}</strong>${escapeHtml(entry.value || '')}</span>`).join('');
        return `<li class="webRequestItem"><div class="webRequestPrimary">${escapeHtml(item.primary || '')}</div>${entries ? `<div class="webRequestMeta">${entries}</div>` : ''}</li>`;
      }).join('');
      return items ? `<section class="webRequestGroup"><h4>${escapeHtml(group.title || '')}</h4><ol class="webRequestItems">${items}</ol></section>` : '';
    }).join('');
    const options = (section.options || []).map((entry) => `<span class="webRequestOption"><strong>${escapeHtml(entry.key || '')}</strong>${escapeHtml(entry.value || '')}</span>`).join('');
    return `<section class="eventSection webRequestBlock">${renderSectionTitle(section)}${groups}${options ? `<div class="webRequestOptions">${options}</div>` : ''}</section>`;
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
    return section?.type === 'code'
      && section.role === 'command'
      && (section.purpose === 'request' || section.purpose === undefined);
  }

  function isTerminalOutputSection(section) {
    return section?.type === 'terminal'
      && ['stdout', 'stderr'].includes(section.stream)
      && (section.purpose === 'result' || section.purpose === undefined);
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
    const items = (section.items || []).map((item) => `<div class="usageLimitItem"><strong>${escapeHtml(item.label || '')}</strong><span>${escapeHtml(item.remaining || '')} ${escapeHtml(tr('remaining'))}</span><em>${escapeHtml(tr('resets'))} ${escapeHtml(item.reset || '')}</em></div>`).join('');
    return `<section class="eventSection"><div class="usageLimitBlock">${renderSectionTitle(section)}${items}</div></section>`;
  }

  function renderUserInput(section) {
    const questions = (section.questions || []).map((question) => {
      const options = (question.options || []).map((option) => {
        const selected = option.selected ? ' selected' : '';
        const selectedLabel = option.selected ? `<span class="userInputSelected">${escapeHtml(tr('selected'))}</span>` : '';
        return `<li class="userInputOption${selected}"><div><strong>${escapeHtml(option.label || '')}</strong>${selectedLabel}</div>${option.description ? `<p>${escapeHtml(option.description)}</p>` : ''}</li>`;
      }).join('');
      const answers = (question.answers || []).map((answer) => `<span>${escapeHtml(answer)}</span>`).join('');
      return `<article class="userInputQuestion"><header><strong>${escapeHtml(question.title || tr('question'))}</strong></header>${question.prompt ? `<p class="userInputPrompt">${escapeHtml(question.prompt)}</p>` : ''}${options ? `<ul class="userInputOptions">${options}</ul>` : ''}${answers ? `<div class="userInputAnswer"><strong>${escapeHtml(tr('answer'))}</strong>${answers}</div>` : ''}</article>`;
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
    const steps = (section.steps || []).map((item) => `<li class="planUpdateStep"><span class="planStatus${planStatusClass(item.status)}">${escapeHtml(item.status || tr('unknown'))}</span><span>${escapeHtml(item.step || '')}</span></li>`).join('');
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
    const statuses = (section.statuses || []).map((item) => `<li><span>${escapeHtml(item.label || '')}</span><strong class="collaborationStatus${collaborationStatusClass(item.status)}">${escapeHtml(item.status || tr('unknown'))}</strong></li>`).join('');
    const timedOut = section.timedOut ? `<span class="collaborationStatus failed">${escapeHtml(tr('timedOut'))}</span>` : '';
    const message = section.messageHtml ? `<article class="collaborationBody"><h4>${escapeHtml(tr('message'))}</h4><div>${section.messageHtml}</div></article>` : '';
    const result = section.resultHtml ? `<article class="collaborationBody"><h4>${escapeHtml(tr('result'))}</h4><div>${section.resultHtml}</div></article>` : '';
    return `<section class="eventSection"><div class="collaborationBlock">${renderSectionTitle(section)}${targets ? `<div class="collaborationTargets"><strong>${escapeHtml(tr('targets'))}</strong>${targets}</div>` : ''}${fields ? `<dl class="collaborationFields">${fields}</dl>` : ''}${statuses || timedOut ? `<div class="collaborationStatuses">${timedOut}${statuses ? `<ul>${statuses}</ul>` : ''}</div>` : ''}${message}${result}</div></section>`;
  }

  function isSafeImagePreviewUrl(value) {
    return /^\/api\/sessions\/[^/?#]+\/events\/[^/?#]+\/image-previews\/[^/?#]+$/.test(String(value || ''));
  }

  function renderImagePreview(section) {
    const images = (section.images || []).filter((image) => isSafeImagePreviewUrl(image.src)).map((image) => `<figure><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || tr('imageAlt'))}" loading="lazy" decoding="async"><p class="imagePreviewError">${escapeHtml(tr('imageError'))}</p>${image.detail ? `<figcaption>${escapeHtml(image.detail)}</figcaption>` : ''}</figure>`).join('');
    const notice = section.notice || (!images ? tr('imageUnavailable') : '');
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

  function renderEventRefs(section) {
    const items = (section.items || []).map((item) => {
      const meta = [item.kind, item.status].filter(Boolean).join(' · ');
      return `<li><button class="smallBtn" type="button" data-detail-action="jump-event-ref" data-event-ref-id="${escapeHtml(item.id || '')}">${escapeHtml(item.label || item.id || '')}</button>${meta ? `<span>${escapeHtml(meta)}</span>` : ''}</li>`;
    }).join('');
    return `<section class="eventSection"><div class="eventRefsBlock">${renderSectionTitle(section)}<ul>${items}</ul></div></section>`;
  }

  function renderCodeModeTrace(section) {
    const open = section.expanded ? ' open' : '';
    const phases = (section.phases || []).map((phase) => {
      const entries = (phase.entries || []).map((entry) => `<span><strong>${escapeHtml(entry.key || '')}</strong>${escapeHtml(entry.value || '')}</span>`).join('');
      const output = phase.output ? `<pre><code>${escapeHtml(phase.output)}</code></pre>` : '';
      return `<article class="codeModeTracePhase"><header><strong>${escapeHtml(phase.title || '')}</strong>${entries ? `<div>${entries}</div>` : ''}</header>${output}</article>`;
    }).join('');
    return `<section class="eventSection"><details class="codeModeTrace"${open}><summary>${renderInlineTitle(section)}</summary><div class="codeModeTraceBody">${phases}</div></details></section>`;
  }

  function renderCodeModeSource(section) {
    const open = section.expanded ? ' open' : '';
    const language = section.language || 'javascript';
    return `<section class="eventSection"><details class="codeModeSource"${open}><summary><span>${renderInlineTitle(section)}</span><code>${escapeHtml(language)}</code></summary><div class="codeModeSourceBody"><pre><code class="language-${escapeHtml(language)} hljs">${highlightCode(section.code || '', language)}</code></pre></div></details></section>`;
  }

  function codeModeProjectionRequestBadge(value) {
    const badge = codeModePresentationContract.codeModeRequestEvidenceBadge(value);
    return badge ? { className: badge.className, label: tr(badge.labelKey) } : null;
  }

  function codeModeProjectionResultBadge(value) {
    const badge = codeModePresentationContract.codeModeResultAssociationBadge(value);
    return badge ? { className: badge.className, label: tr(badge.labelKey) } : null;
  }

  function renderCodeModeToolProjection(section) {
    const requestSections = Array.isArray(section.requestSections) ? section.requestSections : [];
    const resultSections = Array.isArray(section.resultSections) ? section.resultSections : [];
    const requestBadge = codeModeProjectionRequestBadge(section.requestEvidence);
    const resultBadge = codeModeProjectionResultBadge(section.resultAssociation);
    const badges = [
      requestBadge ? `<span class="codeModeEvidenceBadge requestEvidence ${requestBadge.className}">${escapeHtml(requestBadge.label)}</span>` : '',
      resultBadge ? `<span class="codeModeEvidenceBadge resultAssociation ${resultBadge.className}">${escapeHtml(resultBadge.label)}</span>` : '',
    ].join('');
    const toolName = section.toolName ? `<code class="codeModeToolProjectionTool">${escapeHtml(section.toolName)}</code>` : '';
    const requestBody = renderSections(requestSections);
    const resultBody = renderSections(resultSections);
    const request = requestBody
      ? `<div class="codeModeToolProjectionPart request"><div class="codeModeToolProjectionPartLabel">${escapeHtml(tr('request'))}</div><div class="codeModeToolProjectionSections">${requestBody}</div></div>`
      : '';
    const result = (section.resultObserved || resultSections.length) && resultBody
      ? `<div class="codeModeToolProjectionPart result"><div class="codeModeToolProjectionPartLabel">${escapeHtml(tr('result'))}</div><div class="codeModeToolProjectionSections">${resultBody}</div></div>`
      : '';
    const sourceOrder = Number.isFinite(section.sourceOrder) ? ` data-source-order="${escapeHtml(section.sourceOrder)}"` : '';
    return `<section class="eventSection codeModeToolProjection"${sourceOrder}><header class="codeModeToolProjectionHeader"><div class="codeModeToolProjectionHeading">${renderSectionTitle(section)}${toolName}</div>${badges ? `<div class="codeModeEvidenceBadges">${badges}</div>` : ''}</header><div class="codeModeToolProjectionBody">${request}${result}</div></section>`;
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
      case 'web_request':
        return renderWebRequest(section);
      case 'collaboration':
        return renderCollaboration(section);
      case 'image_preview':
        return renderImagePreview(section);
      case 'notice':
        return renderNotice(section);
      case 'raw_json':
        return renderRawJson(section);
      case 'event_refs':
        return renderEventRefs(section);
      case 'code_mode_trace':
        return renderCodeModeTrace(section);
      case 'code_mode_source':
        return renderCodeModeSource(section);
      case 'code_mode_tool_projection':
        return renderCodeModeToolProjection(section);
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

  function renderInspectorSections(sections) {
    return renderSections(detailPurpose.orderDetailSections(sections));
  }

  return {
    escapeHtml,
    orderDetailSections: detailPurpose.orderDetailSections,
    renderInspectorSections,
    renderSection,
    renderSections,
    renderTimelineSections,
  };
}));
