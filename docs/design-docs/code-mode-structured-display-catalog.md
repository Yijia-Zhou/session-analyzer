# Code Mode Structured Display Catalog and Tuning Guide / Code Mode 结构化显示目录与调优指南

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: implementation snapshot and review worksheet / 状态：实现现状快照与评审工作表
- Snapshot date: 2026-07-25 / 快照日期：2026-07-25
- Canonical design: `docs/design-docs/code-mode-operations.md` / 规范设计：`docs/design-docs/code-mode-operations.md`
- Main implementation: `src/codex-code-mode-declared.js`, `src/codex-detail.js`, `src/codex.js`, `src/browser/renderers.js`, and `src/shared/i18n.js` / 主要实现：`src/codex-code-mode-declared.js`、`src/codex-detail.js`、`src/codex.js`、`src/browser/renderers.js` 与 `src/shared/i18n.js`

## Purpose and reading rules / 目的与阅读规则

This document records the display behavior that is implemented today for Code Mode Operations and every currently allowlisted Nested Tool Projection. It also records the separate name-only request facts that make safe declared requests discoverable and foldable. It gives one concrete fine-tuning proposal and acceptance focus for each tool so a reviewer can decide changes tool by tool. It is a display catalog, not a new canonical event contract. / 本文档记录当前已经实现的 Code Mode Operation 显示行为，以及 allowlist 中每一种嵌套工具投影的具体呈现方式；同时记录让安全声明 request 可被发现和折叠的独立、仅名称事实。它还为每个工具给出一份具体的调优建议和验收重点，便于逐项决策。它是显示目录，不是新的 canonical event contract。

Each tool entry uses these labels: / 每个工具条目使用以下标签：

- **Current / 当前** is a factual description of the implementation at the snapshot date. / **Current / 当前** 是快照日期对应实现的事实描述。
- **Fine-tune / 调优建议** is proposed behavior and is not implemented unless explicitly stated. / **Fine-tune / 调优建议** 是候选行为；除非明确说明，否则尚未实现。
- **Acceptance / 验收** names the cases that should be frozen in fixtures or browser checks if the proposal is selected. / **Acceptance / 验收** 列出选择该建议后应由 fixture 或浏览器检查固定的场景。
- **Decision / 决定** is intentionally left `TBD / 待定` for review. / **Decision / 决定** 有意保留为 `TBD / 待定`，供评审填写。

In this catalog, “projection” or “display event” means an operation-owned UI fragment. It does not mean an independently counted Logical Event. / 本目录中的“投影”或“显示 event”指 operation 自有的 UI 片段，并不表示一个可独立计数的逻辑事件。

## Shared outer display / 共同的外层显示

One grouped operation remains one canonical Logical Event with `kind: code_mode_operation` and `toolName: exec`. Declared nested projections do not receive event IDs, metrics, search owners, Raw refs, status, severity, or escalation tags. Independently persisted Observed Nested Activity remains visible as its own Logical Event. / 一个分组后的 operation 仍是单个 canonical 逻辑事件，使用 `kind: code_mode_operation` 与 `toolName: exec`。声明式嵌套投影不拥有 event ID、指标、搜索 owner、Raw refs、status、severity 或提权标签。独立持久化的已观测嵌套活动仍以自己的逻辑事件显示。

```text
outer exec call/output + zero or more waits
                    |
                    v
one Code Mode Operation Logical Event
  Timeline
    - one safe declaration: native structured tool sections
    - multiple safe declarations: a collapsed declared-sequence preview, Nested Tool Projection cards + folded source
    - uncertain program: a collapsed source excerpt and raw JavaScript Command
    - observed operation output remains explicit when it does not meet the supported result-output shape
  Inspector
    - Operation metadata
    - single-tool projection evidence, outer source, context, and wait trace
    - Observed nested activity links, when uniquely associated
```

```text
外层 exec 调用/输出 + 零到多次 wait
                    |
                    v
一个 Code Mode Operation 逻辑事件
  时间线
    - 一个安全声明：工具原生结构化 sections
    - 多个安全声明：折叠态声明顺序预览、嵌套工具投影卡片及折叠源码
    - 不确定程序：折叠态源码摘录与 raw JavaScript Command
    - 未关联 outer output 保持明确可见
  Inspector
    - Operation metadata
    - 单工具投影证据、outer source、context 与 wait trace
    - 唯一关联时显示已观测嵌套活动链接
```

### Cold request facts, controls, and evidence boundary / 冷启动请求事实、控件与证据边界

The outer operation's safely declared tool names are indexed during cold Session construction through the same exact outer-exec source lookup and all-or-nothing projector used by detail. The independent index keeps only `{ toolNames, requestEvidence: 'declared_source' }` per existing operation ID. Timeline DTOs may expose that small value as `presentationFacts.codeModeDeclaredRequests`; request arguments, AST nodes, outer source, result association, and all execution evidence remain detail-only or canonical evidence surfaces. The fact never rewrites `kind: code_mode_operation`, `toolName: exec`, event identity, status, metrics, search ownership, Raw refs, escalation, result, or outcome. / 外层 operation 安全声明的工具名称会在冷启动构建 Session 时，通过与 detail 相同的精确 outer-exec 源码查找和全有或全无 projector 建立索引。独立索引只会为既有 operation ID 保存 `{ toolNames, requestEvidence: 'declared_source' }`。Timeline DTO 可以将这个小型值作为 `presentationFacts.codeModeDeclaredRequests` 暴露；request 参数、AST 节点、outer source、result association 以及全部执行证据仍只存在于 detail 或 canonical 证据表面。该事实绝不会改写 `kind: code_mode_operation`、`toolName: exec`、事件 identity、status、指标、搜索 ownership、Raw refs、提权、result 或 outcome。

The Main-only `Code Mode request / Code Mode 请求` query remains a separate backend dimension from Event type, but the browser nests it under the Kind selector's `Code Mode tool call` branch. That branch has no all-operation choice: `Scripted operation` selects the exact no-fact fallback set through `kind=code_mode_script_operation`, while a declared-request child atomically projects to `kind=code_mode_operation` plus the stable `codeModeRequest=<tool-name>` filter. Each appears as one visible Kind filter. State/timeline catalogs expose the Scripted-operation presentation facet and `codeModeRequests` rows with stable values, localized labels, operation counts, and evidence metadata. A repeated declaration contributes one operation to that tool's count; a multi-tool operation can belong to several request rows but remains one returned event. Filters compose with `q`, `status`, and `file` on the same canonical parent, while `status` and `file` remain canonical-only. Selecting Scripted operation, another Kind, Protocol, or Raw clears the request filter. / 仅在 Main 层可用的 `Code Mode request / Code Mode 请求` 查询在后端仍是独立于事件类型的维度，但浏览器会将它嵌入类型选择器的 `Code Mode 工具调用` 分支。该分支不再提供“全部 operation”选项：“脚本化操作”通过 `kind=code_mode_script_operation` 选择精确的无事实回退集合，声明 request 子项则原子投影为 `kind=code_mode_operation` 加稳定的 `codeModeRequest=<tool-name>` 筛选。每个选择都只显示为一个类型筛选。State/timeline 目录会暴露“脚本化操作”presentation facet，以及带稳定 value、本地化 label、按 operation 计数和 evidence 元数据的 `codeModeRequests` 行。重复声明只向该工具贡献一个 operation 计数；多工具 operation 可以属于多个 request 行，但仍是一个返回事件。筛选与 `q`、`status` 和 `file` 在同一个 canonical 父事件上组合，而 `status` 和 `file` 继续只读取 canonical 事实。选择“脚本化操作”、其他类型、Protocol 或 Raw 都会清除 request 筛选。

Whole-program eligibility remains fail-closed: dynamic arguments or dispatch, unsupported bindings, branches, loops, concurrency, unknown tools, syntax errors, and source/call/literal budget failures add no request fact or request row. Those no-fact Code Mode events are the exact `Scripted operation` fallback set and receive one separate folding row; there is no all-Code-Mode folding rule. Observed Nested Activity is neither merged nor hidden by a declared request fact. `codeModeRequestStates` is an additive folding-rule family. An explicit request rule contributes directly; an unset request follows the corresponding evidence-neutral ordinary-call kind or tool-name condition, while execution-dependent facts remain absent. Every resulting request contribution participates with the canonical kind rule and existing condition rules in the usual most-visible merge. Historical valid tool keys persist in the editor's `Other / historical requests` group. / 整段程序资格继续保守失败：动态参数或分派、不受支持的 binding、分支、循环、并发、未知工具、语法错误以及 source/call/literal 预算失败都不会增加 request 事实或 request 行。这些缺少事实的 Code Mode event 正是“脚本化操作”回退集合，并获得一条独立折叠规则；不再提供作用于全部 Code Mode 的折叠规则。Observed Nested Activity 不会因声明 request 事实被合并或隐藏。`codeModeRequestStates` 是增量折叠规则族：显式 request 规则直接贡献状态；未设置的 request 沿用对应且不携带执行证据的普通调用 kind 或工具名条件，同时继续缺失所有依赖执行的事实。由此得到的每个 request 贡献都会与 canonical kind 规则和既有 condition 规则一起参与常规的最可见合并。历史上有效的工具 key 会在编辑器的“其他/历史请求”组中保留。

### Timeline composition / 时间线组成

Summary-state Code Mode previews are visually distinct, readable inset summaries rather than multi-line raw-code fragments. The full JavaScript remains an expanded-body disclosure. / 摘要态的 Code Mode 预览在视觉上使用易读的内嵌摘要，而不是多行原始代码片段；完整 JavaScript 仍只在展开正文中披露。

For raw `Scripted operation / 脚本化操作` fallback, the collapsed preview remains one sanitized source line, produced after whole-source sanitization and then source-line selection. Selection scans line boundaries incrementally and retains only fixed candidate offsets, materializing at most the final two lines instead of allocating per source line. Its frameless summary row uses up to two source-ordered plain-text logical lines, each on one independently ellipsized visual row; a lone logical line is not enlarged to fill the card. The label is shortened to `Source / 源码` and visually muted. Direct-call preview lines omit the leading `tools.` namespace without changing expanded source. If more raw source was omitted or a selected line was clipped, a separate non-numeric `…` indicates continuation. It is deliberately not a tool chip, tool count, declaration list, or execution claim. / 对 raw “脚本化操作”回退，折叠态预览仍是一条已脱敏源码行，它先经过整段源码脱敏，再进行源码行选择。选择过程会增量扫描行边界并只保留固定数量的候选 offset，最多只物化最终两行，而不会为每条源码行分配对象。其无内框摘要行最多使用两条按源码顺序排列的纯文本逻辑行，每条占用一条独立省略的视觉行；不会为了填满卡片而放大单条逻辑行。标签缩短为 `Source / 源码` 并降低视觉强调。直接调用预览行会省略开头的 `tools.` 命名空间，但不会改变展开态源码。若还有 raw 源码被省略或已选行被截断，则以独立、非计数的 `…` 表示延续。它刻意不是工具 chip、工具数量、声明列表或执行断言。

For `single_tool`, folded states use a frameless `Request / 请求` row without repeating the native tool title. Preview content is request-only and exhaustive across the safe-tool allowlist: plan steps, shell commands, web queries/URLs, patch paths, user-input prompts, image paths, collaboration targets/messages, goal fields, MCP resource identifiers, plugin identifiers, and generation prompts receive specialized summaries. Remaining literal requests use a bounded sanitized scalar. Only omitted or structurally empty requests render `No arguments / 无参数`; explicit `null` renders `Request: null / 请求：空值`, while nonempty requests containing only empty containers use a bounded field/shape summary such as `Plan: empty list / 计划：空列表`. Response-derived fields co-located in expanded request sections remain excluded. / 对 `single_tool`，折叠状态使用无内框的 `Request / 请求` 行，且不重复原生工具标题。预览内容仅来自 request，并完整覆盖安全工具 allowlist：plan 步骤、shell command、web query/URL、patch 路径、user-input 问题、image 路径、collaboration target/message、goal 字段、MCP resource 标识、plugin 标识与 generation prompt 都使用专用摘要。其余 literal request 使用有界脱敏标量。只有省略参数或结构上为空的 request 才显示 `No arguments / 无参数`；显式 `null` 显示 `Request: null / 请求：空值`，仅包含空容器的非空 request 则使用有界字段/形态摘要，例如 `Plan: empty list / 计划：空列表`。展开态 request section 中并置的响应派生字段仍会被排除。

- If the whole JavaScript program passes projection eligibility with exactly one declaration, the projection wrapper is removed and its existing tool-specific sections become the timeline body. The header uses the tool's presentation label/name plus one Code Mode source tag; canonical event fields remain unchanged. / 如果整段 JavaScript 通过投影资格检查且恰好包含一个声明，投影 wrapper 会被移除，其既有工具专用 sections 成为时间线正文。Header 使用该工具的 presentation label/name，并显示一个代码模式来源标签；canonical event 字段保持不变。
- If eligibility produces two or more declarations, the collapsed or summary card adds a bounded `Declared sequence / 声明顺序` line before expansion: it preserves source order, shows at most two localized projection labels with concise request-only detail, excludes response-derived values co-located by an expanded renderer, and uses `+N` for the remainder. Expanded cards still appear in source order, followed by a collapsed `Code Mode source`; the header says `Multiple operations / 多个操作`, shows the declared-request count, and retains the shared Code Mode source tag. / 如果资格检查产生两个及以上声明，折叠或摘要卡会在展开前增加一行有上限的“声明顺序”：它保留源码顺序，最多显示两个本地化投影展示名及精简的 request-only 详情，排除展开 renderer 并置的响应派生值，剩余项使用 `+N`。展开后的卡片仍按源码顺序出现，之后是默认折叠的 `Code Mode source`；header 显示“多个操作”、声明 request 数量，并保留共享的代码模式来源标签。
- If eligibility fails anywhere, no partial cards are shown. The operation falls back to a normal JavaScript `Command` section under the `Scripted operation / 脚本化操作` title; before expansion it shows one sanitized `Source / 源码` preview chosen from the outer JavaScript, not a tool-list inference. / 只要任一位置未通过资格检查，就不显示局部卡片；整个 operation 回退为普通 JavaScript `Command` section，标题为“脚本化操作”；展开前会显示从 outer JavaScript 选出的一条已脱敏“源码”预览，而不是工具列表推断。
- If every declared result is conservatively associated, the aggregate `Final output` is suppressed because each full result fragment is retained in the single native body or its owning multi-tool card. / 如果每一个声明结果都被保守关联，聚合 `Final output` 会被抑制，因为每个完整结果 fragment 已保留在单工具原生正文或对应多工具卡片内。
- If a single declaration has an observed final output that does not meet the supported result-output shape, it remains primary under `Operation output / 操作输出`; multi-tool and raw fallback keep `Final output / 最终输出`. / 如果单个声明存在不满足受支持结果输出形态的最终已观测输出，它继续以 `Operation output / 操作输出` 作为主要内容；多工具与 raw fallback 继续使用 `Final output / 最终输出`。
- If waits exist, all exec/wait phase IDs, evidence states, observation states, cells, and intermediate outputs are placed in one collapsed `Execution trace`. Single-tool trace lives in the inspector; multi-tool and raw-fallback trace stays in the timeline. The final observed output is not duplicated inside the trace. / 如果存在 wait，全部 exec/wait phase 的 ID、证据状态、观测状态、cell 与中间输出都放入一个默认折叠的 `Execution trace`。单工具 trace 位于 inspector；多工具与 raw fallback trace 继续位于时间线。最终已观测输出不会在 trace 中重复。
- ANSI terminal control sequences are removed from display text. Raw refs retain the source bytes and original fragments. / 展示文本会移除 ANSI 终端控制序列；Raw refs 仍保留来源字节和原始 fragments。

### Inspector composition / Inspector 组成

- `Operation metadata` shows Evidence, Observation, Cell, and Poll count. / `Operation metadata` 显示 Evidence、Observation、Cell 与 Poll count。
- Single-tool inspector additionally shows `Projection evidence`, outer `Code Mode source`, command context/result metadata when applicable, and wait trace. / 单工具 inspector 还会显示 `Projection evidence`、outer `Code Mode source`、适用时的命令 context/result metadata，以及 wait trace。
- `Observed nested activity` appears only when physical-interval association is unique; it links to canonical nested Logical Events without copying their Raw refs. / 只有物理区间关联唯一时才显示 `Observed nested activity`；它链接到 canonical 嵌套逻辑事件，但不复制其 Raw refs。
- Operation observation state is not an outcome. `terminal` does not mean success, and `pending`, `unobserved_terminal`, or `incomplete_tail` do not enter failed-command counts. / Operation 的观测状态不是执行结果；`terminal` 不等于成功，`pending`、`unobserved_terminal` 与 `incomplete_tail` 也不进入失败命令计数。

### Accepted adaptive outer display / 已接受的自适应外层显示

- Keep the command/request and meaningful final result as the largest visual regions. Keep operation metadata in the inspector and wait history collapsed. / 继续让命令或 request 与有意义的最终结果占据最大的视觉区域；operation metadata 留在 inspector，wait 历史默认折叠。
- Let each tool choose a compact request/result layout. Every Code Mode header keeps the Code Mode source tag but omits the machine `exec` tool-name chip; request evidence, machine tool name, protocol channel, and Raw-ref count stay in the inspector. An observed operation output that remains separate receives no header badge. Multi-tool headers pair the `Multiple operations` title with only the tool count; their content signal lives in the separate declared-sequence preview rather than additional header chips, and each projection still carries its card-level evidence. / 允许每种工具选择紧凑的 request/result 布局。每个 Code Mode header 都保留代码模式来源标签，但省略机器 `exec` 工具名 chip；request evidence、机器工具名、协议 channel 与 Raw-ref 数量留在 inspector。保持分离的已观测操作输出不显示 header 标记。多工具 header 将“多个操作”标题与工具数量配对；内容信号位于独立的声明顺序预览，而不是额外的 header chip；每个投影仍保留卡片级证据。
- Treat empty acknowledgement payloads such as `{}` as low-information content: keep them reachable under the existing associated-result disclosure, but do not let them compete visually with a plan, command output, patch, prompt, or resource body. / 将 `{}` 等空确认 payload 视为低信息内容：仍通过既有的关联结果折叠区可访问，但不让它们在视觉上与计划、命令输出、补丁、提示词或资源正文争夺空间。
- Acceptance: direct terminal exec, request-only projection, complete bounded association, incomplete association, raw fallback, pending/multi-wait, incomplete tail, unobserved terminal, and observed nested lifecycle must all retain identical event counts and Raw-ref ownership. / 验收：直接终态 exec、仅 request 投影、完整 bounded 关联、不完整关联、raw fallback、pending/multi-wait、incomplete tail、unobserved terminal 与已观测嵌套 lifecycle 都必须保持相同的事件计数与 Raw-ref 所有权。
- Acceptance: safe single, multi-tool, and duplicate declarations expose only name-only request facts; all dynamic, control-flow, unknown, syntax, and budget fallbacks expose none. Request filters/catalogs and request folding rules must preserve canonical event identity, evidence ownership, counts, and independently visible nested activity. / 验收：安全的 single、多工具和重复声明只暴露仅名称的 request 事实；所有动态、控制流、未知工具、语法和预算回退都不暴露任何事实。Request 筛选/目录和 request 折叠规则必须保持 canonical 事件 identity、证据 ownership、计数以及独立可见的 nested activity。
- Decision / 决定：`Accepted 2026-07-16 / 2026-07-16 已接受`

## Projection eligibility and evidence / 投影资格与证据

### Static extraction / 静态提取

The analyzer parses with Acorn and never executes the JavaScript. Extraction is all-or-nothing for the whole program. Current budgets are 100,000 source characters, 24 declared calls, literal depth 16, and 1,000 literal nodes. / Analyzer 使用 Acorn 解析，绝不执行 JavaScript。提取对整段程序采用全有或全无策略。当前预算为 100,000 个源码字符、24 个声明调用、literal 深度 16 与 1,000 个 literal 节点。

The accepted top-level grammar is limited to: / 可接受的顶层语法仅包括：

- `const result = await tools.<known_tool>(<bounded literal>);` / `const result = await tools.<known_tool>(<受限 literal>);`
- `await tools.<known_tool>(<bounded literal>);` / `await tools.<known_tool>(<受限 literal>);`
- `text(result);` for a previously declared result variable / 对先前声明的结果变量调用 `text(result);`
- Empty statements / 空语句

Accepted literal values are `null`, booleans, finite numbers, strings, static template literals, arrays, ordinary object literals, and unary `+` or `-` numeric values. Control flow, loops, concurrency, dynamic arguments or tool properties, spread, computed or shorthand properties, unsafe `__proto__`, unknown tools, duplicate/complex bindings, and parse errors force whole-program raw fallback. / 可接受的 literal 值包括 `null`、布尔值、有限数字、字符串、静态模板字符串、数组、普通对象 literal，以及一元 `+` 或 `-` 数字。控制流、循环、并发、动态参数或工具属性、spread、computed 或 shorthand 属性、不安全的 `__proto__`、未知工具、重复或复杂 binding 与解析错误，都会触发整段程序 raw fallback。

### Request and result evidence / Request 与 result 证据

- Current projections always use `requestEvidence: declared_source`, displayed as `Declared request / 声明的请求`. This means the source declared the request; it does not prove execution. / 当前投影始终使用 `requestEvidence: declared_source`，显示为 `Declared request / 声明的请求`。它只表示源码声明了该 request，并不证明实际执行。
- The producer currently emits only `resultAssociation: bounded` or `none`. Inspector evidence retains those machine values, but compact timeline headers render no association badge. When an observed final operation output exists with `none`, it remains in a separate `Operation output / 操作输出` section. / 当前 producer 只会发出 `resultAssociation: bounded` 或 `none`。Inspector 证据继续保留这些机器值，但紧凑时间线 header 不显示关联标记。当 `none` 存在最终已观测操作输出时，它会保留在独立的 `Operation output / 操作输出` 区域。
- The browser renderer recognizes an `exact` badge, but the production projection path does not emit exact associations or populate exact-result sections. `exact` remains reserved for a future persisted identity edge. / 浏览器 renderer 能识别 `exact` badge，但生产投影路径不会发出 exact 关联，也不会填充 exact 结果 section；`exact` 仍保留给未来持久化的 identity 边。
- `bounded` is considered only for a single direct terminal exec phase with no waits. The outer output must be a typed text array whose first fragment is the canonical `Script completed` status-only envelope; all later non-empty fragments must match bound calls and `text(variable)` emissions one-to-one and in order. / 只有单个直接终态 exec phase 且没有 wait 时才考虑 `bounded`。外层输出必须是带类型的 text 数组，首个 fragment 必须是 canonical、仅包含状态的 `Script completed` envelope；之后的非空 fragments 必须与带 binding 的调用和 `text(variable)` emission 按顺序一一对应。
- Structured result interpretation has separate limits of 32,000 characters, object depth 32, and 1,000 object/array nodes. Over-budget or non-JSON results stay text. The complete sanitized associated fragment is still kept in a collapsed `Associated result`. / 结构化结果解释另有 32,000 字符、对象深度 32 与 1,000 个对象/数组节点的限制。超预算或非 JSON 结果保持文本；完整的脱敏关联 fragment 仍保存在默认折叠的 `Associated result` 中。

## Current renderer families / 当前 renderer 家族

The table describes each family's inner structured sections. `single_tool` places those sections directly in the timeline and moves Code Mode supplements to the inspector; `multi_tool` keeps the Request/Result projection wrapper around the same sections. / 下表描述每个家族的内部结构化 sections。`single_tool` 会把这些 sections 直接放入时间线，并把 Code Mode 补充信息移入 inspector；`multi_tool` 则继续用 Request/Result 投影 wrapper 包住相同 sections。

| Family / 家族 | Tools / 工具 | Current request display / 当前 request 显示 | Current bounded-result display / 当前 bounded result 显示 |
| --- | --- | --- | --- |
| Plan / 计划 | `update_plan` | Structured explanation and status-tagged ordered steps / 结构化 explanation 与带 status 的有序步骤 | No structured response summary; folded full associated result / 无结构化响应摘要；折叠完整关联结果 |
| User input / 用户输入 | `request_user_input` | Questions, options, selected choices, and answers in one card / 问题、选项、选中项和回答位于同一卡片 | Answer-derived state is mixed into the request card; folded full associated result / 回答派生状态混入 request 卡片；折叠完整关联结果 |
| Command / 命令 | `shell_command`, `exec_command` | Command plus cwd, timeout, and sandbox permission / 命令及 cwd、timeout、sandbox permission | Exit code, wall time, terminal output when format matches; otherwise raw terminal result; folded full associated result / 格式匹配时显示退出码、耗时和终端输出，否则显示 raw terminal result；折叠完整关联结果 |
| Patch / 补丁 | `apply_patch` | Structured patch renderer, with diff-code fallback / 结构化 patch renderer，失败时回退为 diff code | Generic response summary plus folded full associated result / 通用响应摘要及折叠完整关联结果 |
| Image inspection / 图片检查 | `view_image` | Path and detail, plus response-derived dimensions and MIME in the same request card / path、detail，以及混在同一 request 卡片中的响应派生尺寸与 MIME | Generic response summary plus folded full associated result / 通用响应摘要及折叠完整关联结果 |
| Collaboration / 协作 | `spawn_agent`, `wait_agent`, `send_input`, `close_agent` | Targets, fields, statuses, message, and response-derived result in one collaboration card / target、字段、状态、message 与响应派生 result 位于同一协作卡片 | No generic response summary; folded full associated result / 无通用响应摘要；折叠完整关联结果 |
| Generic summary / 通用摘要 | Remaining ten tools / 其余十种工具 | Sanitized JSON/text `Request summary`, or a notice if empty / 脱敏 JSON/text `Request summary`，为空时显示 notice | Sanitized JSON/text `Response summary` plus folded full associated result / 脱敏 JSON/text `Response summary` 及折叠完整关联结果 |

Generic summaries currently truncate strings to 4,000 characters, arrays to 12 items, objects to 24 fields, and nesting beyond depth 5. Embedded data URLs are replaced with a marker; Raw refs remain the verification source. / 当前通用摘要会把字符串截到 4,000 字符、数组截到 12 项、对象截到 24 个字段，并省略深度超过 5 的嵌套值。内嵌 data URL 会被替换为 marker；Raw refs 仍是核验来源。

## Tool-by-tool catalog and tuning proposals / 逐工具目录与调优建议

### `apply_patch` — Apply patch / 应用补丁

- **Current / 当前:** A string request or `request.patch` is parsed into the existing structured patch section. If patch parsing cannot produce that section, the request is shown as highlighted diff code. A bounded response receives a generic `Response summary` and a folded full `Associated result`. / 字符串 request 或 `request.patch` 会被解析为既有结构化 patch section；如果无法生成该 section，则 request 以高亮 diff code 显示。bounded 响应显示通用 `Response summary` 和折叠的完整 `Associated result`。
- **Fine-tune / 调优建议:** Keep the affected-file summary and diff as primary. Put explicit machine-reported outcome fields in a compact result strip; de-emphasize empty acknowledgements. Never infer success or failure from words inside the patch or response text. / 保持受影响文件摘要与 diff 为主要内容；把机器明确返回的 outcome 字段放入紧凑结果条，并弱化空确认响应。绝不根据补丁或响应文本中的关键字推断成功或失败。
- **Acceptance / 验收:** Add/update/delete patches, malformed patch fallback, large multi-file patch folding, `{}` acknowledgement, explicit structured error, and misleading `failed` text inside a patch. / 覆盖新增、更新、删除补丁，格式异常回退，大型多文件补丁折叠，`{}` 确认，明确结构化错误，以及补丁正文中误导性的 `failed` 文本。
- **Decision / 决定:** `TBD / 待定`

### `close_agent` — Close subagent / 关闭子代理

- **Current / 当前:** Uses the collaboration card. Target, previous/final statuses, receiver/nickname fields, and response-derived result remain combined in that card. In `single_tool` the card is the direct body; in `multi_tool` it appears inside the visual Request part, while the Result part contains only the folded full associated fragment. / 使用协作卡片。target、previous/final status、receiver/nickname 字段与响应派生 result 仍合并在该卡片中。`single_tool` 时它直接成为正文；`multi_tool` 时它位于视觉上的 Request 部分，而 Result 部分只包含折叠的完整关联 fragment。
- **Fine-tune / 调优建议:** Split evidence by direction: request shows the target and close intent; result shows previous/final status and any returned message. Preserve agent ID and nickname together to avoid identity ambiguity. / 按方向拆分证据：request 显示 target 与关闭意图；result 显示之前/最终状态和返回消息。同时保留 agent ID 与 nickname，避免身份歧义。
- **Acceptance / 验收:** Target by short name and canonical ID, missing response, already-finished agent, multiple status shapes, and ambiguous nickname collisions. / 覆盖短名称与 canonical ID target、缺失响应、已经结束的 agent、多种 status shape 与 nickname 冲突。
- **Decision / 决定:** `TBD / 待定`

### `create_goal` — Create goal / 创建目标

- **Current / 当前:** Uses generic request and response summaries even though ordinary goal events already have a structured goal presentation elsewhere in the repository. / 当前使用通用 request/response 摘要，尽管仓库中的普通 goal event 已有结构化 goal 呈现。
- **Fine-tune / 调优建议:** Reuse the goal snapshot model: objective is primary; token budget is secondary; a bounded result shows goal status, ID when available, usage, and remaining budget. Do not fabricate an active or completed state when the result does not contain it. / 复用 goal snapshot 模型：objective 为主要内容，token budget 为次要内容；bounded 结果显示可用的 goal status、ID、usage 与剩余预算。结果未包含状态时不得虚构 active 或 completed。
- **Acceptance / 验收:** Bounded and unbounded budgets, Unicode objective, empty acknowledgement, explicit goal snapshot, rejected creation, and request-only display. / 覆盖有界与无界预算、Unicode objective、空确认、明确 goal snapshot、创建被拒与仅 request 显示。
- **Decision / 决定:** `TBD / 待定`

### `exec_command` — Shell command / 终端命令

- **Current / 当前:** Shares the same projection policy as `shell_command`: highlighted Command, a `Run context` table, parsed exit code/wall time/output when the exact formatted envelope matches, otherwise one raw terminal Result, plus the folded full associated fragment. / 与 `shell_command` 共用投影策略：高亮 Command、`Run context` 表；精确匹配格式化 envelope 时解析 exit code、wall time 与 output，否则显示一个 raw terminal Result；另保留折叠的完整关联 fragment。
- **Fine-tune / 调优建议:** Implement command-card refinements once for both aliases. Keep command and stdout/stderr dominant, compress cwd/timeout/permission into a single secondary row, and provide an adjustable long-output fold. Keep exit code visually explicit but do not turn unparsed text into an outcome. / 两个别名共用一次命令卡片改进。让 command 与 stdout/stderr 占主要空间，把 cwd/timeout/permission 压缩为一行次要信息，并为长输出提供可调折叠。明确显示 exit code，但不从未解析文本推断 outcome。
- **Acceptance / 验收:** Parsed and unparsed envelopes, empty output, non-zero exit, ANSI output, very long lines, PowerShell and POSIX commands, and absent workdir. / 覆盖可解析与不可解析 envelope、空输出、非零退出、ANSI 输出、超长行、PowerShell/POSIX 命令与缺失 workdir。
- **Decision / 决定:** `TBD / 待定`

### `get_goal` — Get goal / 获取目标

- **Current / 当前:** Uses a generic request summary, often showing `{}`, and a generic response summary followed by the folded associated result. / 当前使用通用 request 摘要，常显示 `{}`；响应使用通用摘要，随后是折叠的关联结果。
- **Fine-tune / 调优建议:** Suppress the visual weight of an empty request and render the returned goal snapshot directly: objective, canonical status, token/time usage, limits, and remaining budget. Show “no active goal” only from an explicit structured response. / 弱化空 request 的视觉占比，直接渲染返回的 goal snapshot：objective、canonical status、token/time usage、limits 与剩余预算。只有结构化响应明确表示时才显示“无 active goal”。
- **Acceptance / 验收:** Active goal, completed/blocked goal, no goal, partial snapshot, over-budget structured result, and unassociated request. / 覆盖 active goal、completed/blocked goal、无 goal、部分 snapshot、超预算结构化结果与未关联 request。
- **Decision / 决定:** `TBD / 待定`

### `image_gen__imagegen` — Image generation / 图片生成

- **Current / 当前:** Prompt, references, and options are shown only through a generic request summary. The response is a generic summary; embedded data URLs are redacted, and the full sanitized associated fragment is folded. No Code Mode image preview is generated by this projection. / 当前 prompt、references 与 options 只通过通用 request 摘要显示；响应也是通用摘要，内嵌 data URL 会被脱敏，完整脱敏关联 fragment 默认折叠。该投影不会生成 Code Mode 图片预览。
- **Fine-tune / 调优建议:** Make the prompt primary; put reference paths/count and generation options in compact metadata. Show `output_hint` and a preview only through the repository's safe persisted preview endpoint; never place base64 or arbitrary URLs into timeline HTML. / 将 prompt 作为主要内容，把 reference path/count 与生成选项放入紧凑 metadata。仅通过仓库安全的持久化 preview endpoint 显示 `output_hint` 与预览；绝不把 base64 或任意 URL 放入时间线 HTML。
- **Acceptance / 验收:** New image, edit with local references, recent-image reference count, output hint, removed data URL, unavailable preview, and large prompt. / 覆盖新生成、使用本地 reference 的编辑、recent-image reference 数量、output hint、被移除的 data URL、不可用预览与长 prompt。
- **Decision / 决定:** `TBD / 待定`

### `list_available_plugins_to_install` — List available plugins / 列出可用插件

- **Current / 当前:** Uses generic request/response summaries. Candidate identity, type, and reason are not given dedicated rows. / 当前使用通用 request/response 摘要；candidate identity、type 与 reason 没有专用行。
- **Fine-tune / 调优建议:** Treat an empty request as a compact action label. Render returned candidates as rows containing display name, stable ID, `plugin | connector` type, and short description/reason; preserve an explicit empty-list state. / 将空 request 压缩为简洁 action label。把返回 candidates 渲染为包含 display name、stable ID、`plugin | connector` type 与简短 description/reason 的行，并保留明确的空列表状态。
- **Acceptance / 验收:** Empty list, one/many candidates, plugin and connector with similar names, missing optional fields, and truncated long descriptions. / 覆盖空列表、单个/多个 candidate、同名相近的 plugin 与 connector、缺少可选字段及长 description 截断。
- **Decision / 决定:** `TBD / 待定`

### `list_mcp_resource_templates` — List MCP resource templates / 列出 MCP 资源模板

- **Current / 当前:** Uses generic JSON/text summaries; server and cursor are not promoted, and template rows are not specialized. / 当前使用通用 JSON/text 摘要；server 与 cursor 未被突出，template 也没有专用行。
- **Fine-tune / 调优建议:** Show server and cursor as compact request metadata. Render each template's name, URI template, description, and MIME type in a scan-friendly list; show the returned next cursor without implying the next page was fetched. / 将 server 与 cursor 显示为紧凑 request metadata。以便于扫描的列表显示每个 template 的 name、URI template、description 与 MIME type；显示返回的 next cursor，但不暗示下一页已经获取。
- **Acceptance / 验收:** All-server and one-server requests, pagination, missing descriptions, URI-template braces, empty results, and non-text metadata. / 覆盖全 server/单 server request、分页、缺失 description、含花括号的 URI template、空结果与非文本 metadata。
- **Decision / 决定:** `TBD / 待定`

### `list_mcp_resources` — List MCP resources / 列出 MCP 资源

- **Current / 当前:** Uses generic summaries; resource name, URI, server, MIME type, and pagination are visible only inside serialized JSON when present. / 当前使用通用摘要；resource name、URI、server、MIME type 与分页信息只在序列化 JSON 中出现。
- **Fine-tune / 调优建议:** Promote server/cursor to request metadata and render resources as rows keyed by stable URI, with name, description, and MIME type secondary. Keep the next cursor explicit and keep duplicate display names distinguishable by URI. / 将 server/cursor 提升为 request metadata，并按稳定 URI 渲染 resource 行，name、description 与 MIME type 作为次要信息。明确显示 next cursor，并用 URI 区分重复 display name。
- **Acceptance / 验收:** Duplicate names with different URIs, pagination, empty result, mixed MIME types, missing name, and unassociated request. / 覆盖同名不同 URI、分页、空结果、混合 MIME type、缺失 name 与未关联 request。
- **Decision / 决定:** `TBD / 待定`

### `read_mcp_resource` — Read MCP resource / 读取 MCP 资源

- **Current / 当前:** Request and response use generic summaries. Text content, transport metadata, and media payload metadata are not visually separated. / 当前 request 与 response 使用通用摘要；文本内容、传输 metadata 与 media payload metadata 未作视觉分离。
- **Fine-tune / 调优建议:** Show server and URI as request identity. For textual MIME types, make resource text or JSON the primary result; for media or opaque payloads, show only safe metadata and an availability notice. Never render embedded base64; preserve full verification through Raw refs. / 将 server 与 URI 作为 request identity。对于文本 MIME type，让资源文本或 JSON 成为主要结果；对于 media 或 opaque payload，只显示安全 metadata 与可用性 notice。绝不渲染内嵌 base64；通过 Raw refs 保留完整核验能力。
- **Acceptance / 验收:** Plain text, JSON, multiple content fragments, binary/media metadata, embedded data URL removal, missing MIME, and oversized content. / 覆盖纯文本、JSON、多个 content fragment、binary/media metadata、内嵌 data URL 移除、缺失 MIME 与超大内容。
- **Decision / 决定:** `TBD / 待定`

### `request_plugin_install` — Request plugin install / 请求安装插件

- **Current / 当前:** Uses generic summaries; action, tool type, stable ID, reason, and returned decision/status have no dedicated hierarchy. / 当前使用通用摘要；action、tool type、stable ID、reason 与返回 decision/status 没有专用层级。
- **Fine-tune / 调优建议:** Make tool ID/type and requested action primary, with the user-facing reason underneath. Render only explicit structured decision/status fields as the result; do not infer installation success from prose. / 将 tool ID/type 与 requested action 作为主要信息，用户可见 reason 放在其下。结果只渲染明确的结构化 decision/status 字段；不从自然语言推断安装成功。
- **Acceptance / 验收:** Plugin and connector, accepted/declined/pending structured decisions, prose-only response, missing reason, and request-only display. / 覆盖 plugin/connector、accepted/declined/pending 结构化决定、仅自然语言响应、缺失 reason 与仅 request 显示。
- **Decision / 决定:** `TBD / 待定`

### `request_user_input` — User input / 用户输入

- **Current / 当前:** Renders question header/prompt, options and descriptions, selected labels, and returned answers in one structured card. `autoResolutionMs` is not shown. In `single_tool` the card is the direct body; in `multi_tool` it remains under Request, while Result contains only the folded full associated fragment. / 当前在一张结构化卡片中显示 question header/prompt、选项与描述、选中 label 和返回答案；不显示 `autoResolutionMs`。`single_tool` 时该卡片直接成为正文；`multi_tool` 时它仍位于 Request 下，而 Result 只包含折叠的完整关联 fragment。
- **Fine-tune / 调优建议:** Keep questions/options in Request and move selected choices/free-form answers to Result so evidence direction is honest. Mark unanswered questions explicitly, show auto-resolution timing as secondary request metadata, and collapse very long option descriptions without hiding labels. / 将问题/选项保留在 Request，把选中项与自由文本回答移到 Result，使证据方向准确。明确标注未回答问题，把自动决议时间作为次要 request metadata，并折叠很长的选项描述但不隐藏 label。
- **Acceptance / 验收:** One to three questions, selected predefined option, free-form answer, multiple answer values, unanswered/timeout, duplicate option labels, and no bounded association. / 覆盖一到三个问题、选中预设选项、自由文本回答、多 answer value、未回答/超时、重复 option label 与无 bounded 关联。
- **Decision / 决定:** `TBD / 待定`

### `send_input` — Send input to subagent / 向子代理发送输入

- **Current / 当前:** Uses the collaboration card. Target and message remain combined with response-derived receiver/status/result. In `single_tool` that card is the direct body; in `multi_tool` it stays under Request and Result keeps only the folded full fragment. / 当前使用协作卡片。target 与 message 仍和响应派生的 receiver/status/result 合并。`single_tool` 时该卡片直接成为正文；`multi_tool` 时它留在 Request 下，Result 只保留折叠的完整 fragment。
- **Fine-tune / 调优建议:** Request should lead with target plus message. Result should show explicit delivery/receiver evidence separately. Do not show “delivered” unless the bounded or future exact response says so. / Request 应突出 target 与 message；Result 单独显示明确的 delivery/receiver 证据。除非 bounded 或未来 exact 响应明确说明，否则不要显示“已送达”。
- **Acceptance / 验收:** Short and canonical target, Markdown message, very long message, explicit receiver, missing response, and target resolution ambiguity. / 覆盖短 target、canonical target、Markdown message、超长 message、明确 receiver、缺失响应与 target 解析歧义。
- **Decision / 决定:** `TBD / 待定`

### `shell_command` — Shell command / 终端命令

- **Current / 当前:** Renders Command plus cwd/workdir, timeout, and sandbox permission. An exactly formatted result becomes `Run result` with Exit code and Wall time plus terminal Output; all other result text is one terminal Result. The complete associated fragment remains folded. / 当前显示 Command 以及 cwd/workdir、timeout 与 sandbox permission。精确匹配格式的结果会变成含 Exit code 与 Wall time 的 `Run result` 加 terminal Output；其他结果文本显示为单个 terminal Result。完整关联 fragment 仍默认折叠。
- **Fine-tune / 调优建议:** Same shared command-card change as `exec_command`: command and output dominate; context becomes compact; stdout/stderr or channel distinctions are shown only when structurally available; users can expand long output without expanding metadata. / 与 `exec_command` 共用同一命令卡片改进：command 与 output 占主导，context 紧凑显示；只有结构化可用时才区分 stdout/stderr 或 channel；用户无需展开 metadata 即可展开长输出。
- **Acceptance / 验收:** The same matrix as `exec_command`, plus `require_escalated` arguments remain visible as declared request data but do not create an escalation tag on the projection. / 与 `exec_command` 使用相同矩阵，并确认 `require_escalated` 参数作为声明 request 数据可见，但不会在投影上创建提权标签。
- **Decision / 决定:** `TBD / 待定`

### `spawn_agent` — Spawn subagent / 启动子代理

- **Current / 当前:** The collaboration card combines request message/options with response-derived agent identity, statuses, prompt, or result. In `single_tool` it is the direct body; in `multi_tool` it remains under Request and Result contains the folded full fragment. / 当前协作卡片把 request message/options 与响应派生的 agent identity、status、prompt 或 result 合并。`single_tool` 时它直接成为正文；`multi_tool` 时它仍位于 Request 下，Result 包含折叠的完整 fragment。
- **Fine-tune / 调优建议:** Make the delegated task/message primary. Keep execution options in one compact row. Move returned agent identity and initial status into Result, showing canonical ID and nickname together; label fork context as a request property, not proof of what context was received. / 将委派任务/message 作为主要内容，把执行选项压缩为一行。把返回的 agent identity 与初始 status 移到 Result，同时显示 canonical ID 与 nickname；将 fork context 标为 request 属性，而不是已收到哪些上下文的证明。
- **Acceptance / 验收:** `fork_turns: none`, `all`, numeric turns, model/effort options, returned ID and nickname, spawn failure, and response with prompt only. / 覆盖 `fork_turns: none`、`all`、数字 turns、model/effort 选项、返回 ID/nickname、spawn failure 与仅含 prompt 的响应。
- **Decision / 决定:** `TBD / 待定`

### `update_goal` — Update goal / 更新目标

- **Current / 当前:** Uses generic request/response summaries; requested status and resulting goal snapshot are not separated or promoted. / 当前使用通用 request/response 摘要；requested status 与 resulting goal snapshot 没有被分离或突出。
- **Fine-tune / 调优建议:** Request shows the requested canonical transition (`complete` or `blocked`) prominently. Result shows the explicit resulting snapshot and final usage. Do not convert explanatory prose or a near-budget condition into a state transition. / Request 突出 requested canonical transition（`complete` 或 `blocked`）；Result 显示明确的 resulting snapshot 与最终 usage。不得把解释性文本或接近预算上限转换为状态变更。
- **Acceptance / 验收:** Complete, blocked, refused/unchanged, missing snapshot, usage summary, request-only projection, and prose containing status-like words. / 覆盖 complete、blocked、拒绝/未改变、缺失 snapshot、usage 摘要、仅 request 投影与含状态关键字的自然语言。
- **Decision / 决定:** `TBD / 待定`

### `update_plan` — Plan update / 计划更新

- **Current / 当前:** Uses the existing structured plan renderer: Markdown explanation followed by ordered steps with raw machine status strings and status-specific styling. The bounded response is not summarized structurally; its complete fragment, commonly `{}`, appears only under folded `Associated result`. / 当前使用既有结构化计划 renderer：Markdown explanation 后跟有序步骤，显示原始机器 status 字符串并使用相应样式。bounded 响应不做结构化摘要；其完整 fragment（常为 `{}`）只出现在折叠的 `Associated result` 中。
- **Fine-tune / 调优建议:** Preserve this structure. Make the single `in_progress` step easiest to find, localize the visible status label while retaining the machine value in data, and optionally fold long completed history without hiding pending work. Keep empty acknowledgement disclosure minimal. / 保留这一结构。让唯一的 `in_progress` step 最易发现；本地化可见 status label，同时在数据中保留机器值；可选折叠很长的 completed 历史，但不能隐藏 pending 工作。把空确认折叠区做到最小化。
- **Acceptance / 验收:** Explanation absent/present, all supported statuses, unknown status, long plan, Unicode text, `{}` result, and request-only plan. / 覆盖有/无 explanation、所有支持 status、未知 status、长计划、Unicode 文本、`{}` 结果与仅 request 计划。
- **Decision / 决定:** `TBD / 待定`

### `view_image` — Image inspection / 图片检查

- **Current / 当前:** Path and requested detail are placed in an `Image inspection` key/value card. With a bounded structured response, width/height and MIME type are added to that same Request card. Result also receives a generic response summary and the folded full associated fragment. No preview is created here. / 当前把 path 与 requested detail 放入 `Image inspection` key/value 卡片。存在 bounded 结构化响应时，width/height 与 MIME type 也会加入同一 Request 卡片。Result 还会显示通用响应摘要及折叠完整关联 fragment；此处不会创建 preview。
- **Fine-tune / 调优建议:** Keep path/detail strictly in Request and move dimensions/MIME to Result. Add a preview only through a safe persisted preview reference; never reuse a local path or arbitrary URL directly in browser HTML. Avoid duplicating identical metadata in summary and key/value rows. / 将 path/detail 严格留在 Request，把 dimensions/MIME 移到 Result。只有通过安全持久化 preview reference 才增加预览；绝不在浏览器 HTML 中直接复用本地 path 或任意 URL。避免在摘要与 key/value 行中重复相同 metadata。
- **Acceptance / 验收:** PNG/JPEG and unknown MIME, dimensions present/partial/absent, inaccessible file, removed data URL, no association, and preview unavailable. / 覆盖 PNG/JPEG 与未知 MIME、完整/部分/缺失 dimensions、文件不可访问、data URL 被移除、无关联与 preview 不可用。
- **Decision / 决定:** `TBD / 待定`

### `wait_agent` — Wait for subagent / 等待子代理

- **Current / 当前:** The collaboration card combines targets, timeout, returned statuses/result, and a timed-out marker. In `single_tool` it is the direct body; in `multi_tool` it remains under Request. The renderer currently gives the timed-out marker the same `failed` visual class even though the projection and outer operation own no failed outcome. / 当前协作卡片合并显示 targets、timeout、返回 status/result 与 timed-out marker。`single_tool` 时它直接成为正文；`multi_tool` 时它仍位于 Request 下。renderer 当前给 timed-out marker 使用与 `failed` 相同的视觉 class，尽管投影与外层 operation 都不拥有 failed outcome。
- **Fine-tune / 调优建议:** This is the highest-priority collaboration correction. Separate requested targets/timeout from observed statuses/results, and render timeout as a neutral or warning observation unless structured lifecycle evidence proves failure. Put one-line current statuses before long returned messages. / 这是协作类最高优先级的修正。把 requested targets/timeout 与 observed statuses/results 分开；除非结构化 lifecycle 证据证明失败，否则 timeout 使用中性或 warning 观测样式。当前 status 的单行摘要应位于长返回消息之前。
- **Acceptance / 验收:** Completed, running, pending, timed out, mixed multi-agent statuses, no response, and explicit failed lifecycle evidence. / 覆盖 completed、running、pending、timed out、多 agent 混合 status、无响应与明确 failed lifecycle 证据。
- **Decision / 决定:** `TBD / 待定`

### `web__run` — Web request / 网络请求

- **Current / 当前:** Literal top-level request arrays are grouped by operation type and show bounded identifying arguments plus shared options. A bounded terminal fragment is rendered through the existing safe Markdown pipeline, while its complete sanitized text stays folded as inspector evidence. A uniquely associated canonical `web_search` event remains in Main but is presentation-compressed to a one-line lifecycle row; ambiguous events are unchanged. / 当前 literal 顶层 request 数组会按 operation type 分组，并显示受限辨识参数与共享 option。Bounded terminal fragment 通过既有安全 Markdown pipeline 渲染，其完整脱敏文本继续折叠保存在 inspector 证据中。唯一关联的 canonical `web_search` event 仍位于 Main，但只在 presentation 上压缩为一行生命周期；歧义事件保持不变。
- **Fine-tune / 调优建议:** Review per-operation field priority, maximum group/item counts, long-snippet folding, citation styling, and whether finance/weather/sports deserve richer cards once stable output schemas are observed. Do not infer per-result identity or outcome from prose. / 评审每种 operation 的字段优先级、group/item 数量上限、长 snippet 折叠、citation 样式，以及在观察到稳定输出 schema 后 finance/weather/sports 是否值得使用更丰富卡片。不要从正文推断逐结果 identity 或 outcome。
- **Acceptance / 验收:** One and multiple operation types, several queries in one type, empty result, partial/heterogeneous response, long snippets, misleading error words in page content, and unassociated output. / 覆盖单一/多种 operation type、同类型多个 query、空结果、部分/异构响应、长 snippet、页面内容中的误导性 error 关键字与未关联输出。
- **Decision / 决定:** `Accepted baseline; per-operation fine-tuning remains open / 已接受基础版；逐 operation 调优继续开放`

## Recommended review order / 建议评审顺序

This ordering is a proposal based on semantic risk and current visual friction, not an implementation commitment. / 以下顺序根据语义风险与当前视觉摩擦提出，并非实现承诺。

1. `wait_agent`: remove timeout-as-failure visual implication and separate request/result evidence. / `wait_agent`：移除 timeout 等同 failure 的视觉暗示，并分离 request/result 证据。
2. `update_plan`, `shell_command`, `exec_command`, `apply_patch`, `request_user_input`: refine already-structured, high-frequency cards and reduce low-information result weight. / `update_plan`、`shell_command`、`exec_command`、`apply_patch`、`request_user_input`：细化已有结构化、高频卡片，并降低低信息结果的视觉权重。
3. `create_goal`, `get_goal`, `update_goal`: reuse the existing goal domain model instead of generic JSON. / `create_goal`、`get_goal`、`update_goal`：复用既有 goal domain model，替代通用 JSON。
4. `list_mcp_resource_templates`, `list_mcp_resources`, `read_mcp_resource`: reuse MCP-safe text/media separation and pagination semantics. / `list_mcp_resource_templates`、`list_mcp_resources`、`read_mcp_resource`：复用 MCP 的安全文本/media 分离与分页语义。
5. `spawn_agent`, `send_input`, `close_agent`, then `view_image`: split mixed request/result evidence while preserving full associated fragments. / `spawn_agent`、`send_input`、`close_agent`，再到 `view_image`：拆分混合的 request/result 证据，同时保留完整关联 fragments。
6. `image_gen__imagegen`, plugin tools, and `web__run`: add tool-specific summaries only after safe preview and heterogeneous-result policies are agreed. / `image_gen__imagegen`、plugin 工具与 `web__run`：在安全 preview 与异构结果策略确定后再加入工具专用摘要。

## Review response template / 评审回复模板

Use this block for any tool whose proposal needs adjustment: / 对任何需要调整建议的工具，可使用以下模板：

```text
Tool / 工具:
Decision / 决定: accept | revise | keep current
Primary by default / 默认主显示:
Collapsed by default / 默认折叠:
Request/result split / Request 与 result 分界:
Long-content rule / 长内容规则:
Outcome evidence rule / Outcome 证据规则:
Narrow-screen behavior / 窄屏行为:
Required acceptance sample / 必须验收的样本:
```

After review decisions are recorded, implementation should use one active execution plan for the shared projection framework and separate milestones by renderer family. Separate active plans are justified only if a family changes canonical event semantics or can ship independently without leaving mixed evidence labels inconsistent. / 记录评审决定后，实现工作宜使用一个 active execution plan 管理共享投影框架，并按 renderer 家族划分 milestone。只有当某个家族会改变 canonical event 语义，或能独立交付且不会留下不一致的证据标签时，才适合拆成单独 active plan。
