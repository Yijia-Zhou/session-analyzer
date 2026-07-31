# Code Mode Context and Discoverability / Code Mode 上下文与可发现性

## Metadata / 元数据

- Status: completed / 状态：已完成
- Date: 2026-07-22 / 日期：2026-07-22
- Scope: public logical DTO context, Main Kind/Type discoverability, canonical Code Mode folding, and a temporary enclosing-operation UI path / 范围：公开逻辑 DTO 上下文、Main 类型可发现性、规范 Code Mode 折叠，以及临时的 enclosing-operation UI 路径
- References: `CONTEXT.md`, `docs/product-specs/session-transcript-analyzer.md`, `docs/design-docs/logical-event-timeline.md`, `docs/design-docs/code-mode-operations.md`, `docs/design-docs/timeline-loading-and-rendering-performance.md`, `tmp/code-mode-operation-observations-2026-07-18.md` / 参考：上述领域上下文、产品规格、逻辑时间线、Code Mode、性能设计与调查记录

## Objective and non-goals / 目标与非目标

Expose the already-proven relationship between an observed nested Logical Event and its enclosing Code Mode Operation without changing canonical identity, evidence ownership, search/count/status semantics, pagination, or Folding Strategy defaults. Make the canonical subtype discoverable and give users a reversible path to inspect the enclosing operation when it is not currently visible. / 暴露已被证明的已观测嵌套逻辑事件与 enclosing Code Mode Operation 之间的关系，同时不改变规范 identity、证据 ownership、搜索/计数/status 语义、分页或折叠策略默认值；让规范 subtype 可发现，并在父操作当前不可见时提供可逆的检查路径。

Do not add a Logical Event kind, merge parent and child events, promote declared `tools.*` calls to execution facts, copy nested `rawRefs`, status, severity, touched files, metrics, or search text to the parent, persist a fold override, change target/count ownership, edit transcript files, or commit real/sensitive transcript data. / 不新增逻辑事件 kind，不合并父子事件，不把声明的 `tools.*` 调用提升为执行事实，不复制 nested `rawRefs`、status、severity、touched files、metrics 或搜索文本到父操作，不持久化折叠 override，不改变 target/计数 ownership，不编辑转录文件，也不提交真实/敏感转录数据。

## Accepted contracts / 已接受契约

### 1. Presentation-only reverse relation / 仅呈现的反向关系

At the public logical-event DTO boundary (`/timeline` and the layer-aware event envelope), add the optional machine field below; omit the field entirely when it cannot be proven. It is not part of raw DTOs or the canonical event graph. / 在公开逻辑事件 DTO 边界（`/timeline` 与感知 layer 的 event envelope）增加以下可选机器字段；无法证明时完全省略。它不属于 raw DTO 或规范事件图。

```js
presentationContext: {
  relation: 'enclosed_by_code_mode_operation',
  codeModeParentId: '<logical-operation-id>',
}
```

Build a reverse index only from the existing operation association facts: a candidate parent has the canonical `subtype === 'code_mode_operation'` and an existing `eventRefs` list containing the nested event ID. Emit the relation only when exactly one existing parent matches. Missing parents, missing/malformed refs, duplicate parent matches, ambiguous/cross-span associations, and declaration/projection-only evidence emit no field. Never infer from JavaScript text, declared tool names, timestamps, adjacency, or a similar nested `call_id`. / 反向索引只能来自既有 operation 关联事实：候选父操作具有规范 `subtype === 'code_mode_operation'`，且其现有 `eventRefs` 列表包含 nested event ID。只有恰好一个已存在的父操作匹配时才输出关系。父操作缺失、refs 缺失/格式错误、多个父操作匹配、歧义/跨区间关联，以及仅有 declaration/projection 证据时都不输出字段。绝不根据 JavaScript 文本、声明工具名、timestamp、相邻关系或相似 nested `call_id` 推断。

The relation is display-only and locale-neutral. The operation keeps its outer exec/wait Raw refs and one operation metric/search owner; the nested event keeps its own identity, Raw refs, status/severity, touched files, outcome, metrics, and search target. Following `eventRefs` must never affect filtering, counts, status, or raw ownership. / 该关系只用于展示且不随 locale 变化。operation 继续拥有 outer exec/wait Raw refs 及一个 operation metric/search owner；nested event 继续拥有自身 identity、Raw refs、status/severity、touched files、outcome、metrics 与 search target。沿 `eventRefs` 导航绝不能影响筛选、计数、status 或 raw ownership。

### 2. Main Kind/Type catalog and filters / Main 类型目录与筛选

For Main-layer catalogs, retain the `other_tool_call` entry and add a discoverability entry `{ value: 'code_mode_operation', label, count, matchField: 'subtype' }` for canonical operations. The alias count is the number of matching operations; it is a catalog facet, not a second event or metric. Localize only `label`; keep machine values stable. / 对 Main 层目录，保留 `other_tool_call` 条目，并为规范 operation 增加可发现条目 `{ value: 'code_mode_operation', label, count, matchField: 'subtype' }`。alias count 是匹配 operation 的数量；它是目录 facet，不是第二个事件或 metric。只本地化 `label`，机器值保持稳定。

Keep existing subtype-compatible matching (`event.kind === requested || event.subtype === requested`) for timeline, session, and project expressions. Selecting `other_tool_call` returns every canonical event of that kind (including Code Mode operations); selecting `code_mode_operation` returns only the subtype-matching operation subset. Counts may therefore differ, while every Code Mode operation remains discoverable through both filters; do not expose unrelated subtypes as Main kinds. / 保留现有 subtype 兼容匹配（`event.kind === requested || event.subtype === requested`），覆盖 timeline、session 与 project 表达式。选择 `other_tool_call` 会返回该 kind 的全部规范事件（包括 Code Mode operation）；选择 `code_mode_operation` 只返回 subtype 匹配的 operation 子集。因此两者计数可以不同，但每个 Code Mode operation 仍可通过两种筛选发现；不要把无关 subtype 暴露为 Main kind。

### 3. Canonical folding condition / 规范折叠 condition

Define/retain `codeModeOperation` as a condition whose predicate is exactly `event.subtype === 'code_mode_operation'`. It must not match `toolName`, `label`, adaptive presentation variant, declared `update_plan`/`request_user_input`, or any other projection fact. Do not seed this condition into built-in profile rules or add `code_mode_operation` to editable canonical kind defaults in this increment; built-in visible states remain byte-for-byte behaviorally unchanged. / 定义/保留 `codeModeOperation` condition，其 predicate 精确为 `event.subtype === 'code_mode_operation'`。它不得匹配 `toolName`、`label`、自适应 presentation variant、声明的 `update_plan`/`request_user_input` 或任何其他 projection 事实。本增量不把该 condition 写入内置 profile 规则，也不把 `code_mode_operation` 加入可编辑 canonical kind 默认值；内置可见状态在行为上保持不变。

### 4. Enclosing-operation affordance / enclosing-operation 入口

On a nested event that has the unique `presentationContext`, render a low-emphasis, localized affordance only when the event is relevant in the current session view: it is an active free-text hit, a returned structured-filter result, selected, or expanded. The affordance itself is a control, not an event, and must not become searchable content or a target. / 对具有唯一 `presentationContext` 的 nested event，仅当它在当前 session 视图中相关时渲染低强调、本地化入口：它是生效自由文本命中、已返回的结构化筛选结果、已选中或已展开事件。入口本身是 control 而非 event，不得成为可搜索内容或 target。

- If the parent card is mounted, not profile-hidden, and is structurally in the committed timeline, activate the existing event-selection/scroll path directly. Any expansion needed for navigation is transient and never writes a persisted fold override. / 如果父卡片已挂载、未被 profile 隐藏且属于已提交时间线的结构成员，直接调用既有事件选择/滚动路径。导航所需的展开只能是临时的，绝不写入持久化 fold override。
- If the parent is profile-hidden, outside the loaded prefix, or excluded by structural filters, activate a dedicated context request owner keyed by the committed repository/scope/session/layer/query/filters/profile/locale/detail context plus nested and parent IDs. Resolve the parent through the existing layer-aware envelope/detail path, not by appending a timeline page. / 如果父操作被 profile 隐藏、位于已加载前缀之外，或被结构化筛选排除，则启动专用 context request owner；其 key 包含已提交的 repository/scope/session/layer/query/filters/profile/locale/detail context 以及 nested/parent ID。通过既有感知 layer 的 envelope/detail 路径解析父操作，不追加时间线分页。
- On a current-owner success, insert one distinct context-only summary row immediately before the nested event. It may show parent label/preview and an inspect/open action, but it is explicitly marked context-only and is not a normal event card. A missing/ambiguous parent or non-current/failed request leaves canonical timeline state unchanged and shows only the existing non-blocking error/fallback path. / 当前 owner 成功时，在 nested event 前立即插入一条 distinct context-only summary row。它可以显示父操作 label/preview 及 inspect/open action，但必须明确标记为 context-only，不能是普通 event card。父操作缺失/歧义或请求过期/失败时，规范时间线状态保持不变，只走既有非阻塞错误/fallback 路径。

The row is presentation-only: no `currentEvents`/offset/timeline total mutation, no project matching-total change, no search descriptor or highlight binding, no occurrence/count change, no Raw-ref ownership, and no pagination side effect. It has a distinct data/class/ARIA marker, no ordinary event ID/search-owner attributes, and is excluded from target discovery, search highlighting, and event-card counts. / 该 row 只用于呈现：不修改 `currentEvents`/offset/timeline total，不改变 project matching total，不产生 search descriptor 或 highlight binding，不改变 occurrence/count，不拥有 Raw refs，也不触发分页。它使用 distinct data/class/ARIA 标记，不带普通 event ID/search-owner 属性，并排除在 target 发现、搜索高亮和 event-card 计数之外。

### 5. Stale-context cancellation / 过期 context 取消

Context reveals have explicit generation plus `AbortController` ownership. A superseding reveal cancels only its matching owner; scope, repository, Session, Layer, query/filter, Folding Strategy, locale, selected detail/view, or detail-cache-generation transitions invalidate the context generation, abort pending context requests, and remove all context rows. Success/error/`finally` handlers require both current owner identity and the captured committed context; typed intentional aborts do not show errors or zero-result state. / context reveal 具有显式 generation 与 `AbortController` ownership。被取代的 reveal 只取消其匹配 owner；scope、repository、Session、Layer、query/filter、折叠策略、locale、选中 detail/view 或 detail-cache-generation 转换会使 context generation 失效，取消 pending context request，并移除所有 context row。success/error/`finally` handler 必须同时满足 current owner identity 与捕获的已提交 context；typed intentional abort 不显示错误或零结果状态。

Context-row insertion/removal must update only the context presentation slot (or an equivalent owner-scoped renderer path); it must not rerun canonical target discovery or make the row part of ordinary timeline/search DOM. / context row 的插入/移除只能更新 context presentation slot（或等价的 owner-scoped renderer 路径）；不得重新运行规范 target 发现，也不得让 row 成为普通 timeline/search DOM。

## Implementation slices / 实现切片

1. **Server/shared contract:** derive the reverse relation from the existing Code Mode facts, emit it on logical timeline/event-envelope DTOs, add the Main catalog alias and localized labels, and lock the subtype-only folding condition. Keep canonical fields and all existing search/count/filter/status/raw paths untouched. / **服务端/共享契约：**从既有 Code Mode facts 派生反向关系，在逻辑 timeline/event-envelope DTO 上输出；增加 Main 目录 alias 与本地化 label；锁定仅 subtype 的 folding condition。保持 canonical fields 及既有搜索/计数/筛选/status/raw 路径不变。
2. **Browser presentation:** add the relevance-gated affordance, visible-parent direct navigation, a separate context state/request owner for hidden or excluded parents, a temporary context-only row, and explicit clear/cancel hooks. Reuse only the existing envelope/detail/Inspector read primitives for opening a fetched parent; do not route this through `temporaryEventReveal` or ordinary event insertion, and never mutate the filtered event set or saved overrides. / **浏览器呈现：**增加按相关性门控的入口、可见父操作直达、用于隐藏/排除父操作的独立 context state/request owner、临时 context-only row 及明确的清除/取消钩子。打开已获取父操作时只复用既有 envelope/detail/Inspector 读取基础能力；不要通过 `temporaryEventReveal` 或普通事件插入实现，也绝不修改筛选事件集或已保存 override。
3. **Bilingual documentation:** update the product spec and the logical-timeline, Code Mode, and performance design docs in English and Chinese together. Record the optional DTO field, association proof boundary, catalog/filter compatibility, folding-default decision, context-row ownership, cancellation key, and unchanged count/search/pagination invariants. / **双语文档：**同步更新产品规格以及逻辑时间线、Code Mode、性能设计文档的英文和中文。记录可选 DTO 字段、关联证据边界、目录/筛选兼容性、折叠默认值决策、context row ownership、取消 key，以及不变的计数/搜索/分页不变量。
4. **Generated assets:** edit browser source and styles only; run `npm run build` to regenerate `public/assets/app.js` (and vendor assets only when their source changes), then run `npm run build:check`. Never hand-edit generated bundles. / **生成资产：**只编辑浏览器源码和样式；运行 `npm run build` 生成 `public/assets/app.js`（仅在 vendor 源改变时生成 vendor 资产），随后运行 `npm run build:check`。绝不手工编辑生成 bundle。

## Acceptance matrix / 验收矩阵

### Unit / 单元

- Unique, missing, malformed, ambiguous, duplicate, and cross-span `eventRefs` cases; exact DTO shape and omission behavior; logical DTO surfaces versus raw/detail ownership. / 覆盖唯一、缺失、格式错误、歧义、重复和跨区间 `eventRefs`；验证精确 DTO 形状与省略行为；区分逻辑 DTO surface 与 raw/detail ownership。
- Canonical parent/child identity, Raw refs, status/severity, touched files, metrics, search owners, and current-session/project counts remain byte-for-byte/semantically unchanged; parent-only, nested-only, and both-hit searches retain target membership and same-event intersections. / 验证 canonical 父子 identity、Raw refs、status/severity、touched files、metrics、search owner 及当前 session/project 计数在字节/语义上不变；parent-only、nested-only、both-hit 搜索保持 target 成员和 same-event intersection。
- Main catalog contains both `other_tool_call` and `code_mode_operation` (subtype match metadata and localized labels); `other_tool_call` includes all canonical events of that kind, while `code_mode_operation` returns the matching subtype subset and the same Code Mode operation IDs; unrelated subtypes remain absent. / Main 目录同时包含 `other_tool_call` 与 `code_mode_operation`（subtype match metadata 和本地化 label）；`other_tool_call` 包含该 kind 的全部规范事件，而 `code_mode_operation` 返回匹配 subtype 的子集及相同的 Code Mode operation ID；无关 subtype 不出现。
- Folding tests prove only canonical subtype matches, declared projections do not, and every built-in profile's visible defaults remain unchanged. / 折叠测试证明只有 canonical subtype 命中，声明 projection 不命中，且所有内置 profile 可见默认值不变。

### Browser E2E / 浏览器端到端

- Affordance appears only for a unique relation in search/filter/selected/expanded states; ambiguous/unrelated nested events have none. / 入口只在唯一关系且处于 search/filter/selected/expanded 状态时出现；歧义/无关 nested event 不出现。
- Visible parent navigates directly; profile-hidden, unloaded, and structurally filtered parents fetch through the context owner and produce one context-only row before the nested event. The row is distinct from ordinary event/search-owner DOM and does not change pagination, counts, target denominator, or highlights. / 可见父操作直达；profile-hidden、未加载和结构化排除父操作通过 context owner 获取，并在 nested event 前产生一条 context-only row。该 row 与普通 event/search-owner DOM distinct，且不改变分页、计数、target 分母或高亮。
- Rapid activation followed by Session/Layer/filter/locale/detail transitions aborts and clears stale rows; late success cannot resurrect them; no fold override is persisted. / 快速激活后进行 Session/Layer/filter/locale/detail 转换会取消并清除过期 row；晚到 success 不能复活它们；不持久化 fold override。

### Build and package / 构建与打包

Run `npm test`, `npm run test:browser`, `npm run test:package`, and `npm run build:check` after `npm run build`; generated assets must be current. / 在 `npm run build` 后运行 `npm test`、`npm run test:browser`、`npm run test:package` 与 `npm run build:check`；生成资产必须是最新的。

### Performance regression / 性能回归

Run `npm run profile:timeline` with the reproducible sanitized synthetic 1,800-event corpus at shallow, medium, and deep materialization, common-term highlighting, visible details, and one context reveal. Compare feature-on with a same-environment feature-off baseline. Stable scenarios require exact canonical request/render/card/mark/target/count metrics. In the intentionally cancelled `switchDuringQuery` scenario, requests and final canonical card/mark/target/count state remain exact while transient render/card/highlight/discovery work may decrease but must not increase. Context reveal may add at most its owned envelope/detail fetch and one owner-scoped row update, never a timeline page or target-discovery pass. End-to-end and Long Task measurements must stay within 10% of baseline. Temporary profiling data is removed after the run. / 使用可复现且脱敏的 1,800-event 合成语料，在浅、中、深物化、常见词高亮、可见 detail 和一次 context reveal 场景运行 `npm run profile:timeline`。将启用功能与同环境关闭功能 baseline 比较。稳定场景要求 canonical request/render/card/mark/target/count 指标精确相等；在有意取消的 `switchDuringQuery` 场景中，请求和最终规范 card/mark/target/count 状态保持精确一致，而瞬态 render/card/highlight/discovery 工作可以减少但不得增加。context reveal 最多增加其 ownership 范围内的 envelope/detail fetch 和一次 owner-scoped row 更新，绝不增加 timeline page 或 target-discovery pass。端到端与 Long Task 指标须保持在 baseline 的 10% 以内。临时 profiling 数据运行后删除。

No real Session Transcript or sensitive command/result body may enter fixtures, generated assets, docs, or the commit. / 真实会话转录或敏感 command/result 正文不得进入 fixture、生成资产、文档或提交。

## Progress / 进度

- [x] Planning complete: public contract, ownership boundaries, UI state/cancellation rules, docs, generated-asset workflow, and acceptance gates agreed. / 规划完成：公开契约、ownership 边界、UI state/取消规则、文档、生成资产流程及验收门禁已确定。
- [x] Implement DTO reverse relation and catalog/filter compatibility. / 实现 DTO 反向关系及目录/筛选兼容。
- [x] Lock canonical folding condition without changing built-in visible defaults. / 锁定规范 folding condition，且不改变内置可见默认值。
- [x] Implement affordance, context owner/row, and transition invalidation. / 实现入口、context owner/row 及转换失效。
- [x] Update synchronized bilingual product/design docs. / 同步更新双语产品/设计文档。
- [x] Regenerate/check assets and pass unit, E2E, package/build, and performance acceptance. / 重新生成/检查资产并通过单元、E2E、package/build 及性能验收。
- [x] Move this plan to `docs/exec-plans/completed/` only after every acceptance item passes. / 只有全部验收项通过后，才将本计划移至 `docs/exec-plans/completed/`。

## Completion evidence / 完成证据

- `npm test`: 267/267 passed. / `npm test`：267/267 通过。
- `npm run test:browser`: 76/76 passed, including filtered-parent context insertion and late-response invalidation across detail, fold, and profile transitions. / `npm run test:browser`：76/76 通过，包括被筛选父操作的 context 插入，以及跨 detail、fold 与 profile 转换的晚到响应失效。
- `npm run test:package` and `npm run build:check`: passed; generated assets are current. / `npm run test:package` 与 `npm run build:check`：通过；生成资产为最新。
- The final sanitized 1,800-event feature-off/on measurement passed the accepted comparator: stable scenarios remained exact; cancelled-transition transient work did not increase; duration and Long Task limits stayed within 110% of baseline. The context reveal issued one event-envelope request, zero timeline requests, performed zero full renders/card generations/highlight or target-discovery passes, inserted one owner-scoped row, and preserved isolated canonical state. / 最终脱敏 1,800 事件 feature-off/on 测量通过已接受的比较器：稳定场景保持精确一致；取消转换的瞬态工作没有增加；时延与 Long Task 均保持在 baseline 的 110% 以内。context reveal 发出一次 event-envelope 请求、零次 timeline 请求，执行零次完整 render/card generation/highlight 或 target-discovery pass，插入一条 owner 范围 row，并保持隔离且不变的规范状态。
