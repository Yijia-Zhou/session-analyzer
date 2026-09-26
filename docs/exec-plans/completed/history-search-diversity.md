# History search diversity / 历史搜索会话覆盖

Status: complete, following reviewed MVP commit `9e5b742`. / 状态：已完成，基于已审查 MVP 提交 `9e5b742`。

## Purpose and baseline / 目的与基线

The initial discussion required that one verbose session should not occupy an entire candidate page and conceal earlier reasons or later reversals. A synthetic baseline with 120 matching events in the newest session and one constraint in each of two older sessions returned eight events from only the newest session, despite 122 total matches. / 初始讨论要求避免冗长会话占满候选页，遮蔽早期理由或后续推翻。合成基线中，最新会话有 120 个命中，两个更早会话各有一条约束；总计 122 个命中，但前八条全部来自最新会话。

## Contract / 契约

- Default `order=diverse` interleaves matching sessions: first eligible event of each session, then second, and so on. Session ties retain newest-update-first ordering; events within a session retain unfiltered presentation order after candidate predicates and artifact exclusion. This is diversity, not inferred semantic relevance. / 默认 `order=diverse` 交错匹配会话：先各会话首个合格事件，再各会话第二个，依次类推。会话之间仍按最近更新排序；会话内候选应用条件及工件排除后保留原呈现顺序。这是会话覆盖，不是推断语义相关性。
- `order=session` preserves the previous grouped order. `session=<sessionId>` restricts search to a known indexed Session; unknown IDs fail explicitly. Both are available as CLI flags and JSON fields. / `order=session` 保留原按会话分组顺序。`session=<sessionId>` 将搜索限定到已索引会话，未知 ID 明确报错。两者均提供 CLI 参数及 JSON 字段。
- Cursors bind scope, query and order, and continue after the last returned rank. Changing page limits or byte budgets never discards a candidate or repeats one. All matching events remain pageable. Selection retains only the bounded candidate page, not all matching text. / 游标绑定范围、查询及排序，从最后返回的排序位置续读。改变页数或字节预算不丢失、不重复候选；全部命中均可翻页。选择仅保留有界候选页，不保留全部命中文本。
- Existing canonical events, source parsing, Raw ownership and UI search semantics stay intact. / 保持规范事件、来源解析、Raw 归属及 UI 搜索语义。

## Work and acceptance / 工作与验收

- [x] Implement bounded candidate ordering, cursor continuation and scoped session searches. / 实现有界候选排序、游标续读及会话限定搜索。
- [x] Add CLI/API options and synchronized product/design/guide text. / 增加 CLI／API 参数，同步产品／设计／指南。
- [x] Verify three-session discovery, complete pagination under changing limits/budgets, artifact exclusion, and scope/cursor rejection using synthetic source-backed tests. / 通过合成来源测试验证三会话发现、改变预算／页数后完整翻页、工件排除以及范围／游标拒绝。
- [x] Compare the same baseline, run relevant package checks, and complete an independent Astra review/fix loop. / 对照相同基线，运行相关安装包检查，并完成独立 Astra 审查／修复循环。

## Recorded results / 已记录结果

The same three-session corpus now exposes all three sessions in the first eight candidates, including the two older constraints. Both orders retain 122 total matches. The response grew from 5,813 to 5,931 UTF-8 JSON bytes, including new scope/order metadata and different evidence; this is improved first-page session coverage, not a token-efficiency or latency benchmark. / 同一份三会话语料的前八条候选现在覆盖全部三个会话，包含两条较早约束。两种排序均保留 122 个总命中。响应从 5,813 增至 5,931 个 UTF-8 JSON 字节，包含新增范围／排序 metadata 及不同证据；这证明首页会话覆盖改善，不是 token 效率或时延基准。

Focused history tests passed 32/32; the full Node suite passed 1,253/1,253. Installed-package checks passed the existing UI/history flows plus new order/session fields for all three sources. Independent Astra review reported no remaining actionable findings; its separate six-session corpus passed 41 contract checks across layers, filters/scopes, uneven match counts and changing page/byte budgets without omissions or duplicates. / 历史聚焦测试 32/32、完整 Node 套件 1,253/1,253 通过。安装包检查通过三来源的既有 UI／history 流程及新增 order/session 字段。独立 Astra 审查报告无剩余可操作问题；独立六会话语料通过 41 项跨层、筛选／范围、不均衡命中数及变化页数／字节预算的契约检查，无遗漏或重复。

Further work from the original discussion remains separate: explicit file-association clues, richer recorded relationships, later-change discovery, larger evaluation corpora and uniform total-token/call accounting. The 96-trial matrix and semantic retrieval are not implied by this increment's completion. / 原讨论中的后续工作另行推进：明确文件关联线索、更丰富已记录关系、后续变更发现、更大评估语料及统一总 token／调用核算。本增量完成不意味着已完成 96 次矩阵或语义检索。
