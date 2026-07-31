# Code Mode request facets and folding / Code Mode 请求筛选与折叠

## Goal-ready objective / 可直接用于 `/goal` 的目标

Make safely projected Code Mode requests discoverable and controllable using the same vocabulary that users see on timeline cards. Add a separate `Code Mode request` filter/catalog and editable folding-rule family for declared request facts such as `shell_command`, `update_plan`, and `web__run`, without changing canonical event identity, execution evidence, metrics, status, Raw References, or independently observed nested activity.

让安全投影出的 Code Mode request 可以使用时间线卡片上相同的词汇被发现和控制。为 `shell_command`、`update_plan`、`web__run` 等声明 request fact 增加独立的“Code Mode 请求”筛选/目录与可编辑折叠规则族，同时不改变规范事件 identity、执行证据、指标、status、Raw References 或独立观测到的 nested activity。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-25 / 开始日期：2026-07-25
- Completed: 2026-07-25 / 完成日期：2026-07-25
- Archive: `docs/exec-plans/completed/` / 归档：`docs/exec-plans/completed/`
- Baseline commits:
  - `6b58962 feat: add Code Mode context and discoverability`
  - `53edbbe docs: document optional Luna subagent delegation`
  - `3c1de05 docs: plan Code Mode request facets and folding`
- Related product spec: `docs/product-specs/session-transcript-analyzer.md`
- Related designs:
  - `docs/design-docs/code-mode-operations.md`
  - `docs/design-docs/code-mode-structured-display-catalog.md`
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/timeline-loading-and-rendering-performance.md`
- Domain language: `CONTEXT.md`

## Problem statement / 问题陈述

A safely projected Code Mode operation can visibly present as a Shell command, Plan update, Web request, image request, collaboration request, or another supported tool request. The current filter and Folding Strategy editor still expose only canonical event kinds and a small fixed condition set. A user can therefore see many `shell_command` cards but cannot filter for that visible content or assign it a folding state.

安全投影出的 Code Mode operation 可以在界面上明确呈现为 Shell command、Plan update、Web request、图像请求、协作请求或其他受支持工具请求，但当前筛选与折叠策略编辑器仍只暴露规范事件 kind 和少量固定 condition。用户因此可能看到大量 `shell_command` 卡片，却无法按这类可见内容筛选，也无法为其配置折叠状态。

Changing the parent event to canonical `kind: command` or `toolName: shell_command` would falsely promote a source declaration into execution evidence. Keeping the current controls unchanged instead makes the visible product vocabulary inconsistent with its control vocabulary. The required compatibility layer is a first-class presentation fact, not a canonical event rewrite.

把父事件改成规范的 `kind: command` 或 `toolName: shell_command` 会错误地把源码声明提升为执行证据；保持现有控件不变，则会让产品的可见词汇与控制词汇持续不一致。所需兼容层应是一等 presentation fact，而不是规范事件改写。

## Confirmed real-corpus evidence / 已确认的真实语料证据

A read-only 2026-07-24 repository-scoped scan observed approximately:

- 309 relevant transcripts, including about 111 with Code Mode;
- 7,300 Code Mode operations;
- 8,400 statically named `tools.*` call sites;
- 64% of static call sites eligible for the current all-or-nothing safe request projector;
- strong tool-specific divergence: most Shell and Plan requests were safely projected, Patch and MCP activity was often canonical nested activity without a safe parent projection, and Web requests commonly had both forms.

2026-07-24 的只读仓库范围扫描大致观察到：

- 309 个相关 transcript，其中约 111 个包含 Code Mode；
- 7,300 个 Code Mode operation；
- 8,400 个具有静态名称的 `tools.*` 调用点；
- 约 64% 的静态调用点符合当前整段 all-or-nothing 安全 request projector；
- 不同工具差异明显：多数 Shell 与 Plan request 可以安全投影，Patch 与 MCP activity 经常拥有规范 nested activity 却没有安全父投影，而 Web request 常同时具备两种形式。

These aggregates justify a separate declared-request interaction dimension. They do not prove execution and must not enter fixtures as real transcript content.

这些聚合数据支持增加独立的声明 request 交互维度，但不证明执行，也不得把真实 transcript 内容带入 fixture。

## Fixed product semantics / 固定产品语义

### Two visible dimensions / 两个可见维度

The product exposes two distinct controls:

1. `Event type / 事件类型`: what the canonical transcript model records, such as Code Mode operation, Command, Patch, or MCP call.
2. `Code Mode request / Code Mode 请求`: what a whole-program safe projection proves was declared in the operation source, such as `shell_command`, `update_plan`, or `web__run`.

产品暴露两个明确区分的控件：

1. `事件类型`：规范 transcript 模型记录了什么，例如 Code Mode operation、Command、Patch 或 MCP call。
2. `Code Mode 请求`：整段程序安全投影证明 operation 源码声明了什么，例如 `shell_command`、`update_plan` 或 `web__run`。

The active filter chip uses the complete provenance label, for example `Code Mode request: Shell command / Code Mode 请求：Shell command`. A friendly label must not hide the stable machine value when two tools share a display name.

生效筛选 chip 使用完整来源标签，例如 `Code Mode request: Shell command / Code Mode 请求：Shell command`。当两个工具共享展示名称时，友好 label 不得隐藏稳定机器值。

### Evidence boundary / 证据边界

- Only `projectDeclaredCodeModeCalls(...).supported === true` contributes request facts.
- Eligibility remains whole-program and all-or-nothing. Dynamic arguments, unsupported bindings, branches, loops, concurrency, dynamic dispatch, unknown tools, syntax errors, or budget failures contribute no request facet.
- A request fact proves only a declared request. It owns no Logical Event ID, execution count, status, severity, touched files, metric, search owner, Raw References, escalation state, result, or outcome.
- Canonical `kind`, `subtype`, and `toolName` remain unchanged.
- Observed Nested Activity remains independent and is never merged, hidden, deduplicated, or promoted to the parent through request facts.
- Existing `updatePlanCall` and `userInputRequest` conditions retain their canonical execution-oriented predicates. They do not expand to declared projections.

- 只有 `projectDeclaredCodeModeCalls(...).supported === true` 才贡献 request fact。
- 资格继续采用整段程序 all-or-nothing。动态参数、不支持的 binding、分支、循环、并发、动态分派、未知工具、语法错误或预算失败都不贡献 request facet。
- Request fact 只证明声明的 request，不拥有逻辑事件 ID、执行次数、status、severity、touched files、指标、搜索 owner、Raw References、提权状态、result 或 outcome。
- 规范 `kind`、`subtype` 与 `toolName` 保持不变。
- Observed Nested Activity 继续独立存在，绝不因 request fact 被合并、隐藏、去重或提升给父事件。
- 既有 `updatePlanCall` 与 `userInputRequest` condition 保留面向规范执行事件的 predicate，不扩展到 declared projection。

### Filter behavior / 筛选行为

Add one exact query parameter:

```text
codeModeRequest=shell_command
```

- It is available only on Main layer.
- It matches only canonical `subtype === 'code_mode_operation'` events with a matching safe request fact.
- Multiple declarations of the same tool count as one matching operation.
- A multi-tool operation may belong to multiple request facets, but contributes one event to a filtered result.
- `q`, `kind`, `status`, `file`, and `codeModeRequest` use same-event AND semantics.
- `status` and `file` continue to read only canonical facts owned by the parent event.
- Timeline totals, project matching totals, pagination, phrase occurrences, matching-event counts, and jump targets remain event-based.
- Catalog counts are matching-operation counts, not declared-call or execution counts. Facet counts may overlap.
- Switching from Main to Protocol or Raw clears the request filter rather than retaining an invisible active constraint.
- Session and Project scope both support the control in the first release.

增加一个精确查询参数：

```text
codeModeRequest=shell_command
```

- 仅在 Main layer 可用。
- 只匹配具有相应安全 request fact 的规范 `subtype === 'code_mode_operation'` 事件。
- 同一工具声明多次仍只计一个匹配 operation。
- 多工具 operation 可以属于多个 request facet，但在筛选结果中只贡献一个事件。
- `q`、`kind`、`status`、`file` 与 `codeModeRequest` 使用 same-event AND 语义。
- `status` 与 `file` 继续只读取父事件自己拥有的规范事实。
- Timeline total、project matching total、分页、短语 occurrence、匹配事件数和 jump target 继续以事件为单位。
- 目录 count 是匹配 operation 数，不是声明调用数或执行次数；facet count 可以重叠。
- 从 Main 切到 Protocol 或 Raw 时清除 request filter，不保留不可见的生效约束。
- 首版同时支持 Session 与 Project scope。

### Folding behavior / 折叠行为

Request rules form an editable rule family rather than one hard-coded condition per tool:

```js
rules: {
  kindStates: {},
  codeModeRequestStates: {
    shell_command: 'collapsed',
    update_plan: 'expanded',
  },
  conditions: [],
  fallback: 'summary',
}
```

Natural display-state resolution collects the canonical kind rule, every matching request rule, and every matching existing condition, then keeps the current most-visible merge:

```text
expanded > summary > collapsed > hidden
```

- Built-in profiles add no request rules in the first release, so default visible behavior remains unchanged.
- Missing `codeModeRequestStates` normalizes to `{}`.
- Valid unknown or historical tool keys survive normalization and persistence. The editor places them in an `Other / historical requests` group until the current catalog exposes them again.
- Request-rule edits preview immediately from timeline DTO facts and never require a detail fetch.

Request rule 是可编辑规则族，而不是为每个工具硬编码一个 condition：

```js
rules: {
  kindStates: {},
  codeModeRequestStates: {
    shell_command: 'collapsed',
    update_plan: 'expanded',
  },
  conditions: [],
  fallback: 'summary',
}
```

自然展示状态会收集规范 kind rule、所有匹配的 request rule 和所有匹配的既有 condition，然后继续使用当前最可见合并：

```text
expanded > summary > collapsed > hidden
```

- 首版不为内置 profile 增加 request rule，因此默认可见行为保持不变。
- 缺少 `codeModeRequestStates` 时规范化为 `{}`。
- 合法但未知或历史工具 key 在规范化和持久化时保留；当前目录再次暴露它们之前，编辑器把它们放入“其他/历史请求”组。
- Request rule 修改直接使用 timeline DTO fact 立即预览，绝不要求 detail fetch。

## Proposed data contract / 拟议数据契约

Do not add request names to canonical Logical Events. Add a separate in-memory presentation index:

```js
session.presentationIndexes.codeModeDeclaredRequests
// Map<operationId, {
//   toolNames: ['shell_command', 'update_plan'],
//   requestEvidence: 'declared_source',
// }>
```

The index may preserve source order and duplicates internally; matching and catalog counts deduplicate tool names per event.

Public lightweight logical DTOs may expose:

```js
presentationFacts: {
  codeModeDeclaredRequests: {
    toolNames: ['shell_command', 'update_plan'],
    requestEvidence: 'declared_source',
  },
}
```

State and timeline payloads add a catalog alongside `eventKinds`:

```js
codeModeRequests: [{
  value: 'shell_command',
  label: 'Shell command',
  count: 123,
  evidence: 'declared_source',
}]
```

Request arguments, AST nodes, outer source, and result association remain detail-only.

不要把 request name 加入规范 Logical Event。增加独立的内存 presentation index：

```js
session.presentationIndexes.codeModeDeclaredRequests
// Map<operationId, {
//   toolNames: ['shell_command', 'update_plan'],
//   requestEvidence: 'declared_source',
// }>
```

索引内部可以保留源码顺序和重复项；匹配和目录计数按 event 内工具名去重。

公开轻量逻辑 DTO 可以暴露：

```js
presentationFacts: {
  codeModeDeclaredRequests: {
    toolNames: ['shell_command', 'update_plan'],
    requestEvidence: 'declared_source',
  },
}
```

State 与 timeline payload 在 `eventKinds` 旁增加目录：

```js
codeModeRequests: [{
  value: 'shell_command',
  label: 'Shell command',
  count: 123,
  evidence: 'declared_source',
}]
```

Request arguments、AST node、outer source 与 result association 继续只存在于 detail。

## Performance decision gate / 性能决策门槛

The current contract intentionally keeps AST projection detail-only. This feature may move a bounded name-only pass into indexing, so the decision must be measured before implementation is locked.

当前 contract 有意让 AST projection 只发生在 detail。本功能可能把有界、仅名称的遍历移入索引，因此必须先测量，再锁定实现方案。

Run paired measurements on the reproducible fixture and the local repository-scoped corpus:

1. current `buildIndex` baseline;
2. build with one projector invocation per Code Mode operation;
3. parse-only per-Session P50/P95/max;
4. total source bytes, supported/unsupported distribution, and budget rejection counts;
5. elapsed-time, process CPU, peak RSS, retained heap, and serialized presentation-index size.

Decision:

- Prefer cold indexing when median full-build elapsed regression is at most 5% and retained-memory growth is small and bounded.
- Investigate and optimize between 5% and 10%.
- At more than 10%, use an immutable Session-level lazy cache or a measured hybrid, while preserving exact Project-scope catalog/filter behavior.

The existing source-length, call-count, literal-depth, and literal-node budgets remain hard limits. Index and detail must share one exact exec-source lookup and eligibility entry point so their facts cannot drift.

在可复现 fixture 与本地仓库范围语料上运行配对测量：

1. 当前 `buildIndex` baseline；
2. 每个 Code Mode operation 调用一次 projector 的 build；
3. parse-only 的每 Session P50/P95/max；
4. 总 source bytes、supported/unsupported 分布与预算拒绝计数；
5. elapsed time、process CPU、peak RSS、retained heap 与序列化 presentation-index 大小。

决策：

- 完整 build 中位 elapsed 回归不超过 5%，且 retained memory 增量较小并有界时，优先 cold indexing。
- 5% 到 10% 之间先调查和优化。
- 超过 10% 时采用 immutable Session-level lazy cache 或经过测量的 hybrid，同时保持精确的 Project scope 目录/筛选行为。

既有 source length、调用数、literal depth 与 literal node 预算继续作为硬限制。索引与 detail 必须共享同一个精确 exec-source lookup 和 eligibility 入口，避免事实漂移。

## Implementation phases / 实施阶段

### Phase 0: baseline and contract spike / 基线与契约 spike

- [x] Record paired indexing/performance measurements and choose cold, lazy, or hybrid indexing.
- [x] Freeze query name, DTO namespace, catalog shape, evidence value, layer-transition behavior, Project-scope behavior, and historical profile-key policy.
- [x] Add minimized sanitized fixtures for safe single, safe multi, duplicate tool, and all raw-fallback families.

### Phase 1: shared projection facts / 共享投影事实

- [x] Extract a shared exact outer-exec source lookup from operation phase refs.
- [x] Build the independent presentation index without mutating canonical Logical Events.
- [x] Produce per-Session and project-wide request catalogs with operation counts.
- [x] Prove canonical event serialization, metrics, Raw refs, status, and analysis counts remain unchanged.

### Phase 2: server filtering and DTOs / 服务端筛选与 DTO

- [x] Parse and validate `codeModeRequest`.
- [x] Add presentation-aware matching without rewriting `event.toolName`.
- [x] Apply the filter before pagination in Session timeline and Project results.
- [x] Add lightweight `presentationFacts` and `codeModeRequests` catalogs to the required state/timeline surfaces.
- [x] Preserve same-event intersections, phrase counts, target counts, and layer isolation.

### Phase 3: folding schema and evaluation / 折叠 schema 与求值

- [x] Add `codeModeRequestStates` normalization, persistence, migration, and most-visible evaluation.
- [x] Preserve valid historical keys and protect reserved object names.
- [x] Keep every built-in profile default behavior unchanged.
- [x] Add the editable request-rule group with current and historical catalog rows.

### Phase 4: browser filter integration / 浏览器筛选接入

- [x] Add the Main-only `Code Mode request` selector and operation counts.
- [x] Integrate draft/committed search state, active chips, clear actions, URL/API composition, and filter summaries.
- [x] Add the field to data-context, request-owner, target-registry, preload, pagination, Session/Project, locale, and stale-response keys.
- [x] Clear the filter on Protocol/Raw transitions.
- [x] Keep narrow-screen and keyboard behavior consistent with existing fixed filters.

### Phase 5: documentation and acceptance / 文档与验收

- [x] Update bilingual product, Code Mode, logical-timeline, structured-display, and performance contracts.
- [x] Regenerate browser assets from source and pass build check.
- [x] Run unit, integration, browser, package, and performance gates.
- [x] Move this plan to `completed/` only after every required behavior and measurement passes.

## Acceptance matrix / 验收矩阵

### Projection facts / 投影事实

- Safe single `shell_command`, `update_plan`, and `web__run` produce request facts, catalog entries, filter matches, and editable rules.
- Safe multi-tool operations match every contained facet but contribute one filtered event.
- Repeated same-tool declarations contribute one facet count per event.
- Dynamic arguments, branches, loops, concurrency, unknown tools, syntax errors, and budget failures contribute no request facts.
- Request-only `none` result association remains eligible; result association is not part of filter eligibility.

### Evidence isolation / 证据隔离

- Declared `update_plan` does not increase plan metrics or match the canonical `updatePlanCall` condition.
- Declared shell requests do not become command events or inherit command status.
- A parent request fact and a real nested Patch/MCP/Web event remain independent events/facts with unchanged ownership.
- Canonical IDs, kinds, subtypes, tool names, status/severity, touched files, metrics, search owners, Raw refs, and analysis counts remain unchanged.

### Filter composition / 筛选组合

- `codeModeRequest` composes with `q`, `kind`, `status`, and `file` on the same parent event.
- Session and Project scope produce exact event totals and deterministic latest-match drill-down.
- Pagination, Load more, target discovery, phrase occurrences, matching-event counts, Back to project results, and zero-result states remain correct.
- Protocol/Raw transitions clear the filter and do not restore it through a stale response.

### Folding and persistence / 折叠与持久化

- Request rules support hidden, collapsed, summary, and expanded.
- Conflicts with kind and condition rules resolve by the existing most-visible priority.
- Multi-tool operations collect all matching request rules deterministically.
- Old localStorage profiles load with an empty request map.
- Historical valid keys survive save/load, locale changes, repository switches, and absent catalogs.
- Built-in profile snapshots remain behaviorally identical.

### Browser and transition safety / 浏览器与转换安全

- The visible card label, filter option, active chip, and folding row use consistent bilingual terminology.
- Stable machine names remain distinguishable when friendly labels collide.
- Rapid query/filter/Session/Project/Layer/locale/profile transitions cannot commit stale request catalogs, filters, or folding previews.
- Narrow-screen tabs, keyboard activation, focus restoration, and search-assist Escape behavior remain correct.

### Required gates / 必需门禁

- `npm test`
- `npm run test:browser`
- `npm run test:package`
- `npm run build`
- `npm run build:check`
- `git diff --check`
- paired indexing benchmark from the performance decision gate
- `npm run profile:timeline` when timeline rendering, target discovery, or DTO size changes materially

No real Session Transcript, private command/result body, user path beyond existing public repository examples, or sensitive request arguments may enter fixtures, generated assets, docs, or commits.

真实 Session Transcript、私有 command/result 正文、现有公开仓库示例之外的用户路径或敏感 request arguments 均不得进入 fixture、生成资产、文档或提交。

## Progress log / 进度日志

- 2026-07-25: Planning baseline created after committing the enclosing-operation context/discoverability increment. Product semantics, evidence boundaries, Session/Project scope, Main-layer clearing behavior, folding schema, historical-key policy, performance decision gate, implementation phases, and acceptance matrix are recorded. No runtime implementation has started. / 2026-07-25：在 enclosing-operation context/discoverability 增量提交后建立规划基线。已记录产品语义、证据边界、Session/Project scope、Main layer 清除行为、折叠 schema、历史 key 策略、性能决策门槛、实施阶段与验收矩阵；尚未开始运行时实现。
- 2026-07-25: Phase 0 selected cold indexing from a read-only paired benchmark on one immutable local snapshot. The repository-scoped corpus contained 313 Sessions, 7,440 Code Mode operations, and 5.994 MiB of outer source. The existing build took 11,865.6 ms; the bounded name-only projector pass took 266.7 ms, for a 12,132.3 ms combined estimate and 2.25% wall-time regression. It retained about 1.89 MiB and serialized to about 817.6 KiB. A seven-Session sanitized fixture measured 4.77% wall-time regression. Both pass the 5% gate; lazy or hybrid indexing is not warranted. Only aggregates are recorded. / 2026-07-25：Phase 0 基于同一个不可变本地快照上的只读配对基准选择 cold indexing。仓库范围语料包含 313 个 Session、7,440 个 Code Mode operation 与 5.994 MiB outer source。既有 build 耗时 11,865.6 ms；有界的仅名称 projector pass 耗时 266.7 ms，合计估算 12,132.3 ms，wall-time 回归 2.25%。它额外保留约 1.89 MiB，序列化后约 817.6 KiB。七 Session 脱敏 fixture 的 wall-time 回归为 4.77%。两者都通过 5% 门槛，无需 lazy 或 hybrid indexing。这里只记录聚合数据。
- 2026-07-25: Runtime implementation began after the performance gate. The shared exact outer-exec lookup, independent Session presentation index, operation-count catalogs, presentation-aware server filtering/DTOs, and additive folding-rule schema are under test; canonical Logical Events remain unchanged. / 2026-07-25：性能门禁通过后开始运行时实现。共享的精确 outer-exec lookup、独立 Session presentation index、按 operation 计数的目录、presentation-aware 服务端筛选/DTO 与 additive folding-rule schema 正在测试中；规范 Logical Event 保持不变。
- 2026-07-25: Completed the independent Main-only request filter/catalog, lightweight timeline facts, additive folding rules/editor, historical-key migration, bilingual contracts, generated assets, and transition-safe Session/Project browser integration. Final acceptance passed `npm test` (283/283), `npm run test:browser` (77/77), package smoke, build/check, the paired cold-index benchmark, and timeline profiling with no acceptance failures. Two final read-only reviews found no blocker; their defensive non-Main catalog/fact observations were fixed before completion. / 2026-07-25：完成独立且仅 Main 可用的 request 筛选/目录、轻量 timeline facts、增量折叠规则/编辑器、历史 key 迁移、双语合同、生成资产，以及具备 transition safety 的 Session/Project 浏览器接入。最终验收通过 `npm test`（283/283）、`npm run test:browser`（77/77）、package smoke、build/check、配对 cold-index 基准与 timeline profiling，且无 acceptance failure。两次最终只读审查均未发现 blocker；其中关于非 Main 目录/事实的防御性意见已在完成前修复。
