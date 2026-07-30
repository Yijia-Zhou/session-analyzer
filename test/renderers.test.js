'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSection, renderSections, renderTimelineSections } = require('../src/browser/renderers');

test('renderer outputs safe markdown, code, terminal, json, diff, notice, and kv fragments', () => {
  const markdown = renderSection({ type: 'markdown', title: 'Message', html: '<p><strong>safe</strong></p>' });
  const hiddenTitleMarkdown = renderSection({ type: 'markdown', title: 'Message', hideTitle: true, html: '<p>body</p>' });
  const code = renderSection({ type: 'code', title: 'Command', code: 'echo "<x>"', language: 'shell' });
  const terminal = renderSection({ type: 'terminal', title: 'stderr', text: 'boom', stream: 'stderr' });
  const json = renderSection({ type: 'json', title: 'Payload', value: { ok: true } });
  const diff = renderSection({ type: 'diff', title: 'Patch', text: '@@\n-old\n+new' });
  const notice = renderSection({ type: 'notice', title: 'Warning', text: '<script>', level: 'warning' });
  const kv = renderSection({ type: 'kv', title: 'Meta', entries: [{ key: 'cwd', value: 'G:\\repo' }] });
  const tokenUsage = renderSection({ type: 'token_usage', title: 'Token usage', items: [{ label: 'Total', formatted: '1,234', primary: true }] });
  const usageLimits = renderSection({ type: 'usage_limits', title: 'Usage limits', items: [{ label: 'Weekly usage limit', remaining: '67%', reset: 'May 20, 2026, 10:16 AM' }] });
  const userInput = renderSection({ type: 'user_input', title: 'User input', questions: [{ title: 'Display', prompt: 'Choose <mode>', options: [{ label: 'Timeline', description: 'Readable <detail>', selected: true }], answers: ['Timeline'] }] });
  const planUpdate = renderSection({ type: 'plan_update', title: 'Plan update', explanationHtml: '<p>Current progress</p>', steps: [{ step: 'Inspect parser', status: 'completed' }, { step: 'Patch regression', status: 'in_progress' }, { step: 'Wait', status: 'pending' }, { step: 'Investigate', status: 'blocked' }] });
  const collaboration = renderSection({ type: 'collaboration', title: 'Wait for subagent', targets: ['agent-<1>'], fields: [{ key: 'Timeout ms', value: '120000' }], statuses: [{ label: 'agent-1', status: 'completed' }, { label: 'agent-2', status: 'running' }, { label: 'agent-3', status: 'pending_init' }, { label: 'agent-4', status: 'failed' }], timedOut: true, messageHtml: '<p>Full message</p>', resultHtml: '<p>Full result</p>' });
  const imagePreview = renderSection({ type: 'image_preview', title: 'Image preview', images: [{ src: '/api/sessions/session/events/event/image-previews/preview', detail: 'high', alt: 'Preview <one>' }, { src: 'data:image/png;base64,aGVsbG8=', detail: 'unsafe' }, { src: '/api/raw?file=secret', detail: 'unsafe' }], notice: 'More <images> in raw refs' });
  const missingImagePreview = renderSection({ type: 'image_preview', title: 'Image preview', images: [], notice: 'Image <missing>' });
  const rawJson = renderSection({ type: 'raw_json', title: 'Raw JSON', value: { raw: true } });
  const expandedRawJson = renderSection({ type: 'raw_json', title: 'Raw JSON', value: { raw: true }, expanded: true });
  const eventRefs = renderSection({ type: 'event_refs', title: 'Observed nested activity', items: [{ id: 'event-<1>', label: 'Nested <tool>', kind: 'mcp_call', status: 'failed' }] });
  const codeModeTrace = renderSection({ type: 'code_mode_trace', title: 'Execution trace', phases: [{ title: 'Wait phase 1', entries: [{ key: 'Call', value: 'wait-<1>' }], output: 'pending <output>' }] });
  const webRequest = renderSection({
    type: 'web_request',
    title: 'Web request',
    groups: [{
      title: 'Queries',
      items: [{ primary: 'site:example.test <query>', entries: [{ key: 'Domains', value: 'example.test' }] }],
    }],
    options: [{ key: 'Response length', value: 'long' }],
  });
  const webResult = renderSection({ type: 'markdown', role: 'web_result', title: 'Web results', html: '<h2>Result</h2><p><a href="https://example.test">Example</a></p>' });

  assert.match(markdown, /<strong>safe<\/strong>/);
  assert.match(markdown, /class="sectionTitle">Message/);
  assert.doesNotMatch(hiddenTitleMarkdown, /sectionTitle/);
  assert.match(hiddenTitleMarkdown, /<p>body<\/p>/);
  assert.match(code, /echo/);
  assert.match(code, /&quot;&lt;x&gt;&quot;/);
  assert.match(code, /class="codeFence"/);
  assert.match(code, /class="language-shell hljs"/);
  assert.match(terminal, /terminalBlock stderr/);
  assert.match(terminal, /class="language-text"/);
  assert.match(json, /&quot;ok&quot;: true/);
  assert.match(diff, /diffLine removed/);
  assert.match(diff, /diffLine added/);
  assert.match(notice, /&lt;script&gt;/);
  assert.match(kv, /<table class="kvTable">/);
  assert.match(tokenUsage, /class="tokenUsageItem primary"/);
  assert.match(tokenUsage, /1,234/);
  assert.match(usageLimits, /Weekly usage limit/);
  assert.match(usageLimits, /67% remaining/);
  assert.match(userInput, /class="userInputOption selected"/);
  assert.match(userInput, /class="userInputSelected">Selected/);
  assert.match(userInput, /Choose &lt;mode&gt;/);
  assert.match(userInput, /Readable &lt;detail&gt;/);
  assert.match(planUpdate, /class="planStatus completed">completed/);
  assert.match(planUpdate, /class="planStatus inProgress">in_progress/);
  assert.match(planUpdate, /class="planStatus pending">pending/);
  assert.match(planUpdate, /class="planStatus blocked">blocked/);
  assert.match(collaboration, /class="collaborationBlock"/);
  assert.match(collaboration, /agent-&lt;1&gt;/);
  assert.match(collaboration, /class="collaborationStatus completed">completed/);
  assert.match(collaboration, /class="collaborationStatus running">running/);
  assert.match(collaboration, /class="collaborationStatus pending">pending_init/);
  assert.match(collaboration, /class="collaborationStatus failed">failed/);
  assert.match(collaboration, /class="collaborationStatus failed">timed out/);
  assert.match(collaboration, /Full message/);
  assert.match(collaboration, /Full result/);
  assert.match(imagePreview, /\/api\/sessions\/session\/events\/event\/image-previews\/preview/);
  assert.doesNotMatch(imagePreview, /data:image\/png/);
  assert.doesNotMatch(imagePreview, /\/api\/raw/);
  assert.match(imagePreview, /Preview &lt;one&gt;/);
  assert.match(imagePreview, /Image preview could not be loaded/);
  assert.match(imagePreview, /More &lt;images&gt; in raw refs/);
  assert.match(missingImagePreview, /Image &lt;missing&gt;/);
  assert.match(rawJson, /<details class="rawJsonDetails">/);
  assert.match(expandedRawJson, /<details class="rawJsonDetails" open>/);
  assert.match(codeModeTrace, /<details class="codeModeTrace">/);
  assert.doesNotMatch(codeModeTrace, /codeModeTrace" open/);
  assert.match(codeModeTrace, /Wait phase 1/);
  assert.match(codeModeTrace, /wait-&lt;1&gt;/);
  assert.match(codeModeTrace, /pending &lt;output&gt;/);
  assert.match(eventRefs, /data-detail-action="jump-event-ref"/);
  assert.match(eventRefs, /data-event-ref-id="event-&lt;1&gt;"/);
  assert.match(eventRefs, /Nested &lt;tool&gt;/);
  assert.doesNotMatch(eventRefs, /Nested <tool>/);
  assert.match(webRequest, /class="eventSection webRequestBlock"/);
  assert.match(webRequest, /site:example\.test &lt;query&gt;/);
  assert.match(webRequest, /Domains/);
  assert.match(webRequest, /Response length/);
  assert.match(webResult, /class="eventSection mdBlock webResultMarkdown"/);
  assert.match(webResult, /href="https:\/\/example\.test"/);
});

test('renderer projects Code Mode tools with neutral evidence and existing nested section structures', () => {
  const previousLocale = globalThis.sessionAnalyzerLocale;
  globalThis.sessionAnalyzerLocale = 'en';
  try {
    const shell = renderSection({
      type: 'code_mode_tool_projection',
      title: 'Shell <projection>',
      toolName: 'exec<tool>',
      requestEvidence: 'declared_source',
      resultAssociation: 'exact',
      requestSections: [{ type: 'code', title: 'Command', role: 'command', code: 'echo "<body>"', language: 'shell' }],
      resultSections: [{ type: 'terminal', title: 'stdout', stream: 'stdout', text: 'full result <body>', language: 'text' }],
      resultObserved: true,
      sourceOrder: 7,
    });
    const plan = renderSection({
      type: 'code_mode_tool_projection',
      title: 'Plan projection',
      toolName: 'update_plan',
      requestEvidence: 'declared_source',
      resultAssociation: 'bounded',
      requestSections: [{
        type: 'plan_update',
        title: 'Plan update',
        explanationHtml: '<p>Keep the structured card</p>',
        steps: [{ step: 'Inspect', status: 'completed' }, { step: 'Render', status: 'in_progress' }],
      }],
      resultSections: [{ type: 'code_mode_source', title: 'Associated result', code: '{}', language: 'text' }],
      resultObserved: true,
      sourceOrder: 8,
    });
    const withoutResult = renderSection({
      type: 'code_mode_tool_projection',
      title: 'Unpaired projection',
      requestEvidence: 'declared_source',
      resultAssociation: 'none',
      requestSections: [],
      resultSections: [],
      resultObserved: false,
      sourceOrder: 9,
    });
    const rejectedAliases = renderSection({
      type: 'code_mode_tool_projection',
      title: 'Rejected aliases',
      requestEvidence: 'observed_lifecycle',
      resultAssociation: 'exact_identity',
      requestSections: [{ type: 'notice', title: 'Request', text: 'fixture' }],
      resultSections: [],
      resultObserved: false,
      sourceOrder: 10,
    });

    assert.match(shell, /class="eventSection codeModeToolProjection" data-source-order="7"/);
    assert.match(shell, /Shell &lt;projection&gt;/);
    assert.match(shell, /exec&lt;tool&gt;/);
    assert.match(shell, /requestEvidence declaredSource">Declared request/);
    assert.match(shell, /resultAssociation exactIdentity">Result matched exactly/);
    assert.match(shell, /codeModeToolProjectionPart request/);
    assert.match(shell, /codeModeToolProjectionPart result/);
    assert.match(shell, /class="eventSection commandRun"/);
    assert.match(shell, /terminalBlock stdout/);
    assert.match(shell, /full result &lt;body&gt;/);
    assert.doesNotMatch(shell, /\bsuccess\b|\boutcome\b/i);

    assert.match(plan, /requestEvidence declaredSource">Declared request/);
    assert.doesNotMatch(plan, /resultAssociation/);
    assert.match(plan, /class="planUpdateBlock"/);
    assert.match(plan, /class="planUpdateSteps"/);
    assert.match(plan, /class="planStatus completed">completed/);
    assert.match(plan, /class="planStatus inProgress">in_progress/);
    assert.match(plan, /codeModeToolProjectionPart result/);
    assert.match(plan, /<details class="codeModeSource">/);
    assert.match(plan, /Associated result/);
    assert.doesNotMatch(withoutResult, /resultAssociation/);
    assert.doesNotMatch(rejectedAliases, /requestEvidence|resultAssociation/);

    globalThis.sessionAnalyzerLocale = 'zh-CN';
    const localized = renderSection({
      type: 'code_mode_tool_projection',
      title: '工具投影',
      requestEvidence: 'declared_source',
      resultAssociation: 'none',
      requestSections: [{ type: 'notice', title: '请求体', text: '内容' }],
      resultSections: [],
      resultObserved: false,
      sourceOrder: 11,
    });
    assert.match(localized, />声明的请求</);
    assert.doesNotMatch(localized, /resultAssociation/);
    assert.match(localized, /codeModeToolProjectionPartLabel">请求/);
  } finally {
    globalThis.sessionAnalyzerLocale = previousLocale;
  }
});

test('renderer keeps Code Mode source folded without changing ordinary code sections', () => {
  const source = renderSection({
    type: 'code_mode_source',
    title: 'Outer <JavaScript>',
    code: 'const value = "<source>";',
    language: 'javascript',
  });
  const expanded = renderSection({
    type: 'code_mode_source',
    title: 'Outer JavaScript',
    code: 'return 1;',
    language: 'javascript',
    expanded: true,
  });
  const ordinary = renderSection({ type: 'code', title: 'Command', code: 'echo full-size', language: 'shell' });

  assert.match(source, /<details class="codeModeSource">/);
  assert.doesNotMatch(source, /codeModeSource" open/);
  assert.match(source, /Outer &lt;JavaScript&gt;/);
  assert.match(source, /<code>javascript<\/code>/);
  assert.match(source, /class="language-javascript hljs"/);
  assert.match(source, /&quot;&lt;source&gt;&quot;/);
  assert.match(expanded, /<details class="codeModeSource" open>/);
  assert.match(ordinary, /class="codeFence"/);
  assert.doesNotMatch(ordinary, /codeModeSource/);
});

test('renderer outputs patch sections with file summaries, line numbers, and escaped code', () => {
  const patch = renderSection({
    type: 'patch',
    title: 'Patch',
    files: [{
      path: 'src/app.js',
      changeType: 'update',
      additions: 1,
      deletions: 1,
      hunks: [{
        header: '@@',
        lineNumbers: false,
        lines: [
          { kind: 'context', oldLine: 1, newLine: 1, lineNumberReliable: false, content: 'const ok = true;' },
          { kind: 'removed', oldLine: 2, newLine: null, lineNumberReliable: false, content: '<old>' },
          { kind: 'added', oldLine: null, newLine: 2, lineNumberReliable: false, content: '<new>' },
        ],
      }],
      lineNumbers: false,
    }],
  });

  assert.match(patch, /src\/app\.js/);
  assert.match(patch, /class="eventSection patchBlock"/);
  assert.doesNotMatch(patch, /<div class="patchBlock"/);
  assert.doesNotMatch(patch, /class="sectionTitle">Patch/);
  assert.match(patch, /\+1 \/ -1/);
  assert.match(patch, /patchLine context/);
  assert.match(patch, /patchLine removed/);
  assert.match(patch, /patchLine added/);
  assert.match(patch, /patchLineNo muted/);
  assert.match(patch, /&lt;new&gt;/);
});

test('renderer shows reliable patch line numbers when available', () => {
  const patch = renderSection({
    type: 'patch',
    files: [{
      path: 'src/app.js',
      changeType: 'update',
      additions: 1,
      deletions: 1,
      lineNumbers: true,
      hunks: [{
        header: '@@ -9,1 +9,1 @@',
        lineNumbers: true,
        lines: [
          { kind: 'removed', oldLine: 9, newLine: null, lineNumberReliable: true, content: 'old();' },
          { kind: 'added', oldLine: null, newLine: 9, lineNumberReliable: true, content: 'newCall();' },
        ],
      }],
    }],
  });

  assert.match(patch, /patchLineNo">9/);
  assert.doesNotMatch(patch, /patchLineNo muted/);
});

test('renderer groups command and terminal sections as one command run', () => {
  const html = renderSections([
    { type: 'code', title: 'Command', code: 'echo "<x>"', language: 'shell' },
    { type: 'terminal', title: 'stdout', text: 'ok', stream: 'stdout', language: 'text' },
    { type: 'terminal', title: 'stderr', text: '<boom>', stream: 'stderr', language: 'text' },
  ]);

  assert.match(html, /class="eventSection commandRun"/);
  assert.match(html, /commandRunSegment commandRunCommand/);
  assert.match(html, /commandRunOutput stdout/);
  assert.match(html, /commandRunOutput stderr/);
  assert.match(html, /echo/);
  assert.match(html, /&quot;&lt;x&gt;&quot;/);
  assert.match(html, /&lt;boom&gt;/);
  assert.doesNotMatch(html, /class="codeFence"/);
});

test('renderer keeps an escaped preview when expanded timeline detail is inspector-only', () => {
  const fallback = renderTimelineSections([], 'cwd: G:\\repo <unsafe>');
  const body = renderTimelineSections([{ type: 'notice', title: 'Status', text: 'Done.' }], 'duplicate preview');

  assert.match(fallback, /eventExpandedFallback/);
  assert.match(fallback, /cwd: G:\\repo &lt;unsafe&gt;/);
  assert.doesNotMatch(fallback, /<unsafe>/);
  assert.match(body, /Done\./);
  assert.doesNotMatch(body, /duplicate preview/);
});

test('renderer applies highlight.js syntax highlighting when available', () => {
  const previous = globalThis.hljs;
  globalThis.hljs = {
    getLanguage: (language) => language === 'powershell' || language === 'javascript',
    highlight: (source, options) => ({
      value: `<span class="hljs-title">${source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span><span class="hljs-language">${options.language}</span>`,
    }),
  };
  try {
    const command = renderSections([
      {
        type: 'code',
        title: 'Command',
        code: 'powershell.exe -Command "Get-ChildItem <x>" $env:Path',
        language: 'powershell',
      },
    ]);
    const patch = renderSection({
      type: 'patch',
      files: [{
        path: 'src/app.js',
        changeType: 'update',
        additions: 1,
        deletions: 0,
        hunks: [{ lines: [{ kind: 'added', oldLine: null, newLine: 1, content: 'const ok = true;' }] }],
      }],
    });

    assert.match(command, /hljs-title/);
    assert.match(command, /hljs-language">powershell/);
    assert.match(command, /&lt;x&gt;/);
    assert.doesNotMatch(command, /<x>/);
    assert.match(patch, /language-javascript hljs/);
    assert.match(patch, /const ok = true/);
  } finally {
    globalThis.hljs = previous;
  }
});

test('renderer enhances shell command highlighting without touching protected spans', () => {
  const previous = globalThis.hljs;
  globalThis.hljs = {
    getLanguage: (language) => language === 'bash' || language === 'powershell',
    highlight: (source) => ({
      value: source === 'ignored by mock'
        ? '<span class="hljs-comment"># git status; rg TODO</span>\n<span class="hljs-string">&quot;git status; rg TODO&quot;</span>\npython3 -m <span class="hljs-params">-m</span> pytest\n; rg live\nWrite-Output <span class="hljs-comment"># still protected\n</span>rg after-comment'
        : source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    }),
  };
  try {
    const bashCommand = renderSections([
      {
        type: 'code',
        title: 'Command',
        code: 'rg -n -F "TODO" src | git grep "highlight"',
        language: 'shell',
      },
    ]);
    const powershellCommand = renderSections([
      {
        type: 'code',
        title: 'Command',
        code: 'Write-Output git; Git.EXE status --short; pip3 install tox; python3 -m pytest',
        language: 'powershell',
      },
    ]);
    const protectedTokens = renderSections([
      {
        type: 'code',
        title: 'Command',
        code: 'ignored by mock',
        language: 'powershell',
      },
    ]);

    assert.match(bashCommand, /<span class="hljs-built_in">rg<\/span>/);
    assert.match(bashCommand, /<span class="hljs-literal">-n<\/span>/);
    assert.match(bashCommand, /<span class="hljs-literal">-F<\/span>/);
    assert.match(bashCommand, /<span class="hljs-built_in">git<\/span> grep/);
    assert.match(powershellCommand, /Write-Output git; <span class="hljs-built_in">Git\.EXE<\/span> status/);
    assert.match(powershellCommand, /; <span class="hljs-built_in">pip3<\/span> install tox/);
    assert.match(powershellCommand, /; <span class="hljs-built_in">python3<\/span> -m pytest/);
    assert.doesNotMatch(powershellCommand, /Write-Output <span class="hljs-built_in">git<\/span>/);
    assert.match(protectedTokens, /<span class="hljs-comment"># git status; rg TODO<\/span>/);
    assert.match(protectedTokens, /<span class="hljs-string">&quot;git status; rg TODO&quot;<\/span>/);
    assert.match(protectedTokens, /<span class="hljs-built_in">python3<\/span> -m <span class="hljs-params">-m<\/span> pytest/);
    assert.doesNotMatch(protectedTokens, /<span class="hljs-built_in">pytest<\/span>/);
    assert.match(protectedTokens, /; <span class="hljs-built_in">rg<\/span> live/);
    assert.match(protectedTokens, /Write-Output <span class="hljs-comment"># still protected\n<\/span><span class="hljs-built_in">rg<\/span> after-comment/);
    assert.doesNotMatch(protectedTokens, /hljs-comment"># <span class="hljs-built_in">git<\/span>/);
    assert.doesNotMatch(protectedTokens, /hljs-string">&quot;<span class="hljs-built_in">git<\/span>/);
  } finally {
    globalThis.hljs = previous;
  }
});

test('renderer does not highlight bash built-ins inside Windows path arguments', () => {
  const previous = globalThis.hljs;
  globalThis.hljs = {
    getLanguage: (language) => language === 'bash',
    highlight: () => ({
      value: 'rg -n <span class="hljs-built_in">test</span>\\codex.test.js <span class="hljs-string">"-F"</span> <span class="hljs-built_in">echo</span> ok',
    }),
  };
  try {
    const html = renderSections([
      {
        type: 'code',
        title: 'Command',
        code: 'ignored by mock',
        language: 'shell',
      },
    ]);

    assert.match(html, /<span class="hljs-built_in">rg<\/span> <span class="hljs-literal">-n<\/span> test\\codex\.test\.js <span class="hljs-string">"-F"<\/span> <span class="hljs-built_in">echo<\/span> ok/);
    assert.doesNotMatch(html, /<span class="hljs-built_in">test<\/span>\\codex\.test\.js/);
    assert.doesNotMatch(html, /<span class="hljs-string">"<span class="hljs-literal">-F<\/span>"<\/span>/);
  } finally {
    globalThis.hljs = previous;
  }
});

test('renderer treats shared command words as regex literals', () => {
  const rendererPath = require.resolve('../src/browser/renderers');
  const commandHighlightingPath = require.resolve('../src/shared/command-highlighting');
  const previousRenderer = require.cache[rendererPath];
  const previousCommandHighlighting = require.cache[commandHighlightingPath];
  const previousHljs = globalThis.hljs;
  try {
    delete require.cache[rendererPath];
    require.cache[commandHighlightingPath] = {
      id: commandHighlightingPath,
      filename: commandHighlightingPath,
      loaded: true,
      exports: { SHELL_EXTERNAL_COMMAND_WORDS: ['foo.bar', 'tool+'] },
    };
    globalThis.hljs = {
      getLanguage: (language) => language === 'powershell',
      highlight: (source) => ({ value: source }),
    };
    const isolatedRenderers = require('../src/browser/renderers');
    const html = isolatedRenderers.renderSections([
      { type: 'code', title: 'Command', code: 'fooXbar ok; foo.bar ok; tool+ ok', language: 'powershell' },
    ]);

    assert.match(html, /fooXbar ok; <span class="hljs-built_in">foo\.bar<\/span> ok; <span class="hljs-built_in">tool\+<\/span> ok/);
    assert.doesNotMatch(html, /<span class="hljs-built_in">fooXbar<\/span>/);
  } finally {
    globalThis.hljs = previousHljs;
    delete require.cache[rendererPath];
    if (previousRenderer) require.cache[rendererPath] = previousRenderer;
    else delete require.cache[rendererPath];
    if (previousCommandHighlighting) require.cache[commandHighlightingPath] = previousCommandHighlighting;
    else delete require.cache[commandHighlightingPath];
  }
});
