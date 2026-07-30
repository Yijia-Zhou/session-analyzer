# Planning semantic facet convergence / 规划语义 facet 收敛

## Objective / 目标

Extract the confirmed narrow Plan Event category into one browser-safe post-normalization contract consumed by metrics, folding, and navigation. Preserve raw-to-logical parsing, normalized form, provenance-specific detail presentation, Code Mode ownership, and every currently admitted user-visible result while rejecting label-only and conflicting normalized lookalikes.

把已确认的窄 Plan Event 类别提取为一份浏览器安全的归一化后契约，由指标、折叠与导航共同消费。保持 raw-to-logical 解析、归一化 form、provenance 专属 detail 展示、Code Mode ownership 与所有当前已准入的用户可见结果不变，同时拒绝仅靠 label 或归一化字段冲突的 lookalike。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-31 / 开始日期：2026-07-31
- Completed: 2026-07-31 / 完成日期：2026-07-31
- Related design: `docs/design-docs/cross-surface-contract-consistency-tech-debt.md` / 相关设计：`docs/design-docs/cross-surface-contract-consistency-tech-debt.md`
- Product contract: `docs/product-specs/session-transcript-analyzer.md` / 产品契约：`docs/product-specs/session-transcript-analyzer.md`
- Domain language: `CONTEXT.md` / 领域语言：`CONTEXT.md`

## Fixed semantic decisions / 固定语义决策

1. A Plan Event is exactly one Plan Artifact or Plan Update; goal and other planning-reading anchors stay outside the facet. / 一个计划事件恰好属于计划产物或计划更新；goal 与其他计划阅读锚点不属于该 facet。
2. The shared facet exposes only `{ category: 'artifact' | 'update' }`; existing canonical fields retain normalized form. / 共享 facet 只暴露 `{ category: 'artifact' | 'update' }`；归一化 form 继续由既有 canonical 字段保留。
3. Exact admitted combinations are `proposed_plan/proposed_plan`, direct or observed nested `other_tool_call/update_plan/update_plan`, and protocol `plan_update` with subtype `plan_update` or `plan_delta`. / 精确准入组合为 `proposed_plan/proposed_plan`、直接或已观测嵌套的 `other_tool_call/update_plan/update_plan`，以及 subtype 为 `plan_update` 或 `plan_delta` 的协议 `plan_update`。
4. Display labels never establish Plan membership. Conflicting canonical combinations fail closed. / 展示 label 绝不建立 Plan membership；canonical 组合冲突时保守拒绝。
5. Independently persisted Observed Nested Activity keeps its own Plan membership. Declared Nested Calls, Nested Tool Projections, and the owning Code Mode Operation add no membership or count. / 独立持久化的已观测嵌套活动保留自身 Plan membership；声明的嵌套调用、嵌套工具投影与所属 Code Mode 操作均不增加 membership 或计数。
6. The Plan metric counts every Plan Event once; compatibility `planArtifacts` counts only Plan Artifacts; aggregate navigation includes both categories and update-only navigation includes only Plan Updates. / Plan 指标对每个计划事件计数一次；兼容性 `planArtifacts` 只统计计划产物；聚合导航包含两个类别，仅更新导航只包含计划更新。

## Invariants and non-goals / 不变量与非目标

1. Do not change Raw Record parsing, Logical Event construction, kind/subtype/toolName values, Raw References, labels, previews, search text, status, severity, or detail sections. / 不改变原始记录解析、逻辑事件构造、kind/subtype/toolName 值、原始引用、label、preview、搜索文本、status、severity 或 detail sections。
2. Do not infer execution from Code Mode JavaScript or Nested Tool Projections. / 不从 Code Mode JavaScript 或嵌套工具投影推断执行。
3. Do not merge Plan Event category with Planning Folding Strategy membership. / 不把 Plan Event 类别与 Planning Folding Strategy membership 合并。
4. Do not add normalized form or raw provenance to the shared facet. / 不向共享 facet 增加归一化 form 或 raw provenance。
5. Preserve the existing public navigation category IDs and compatibility folding export where required. / 在需要时保留现有公开导航类别 ID 与兼容性 folding export。

## Implementation phases / 实施阶段

### Phase 1: shared contract / 第一阶段：共享契约

- Add a UMD-compatible `src/shared/plan-facet.js` with immutable category values, immutable facet values, exact admission, and derived predicates. / 增加 UMD 兼容的 `src/shared/plan-facet.js`，提供不可变 category 值、不可变 facet 值、精确准入与派生 predicate。
- Add the module to the browser entry and runtime package coverage. / 把该模块加入浏览器入口与运行时 package 覆盖。

### Phase 2: consumer convergence / 第二阶段：消费方收敛

- Make session Plan metrics consume the shared category. / 让 Session Plan 指标消费共享类别。
- Make folding conditions and important-event classification consume the shared predicates while retaining a compatibility export if existing callers require it. / 让 folding condition 与 important-event 分类消费共享 predicate，并在既有 caller 需要时保留兼容 export。
- Make aggregate and update-only browser navigation consume the same predicates. / 让聚合与仅更新浏览器导航消费相同 predicate。

### Phase 3: proof and closeout / 第三阶段：证明与收口

- Add table-driven exact admission and conflicting/label-only negative tests. / 增加表驱动的精确准入与字段冲突/仅 label 负向测试。
- Prove isolated and mirrored Plan Artifact forms, direct and observed nested updates, protocol update/delta, Code Mode declaration exclusions, metrics, folding, navigation, and unchanged detail. / 证明独立与镜像 Plan Artifact form、直接与已观测嵌套 update、协议 update/delta、Code Mode declaration 排除、指标、折叠、导航与不变 detail。
- Regenerate the browser asset, run focused and complete validation, update the design result and tracker, and archive this plan only after every check passes. / 重新生成浏览器资产，运行聚焦与完整验收，更新设计结果与 tracker，并且只在全部检查通过后归档本计划。

## Acceptance criteria / 验收标准

1. One shared post-normalization contract owns all Plan Event membership and category decisions used by metrics, folding, and navigation. / 一份共享归一化后契约拥有指标、折叠与导航使用的全部 Plan Event membership 和类别决策。
2. Every exact admitted combination returns the intended immutable category; incomplete, label-only, unknown, and conflicting combinations return no facet. / 每个精确准入组合返回预期的不可变类别；不完整、仅 label、未知与字段冲突组合均不返回 facet。
3. Declared Code Mode plan requests remain presentation/folding-request facts only, while independently observed nested `update_plan` events retain ordinary Plan Update behavior. / 声明的 Code Mode 计划 request 继续只作为展示/折叠 request fact，而独立观测到的嵌套 `update_plan` event 保留普通 Plan Update 行为。
4. Plan metric, compatibility artifact count, folding, aggregate navigation, and update-only navigation match the confirmed matrix. / Plan 指标、兼容 artifact 计数、折叠、聚合导航与仅更新导航符合已确认矩阵。
5. Detail sections, normalized Logical Event envelopes, generated assets, package contents, Node tests, browser tests, build check, and diff check remain valid. / Detail sections、归一化逻辑事件 envelope、生成资产、package 内容、Node 测试、浏览器测试、build check 与 diff check 保持有效。

## Progress log / 进度日志

- 2026-07-31: Confirmed the semantic categories, exact normalized admission, Code Mode ownership, metric, folding-boundary, navigation, and label-rejection decisions; updated the domain glossary, product spec, design debt record, and tracker before implementation. / 2026-07-31：实现前已确认语义类别、精确归一化准入、Code Mode ownership、指标、折叠边界、导航与 label 拒绝决策，并同步更新领域词汇表、产品规格、设计技术债记录与 tracker。
- 2026-07-31: Added `src/shared/plan-facet.js`, migrated metrics, folding, navigation, browser entry, and package coverage, and retained `isUpdatePlanEvent` only as a compatibility alias over the exact shared predicate. / 2026-07-31：增加 `src/shared/plan-facet.js`，迁移指标、折叠、导航、浏览器入口与 package 覆盖，并只把 `isUpdatePlanEvent` 作为精确共享 predicate 的兼容 alias 保留。
- 2026-07-31: Added table-driven exact/negative admission tests, isolated and mirrored Plan Artifact integration fixtures, Code Mode declaration/projection exclusion coverage, consumer matrix assertions, and unchanged detail assertions. Focused validation passed 105/105 and full Node validation passed 318/318. / 2026-07-31：增加表驱动的精确/负向准入测试、独立与镜像 Plan Artifact 集成 fixture、Code Mode 声明/projection 排除覆盖、消费方矩阵断言与不变 detail 断言。聚焦验收通过 105/105，完整 Node 验收通过 318/318。
- 2026-07-31: Regenerated the browser bundle. Browser validation passed 83/83, package smoke and generated-asset checks passed, syntax and diff checks passed, and the default local server was restarted with the updated code and returned HTTP 200 on port 17890. / 2026-07-31：重新生成浏览器 bundle。Browser 验收通过 83/83，package smoke 与生成资产检查通过，语法与 diff 检查通过；默认本地服务已使用更新后的代码重启，并在 17890 端口返回 HTTP 200。
- 2026-07-31: Closeout follow-up added the formal sanitized `observed-update-plan.jsonl` raw lifecycle fixture. Its end-to-end test proves unique phase-span association, child-owned Plan membership and count, public parent context, both Plan navigation categories, and exclusion of the owning operation and its declared projection. Focused validation passed 28/28 and the expanded full Node suite passed 319/319. / 2026-07-31：收尾跟进增加正式脱敏的 `observed-update-plan.jsonl` raw lifecycle fixture。其端到端测试证明唯一 phase-span 关联、子事件自有 Plan membership 与计数、公开父级上下文、两个 Plan 导航类别，以及所属 operation 与其声明 projection 的排除行为。聚焦验收通过 28/28，扩展后的完整 Node 测试通过 319/319。
