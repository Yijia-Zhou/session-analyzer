# Code Mode structured nested projections / Code Mode 结构化嵌套工具投影

## Goal-ready objective / 可直接用于 `/goal` 的目标

Add conservative, request-only Nested Tool Projections to the accepted composite Code Mode Operation presentation. Preserve the existing operation and Logical Event identities, expose only supported structured requests, label result association as `exact`, `bounded`, or `none`, restrict bounded association to strictly ordered static shapes, and use outer JavaScript plus Raw refs as the fallback for every uncertain case.

在已接受的复合 Code Mode 操作呈现中增加保守、request-only 的嵌套工具投影。保持既有 operation 与逻辑事件 identity，只展示受支持的结构化 request，把结果关联标记为 `exact`、`bounded` 或 `none`，将 bounded 关联限制在严格有序静态形态，并让所有不确定场景回退到 outer JavaScript 与 Raw refs。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-15 / 开始日期：2026-07-15
- Completed: 2026-07-15 / 完成日期：2026-07-15
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design: `docs/design-docs/code-mode-operations.md` / 相关设计：`docs/design-docs/code-mode-operations.md`
- Domain language: `CONTEXT.md` / 领域语言：`CONTEXT.md`

## Confirmed scope / 已确认范围

1. Parse only a deliberately supported subset of nested `tools.*` requests from outer Code Mode JavaScript without executing the JavaScript. / 只从 outer Code Mode JavaScript 解析经过明确支持的 nested `tools.*` request 子集，绝不执行 JavaScript。
2. Render zero or more request-only Nested Tool Projections inside the existing accepted composite operation. / 在既有已接受的复合 operation 内渲染零个或多个 request-only 嵌套工具投影。
3. Preserve the owning operation ID, Logical Event ID, `kind: other_tool_call`, subtype, status neutrality, Raw refs, metrics, and single search owner. / 保持所属 operation ID、逻辑事件 ID、`kind: other_tool_call`、subtype、中性状态、Raw refs、指标和单一搜索 owner 不变。
4. Label every projection result association as `exact`, `bounded`, or `none`; allow `bounded` only for strictly ordered, sequential, one-to-one static shapes. / 把每个投影的结果关联标记为 `exact`、`bounded` 或 `none`；只有严格有序、顺序执行、一一对应的静态形态才允许 `bounded`。
5. Keep Observed Nested Activity as the canonical independently inspectable Logical Event, even when a projection displays the same request or a related result. / 即使投影展示同一 request 或相关结果，已观测嵌套活动仍保持为 canonical、可独立检查的逻辑事件。
6. Use readable outer JavaScript and lossless operation Raw refs whenever syntax, values, control flow, output ordering, or identity is unsupported or uncertain. / 只要语法、值、控制流、输出顺序或 identity 不受支持或存在不确定性，就使用可读 outer JavaScript 与无损 operation Raw refs。

## Non-goals / 非目标

- Executing JavaScript, evaluating branches, or simulating loops and concurrency / 执行 JavaScript、求值分支，或模拟循环与并发
- Claiming that a Declared Nested Call executed / 声称某个声明的嵌套调用已经执行
- Creating new Logical Events, kinds, search targets, counters, statuses, escalation tags, Raw refs, or source ownership for projections / 为投影创建新的逻辑事件、kind、搜索目标、计数器、状态、提权标签、Raw refs 或来源所有权
- Replacing, merging, hiding, or demoting Observed Nested Activity events / 替代、合并、隐藏或降级已观测嵌套活动事件
- Broad JavaScript parsing beyond the minimum supported request shapes / 超出最小受支持 request 形态的通用 JavaScript 解析

## Fixed semantics / 固定语义

### Request-only presentation / Request-only 呈现

A projection can show a supported tool name and bounded structured arguments. Its copy and metadata must make clear that it is a projected request, not proof of execution. / 投影可以显示受支持的工具名称和受限结构化 arguments。其文案与 metadata 必须明确表明它是投影出的 request，而不是执行证明。

### Result association / 结果关联

- `exact`: use only a persisted exact identity edge. / `exact`：只使用持久化的精确 identity 边。
- `bounded`: use only when request and candidate result order are statically sequential and one-to-one, with no branch, loop, repeated call site, concurrency, dynamic dispatch, or ambiguous extra output. / `bounded`：只在 request 与候选结果顺序可静态确定且一一对应，并且不存在分支、循环、重复调用位置、并发、动态分派或歧义额外输出时使用。
- `none`: assign no result; this is the default after any failed eligibility check. / `none`：不分配结果；任何资格检查失败后都默认使用该值。

Association labels are presentation evidence levels, not outcomes. None of them implies success, failure, decline, approval, or execution count. / 关联标签是呈现层证据等级，不是结果。它们都不暗示成功、失败、拒绝、审批或执行次数。

### Ownership / 所有权

Nested Tool Projections own no event identity, metrics, search document or target, Raw refs, source rows, outcome, severity, or tags. Projection request text remains part of the operation's already indexed JavaScript, and any displayed result remains under the same operation search owner. / 嵌套工具投影不拥有事件 identity、指标、搜索文档或目标、Raw refs、来源行、结果、severity 或 tag。投影的 request 文本仍属于 operation 已索引的 JavaScript，任何展示结果也继续归属于同一个 operation 搜索 owner。

## Execution phases / 执行阶段

### Phase 1: freeze supported shapes / 第一阶段：冻结受支持形态

1. Add minimized synthetic fixtures for one request, multiple strictly sequential requests, exact identity when available, bounded sequential association, and no-result display. / 为单个 request、多个严格顺序 request、可用时的 exact identity、bounded 顺序关联和无结果展示增加最小化合成 fixture。
2. Add rejection fixtures for branches, loops, `Promise.all`, repeated call sites, dynamic property/tool selection, spreads or computed values outside the supported subset, parse errors, and ambiguous output fragments. / 为分支、循环、`Promise.all`、重复调用位置、动态属性/工具选择、受支持子集之外的 spread 或计算值、解析错误和歧义输出 fragment 增加拒绝 fixture。
3. Record the expected projection count, request-only fields, association label, fallback, and unchanged operation/event identities for every fixture. / 为每个 fixture 记录预期投影数、request-only 字段、关联标签、fallback，以及保持不变的 operation/event identity。

### Phase 2: implement conservative extraction / 第二阶段：实现保守提取

1. Add a bounded parser/extractor that accepts only explicitly supported static request shapes and returns no projection on uncertainty. / 增加受限 parser/extractor，只接受明确支持的静态 request 形态，并在不确定时不返回投影。
2. Keep extraction separate from operation grouping, observation classification, outcome classification, metrics, search ownership, and Raw-ref ownership. / 让提取与 operation 分组、观测分类、结果分类、指标、搜索所有权和 Raw-ref 所有权保持分离。
3. Produce presentation DTOs with request-only semantics and explicit `exact | bounded | none` association. / 生成具有 request-only 语义及明确 `exact | bounded | none` 关联的呈现 DTO。
4. Use raw fallback without partial execution claims when a whole candidate shape fails eligibility. / 当整个候选形态资格检查失败时使用 raw fallback，不产生局部执行声明。

### Phase 3: integrate accepted presentation / 第三阶段：接入已接受呈现

1. Add projection sections inside the existing composite Code Mode operation detail; give structured requests and results primary space, keep the full associated fragment and outer source in collapsed sections, and retain trace, inspector, nested-event links, and Raw refs. / 在既有复合 Code Mode 操作详情内增加投影 section；把主要空间留给结构化 request 与结果，把完整关联 fragment 与 outer source 保留在折叠 section 中，并继续保留 trace、inspector、nested-event 链接与 Raw refs。
2. Localize request-only, association, and fallback labels in English and Simplified Chinese without localizing machine values. / 对 request-only、关联和 fallback 标签提供英文与简体中文本地化，但不本地化机器值。
3. Verify that Observed Nested Activity remains independently visible and navigable alongside projections. / 验证已观测嵌套活动在投影旁仍独立可见、可导航。

### Phase 4: validate and close / 第四阶段：验证并收口

1. Run focused parser, Code Mode, detail, search, metrics, i18n, renderer, and browser tests. / 运行聚焦 parser、Code Mode、detail、search、metrics、i18n、renderer 和 browser 测试。
2. Run the full Node, browser, package, build, build-check, and diff-check gates required by the repository. / 运行仓库要求的完整 Node、browser、package、build、build-check 和 diff-check 门禁。
3. Record sanitized acceptance evidence and move this plan to `completed/` only after every required behavior ships. / 记录脱敏验收证据，并且只有全部必需行为交付后才把本计划移到 `completed/`。

## Risks and mitigations / 风险与缓解

- **False execution claim:** a structured card can look authoritative. Mitigation: request-only labeling, zero ownership, and no execution verb derived from projection presence. / **虚假执行声明：**结构化卡片可能显得具有权威性。缓解：标注 request-only、保持零所有权，并且不根据投影存在推导任何执行动词。
- **False result mapping:** aggregate output may not identify its producer. Mitigation: exact identity first, fail-closed bounded eligibility, explicit association label, and `none` or raw fallback on ambiguity. / **虚假结果映射：**聚合输出可能无法识别其生产者。缓解：优先 exact identity、bounded 资格保守失败、明确关联标签，并在歧义时使用 `none` 或 raw fallback。
- **Control-flow undercount or overcount:** one call site can execute zero or many times. Mitigation: projections are display declarations and contribute zero execution count. / **控制流少计或多计：**一个调用位置可能执行零次或多次。缓解：投影只是展示声明，执行计数贡献为零。
- **Duplicate ownership:** projection text or results could create extra search hits, metrics, or Raw refs. Mitigation: keep all ownership on the existing operation or canonical nested event and assert exact owner counts. / **重复所有权：**投影文本或结果可能创建额外搜索命中、指标或 Raw refs。缓解：让所有所有权继续归于既有 operation 或 canonical nested event，并断言精确 owner 数量。
- **Canonical-event confusion:** a projection may resemble an Observed Nested Activity event. Mitigation: distinct labels and DTO boundaries; never deduplicate or replace the canonical event through projection similarity. / **Canonical event 混淆：**投影可能看起来像已观测嵌套活动事件。缓解：使用不同标签与 DTO 边界；绝不因投影相似而去重或替代 canonical event。

## Acceptance criteria / 验收标准

1. The glossary, product spec, design, implementation, and UI use `Nested Tool Projection / 嵌套工具投影` consistently. / glossary、产品规格、设计、实现与 UI 一致使用 `Nested Tool Projection / 嵌套工具投影`。
2. Adding projections changes no owning Code Mode Operation or Logical Event identity. / 增加投影不会改变所属 Code Mode 操作或逻辑事件 identity。
3. Every projection is visibly request-only and has one explicit `exact`, `bounded`, or `none` association label. / 每个投影都明显是 request-only，并具有一个明确的 `exact`、`bounded` 或 `none` 关联标签。
4. `bounded` appears only for strictly ordered static one-to-one shapes; branch, loop, concurrency, repeated, dynamic, or ambiguous cases never receive it. / `bounded` 只出现在严格有序静态一一对应形态中；分支、循环、并发、重复、动态或歧义场景绝不获得该标签。
5. Unsupported or uncertain cases preserve readable outer JavaScript and lossless Raw-ref verification. / 不受支持或不确定的场景保留可读 outer JavaScript 与无损 Raw-ref 验证。
6. Projections contribute zero Logical Events, kinds, metrics, search owners, Raw refs, statuses, outcomes, severities, or escalation tags. / 投影贡献零个逻辑事件、kind、指标、搜索 owner、Raw refs、状态、结果、severity 或提权标签。
7. Observed Nested Activity remains the canonical independently visible, searchable, countable, and inspectable event. / 已观测嵌套活动仍是 canonical、独立可见、可搜索、可计数且可检查的事件。
8. Focused and full repository validation passes, including bilingual i18n and raw-fallback browser evidence. / 聚焦与完整仓库验收全部通过，包括双语 i18n 与 raw fallback 浏览器证据。

## Progress log / 进度日志

- 2026-07-15: Accepted the domain term and documented the additive presentation contract. The glossary keeps the concept implementation-neutral; the product and design contracts define request-only semantics, explicit association levels, strict bounded eligibility, zero ownership, canonical Observed Nested Activity, and raw fallback. Runtime implementation and validation remain in progress. / 2026-07-15：接受领域术语并记录增量呈现 contract。Glossary 保持概念与实现无关；产品与设计 contract 定义 request-only 语义、明确关联等级、严格 bounded 资格、零所有权、canonical 已观测嵌套活动和 raw fallback。运行时实现与验收仍在进行中。
- 2026-07-15: Implemented detail-only AST extraction with a known-tool allowlist, literal and resource budgets, all-or-nothing fallback, structured plan/shell/request UI, bounded ordered result association, full collapsed associated-result evidence, folded outer source, bilingual labels, and sanitized fixtures. Independent review found and drove fixes for long-result loss, deep-result recursion, `__proto__` initializer semantics, and incomplete zh-CN titles. Full browser validation and final closeout remain in progress. / 2026-07-15：实现了仅详情层的 AST 提取、已知工具 allowlist、literal 与资源预算、全有或全无回退、结构化计划/shell/request UI、bounded 有序结果关联、完整折叠关联结果证据、折叠 outer source、双语标签和脱敏 fixture。独立 review 发现并推动修复了长结果丢失、深层结果递归、`__proto__` initializer 语义和 zh-CN 标题覆盖不完整的问题。完整浏览器验收与最终收口仍在进行中。
- 2026-07-15: Closed the final localization provenance issue so dynamic agent names that collide with UI keys remain unchanged while generic labels localize. Independent review reported no remaining P0-P3 findings. Validation passed with 224/224 Node tests, 51/51 browser tests, package smoke, generated-asset build check, and `git diff --check`. A real 812.9 KB session confirmed structured plan and shell projections, primary command/output space, clean decoded output, folded lossless associated results and outer source, and zero browser console errors or warnings. No persisted nested identity edge exists in the accepted data, so V1 correctly emits only `bounded` or `none`; `exact` remains reserved rather than fabricated. / 2026-07-15：关闭最后一个本地化 provenance 问题：与 UI 键同名的动态 agent 名保持不变，generic 标签仍正确本地化。独立 review 未发现剩余 P0-P3 问题。验收通过 224/224 Node 测试、51/51 browser 测试、package smoke、生成资产 build check 与 `git diff --check`。在 812.9 KB 真实会话中确认了结构化计划与 shell 投影、command/output 主视觉空间、干净解码输出、默认折叠的无损关联结果与 outer source，以及浏览器控制台零 error、零 warning。当前已接受数据中不存在持久化 nested identity 边，因此 V1 正确地只发出 `bounded` 或 `none`；`exact` 保持保留态而不伪造。
