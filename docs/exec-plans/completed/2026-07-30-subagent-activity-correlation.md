# Subagent activity typed correlation / Subagent 活动带类型关联

## Objective / 目标

Use minimized synthetic fixtures derived from aggregate real-corpus evidence to model exact `event_msg.sub_agent_activity` rows as Subagent Activity Observations. When the same Session contains a Direct Tool Call for an Agent Coordination operation whose call ID exactly equals the observation's `event_id`, retain the observation as a traceability-only Raw Reference on that existing Logical Event. Keep observations without a same-Session owner in Protocol and Raw fallback. / 使用根据真实语料聚合证据构造的最小化合成 fixture，把精确的 `event_msg.sub_agent_activity` 记录建模为 Subagent 活动观察。当同一会话中存在 Agent 协调直接工具调用，且其 call ID 与观察记录的 `event_id` 精确相等时，把该观察作为仅用于可追溯性的原始引用保留在现有逻辑事件上。没有同会话 owner 的观察继续进入协议层与原始层兜底。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-30 / 开始日期：2026-07-30
- Completed: 2026-07-30 / 完成日期：2026-07-30
- Related context: `CONTEXT.md` / 相关上下文：`CONTEXT.md`
- Related design: `docs/design-docs/codex-protocol-event-coverage.md`, `docs/design-docs/logical-event-timeline.md` / 相关设计：`docs/design-docs/codex-protocol-event-coverage.md`、`docs/design-docs/logical-event-timeline.md`
- Triggering completed plan: `docs/exec-plans/completed/2026-07-30-tool-lifecycle-family-contract.md` / 触发本工作的已完成计划：`docs/exec-plans/completed/2026-07-30-tool-lifecycle-family-contract.md`

## Evidence baseline / 证据基线

A read-only scan covered 478 real Codex JSONL files from active and archived local session storage, approximately 980 MB and 313,519 rows at the frozen scan snapshot. It parsed exact top-level `event_msg.payload.type` values without persisting or displaying private payload values. `sub_agent_activity` appeared 871 times in 68 files at the frozen snapshot and continued growing during verification; every observed row contained non-empty `event_id`, `agent_thread_id`, and `agent_path` strings. A later structural pass found 533 distinct `event_id` values, all matching real Agent Coordination response-item call IDs somewhere in the local corpus. Of 873 observation occurrences in that later snapshot, 533 had a same-file owner and 340 were replicated into other Session Transcripts without the owning call row. / 只读扫描覆盖活动与归档本地 session storage 中的 478 个真实 Codex JSONL 文件；固定扫描快照约 980 MB、313,519 行。扫描只解析精确的顶层 `event_msg.payload.type`，不持久化或展示私有 payload 值。固定快照中 `sub_agent_activity` 出现 871 次、分布于 68 个文件，并在复核期间继续增长；每条观察记录都包含非空字符串 `event_id`、`agent_thread_id` 与 `agent_path`。后续结构检查发现 533 个不同的 `event_id`，全部能在本地语料某处匹配真实 Agent 协调 response-item call ID。在后续快照的 873 条观察中，533 条在同文件具有 owner，另有 340 条复制到不含 owner call row 的其他会话转录。

The same scan found 132 exact `view_image_tool_call` rows in 9 real files. Every occurrence shared its `call_id` with an independently supported `response_item.function_call(name = view_image)` and its output in the same file. Existing call grouping already preserves that event row as a Raw Reference, so this plan adds a regression fixture but does not admit a new lifecycle member or presentation path for it. / 同一扫描在 9 个真实文件中发现 132 条精确 `view_image_tool_call` 记录。每条记录都在同文件内与独立受支持的 `response_item.function_call(name = view_image)` 及其 output 共享 `call_id`。现有 call grouping 已把该 event 记录保留为原始引用，因此本计划只增加回归 fixture，不为它准入新的生命周期成员或展示路径。

## Model and invariants / 模型与不变量

1. A Subagent Activity Observation is not a Tool Lifecycle Family member and does not create a second Main Timeline event. / Subagent 活动观察不是工具生命周期族成员，也不创建第二个主时间线事件。
2. `event_id` remains a typed Subagent Activity identity. It may correlate to a Direct Tool Call call ID only under the exact `sub_agent_activity` shape and exact Agent Coordination owner rule; it is never copied into the generic Raw Record `callId`. / `event_id` 保持为带类型的 Subagent 活动 identity。只有在精确 `sub_agent_activity` 形态与精确 Agent 协调 owner 规则下，它才可以关联直接工具调用 call ID；不得把它复制进泛化的原始记录 `callId`。
3. Correlation is Session-local. An observation replicated into another Session without its owner remains a Protocol event with its own Raw Reference. / 关联限制在会话内。复制到其他会话、但缺少 owner 的观察继续作为协议事件并保留自己的原始引用。
4. An attached observation contributes traceability only. It must not change the owner's ID, timestamp, turn, label, preview, status, severity, search text, metrics, folding, representative selection, or outcome. / 已附加观察只贡献可追溯性；不得改变 owner 的 ID、时间戳、turn、label、preview、status、severity、search text、metrics、folding、代表记录选择或 outcome。
5. Exact `event_id` equality is insufficient when the local owner is not an Agent Coordination Direct Tool Call. Unknown event shapes and collisions remain Protocol/Raw fallback. / 当本地 owner 不是 Agent 协调直接工具调用时，仅有精确 `event_id` 相等仍不充分。未知 event 形态与碰撞继续进入协议层／原始层兜底。
6. `agent_thread_id`, `agent_path`, and `occurred_at_ms` remain available through the Raw Record but are not promoted into Main search or generic correlation fields in this increment. / `agent_thread_id`、`agent_path` 与 `occurred_at_ms` 继续通过原始记录可见，但本增量不把它们提升进主时间线搜索或泛化 correlation 字段。

## Implementation phases / 实施阶段

### Phase 1: fixture-first observation boundary / 第一阶段：fixture 优先的观察边界

- Add parser coverage for exact typed `sub_agent_activity.event_id` extraction without populating `callId`. / 为精确、带类型的 `sub_agent_activity.event_id` 提取增加 parser 覆盖，同时不填充 `callId`。
- Add logical fixtures for a same-Session Agent Coordination owner, a cross-Session or local orphan, a non-coordination ID collision, missing identity, and multiple observations. / 增加逻辑 fixture，覆盖同会话 Agent 协调 owner、跨会话或本地 orphan、非协调 ID 碰撞、缺失 identity 与多条观察。
- Add a real-shape-derived synthetic `view_image_tool_call` mirror fixture that proves current Raw Reference ownership without semantic contribution. / 增加根据真实形态构造的合成 `view_image_tool_call` 镜像 fixture，证明当前原始引用 ownership 且不贡献语义。

### Phase 2: bounded typed correlation / 第二阶段：有界带类型关联

- Build a Session-local index of exact Subagent Activity Observation identities. / 构建会话内精确 Subagent 活动观察 identity 索引。
- Attach matching observations only after the ordinary call group proves an Agent Coordination owner. / 仅在普通 call group 证明存在 Agent 协调 owner 后，才附加匹配观察。
- Consume attached observation rows from Protocol Logical Event construction while preserving them in the owner's Raw References and Raw Layer. / 已附加观察不再构建协议层逻辑事件，但继续保留在 owner 的原始引用与原始层中。

### Phase 3: product and documentation convergence / 第三阶段：产品与文档收敛

- Record the bounded Protocol-layer deduplication and unchanged Main event semantics in the product spec and logical timeline design. / 在产品规格与逻辑时间线设计中记录有界的协议层去重和不变的主事件语义。
- Update protocol coverage and tech-debt observations from “unobserved” to the measured real-corpus result. / 把协议覆盖与技术债中的“尚未观察”更新为测得的真实语料结果。
- Keep all other upstream-only lifecycle shapes at `fixture TODO / coverage update`. / 其他仅由上游得知的生命周期形态继续保持 `fixture TODO / coverage update`。

## Acceptance criteria / 验收标准

1. Exact `sub_agent_activity` rows expose a typed event identity without receiving generic `callId` admission. / 精确 `sub_agent_activity` 记录暴露带类型的 event identity，但不获得泛化 `callId` 准入。
2. A same-Session exact match to an Agent Coordination Direct Tool Call adds the observation Raw Reference to that existing Main event and removes only the redundant Protocol event. / 同会话内与 Agent 协调直接工具调用精确匹配时，把观察原始引用附加到现有主事件，并且只移除冗余协议事件。
3. Main event semantics and search output remain identical before and after the observation is attached. / 观察附加前后的主事件语义与搜索输出保持相同。
4. Local or cross-Session orphans, missing identities, non-coordination collisions, and unknown lookalikes remain Protocol/Raw fallback. / 本地或跨会话 orphan、缺失 identity、非协调碰撞与未知相似类型继续进入协议层／原始层兜底。
5. The real-shaped `view_image_tool_call` mirror remains a traceability-only Raw Reference and receives no new lifecycle admission. / 真实形态的 `view_image_tool_call` 镜像继续作为仅可追溯的原始引用，不获得新的生命周期准入。
6. Focused source/logical/integration coverage, full Node tests, browser tests, generated-asset checks, package checks, and `git diff --check` pass. / 聚焦 source／logical／integration 覆盖、完整 Node 测试、browser 测试、生成资产检查、package 检查与 `git diff --check` 全部通过。

## Progress log / 进度日志

- 2026-07-30: Completed the read-only aggregate real-corpus scan and independent structural verification. Two exact unadmitted types were observed: the fully mirrored `view_image_tool_call` shape and the high-frequency, cross-Session-replicated `sub_agent_activity` shape. / 2026-07-30：完成只读真实语料聚合扫描与独立结构复核。观察到两个精确未准入类型：完全镜像的 `view_image_tool_call` 形态，以及高频、跨会话复制的 `sub_agent_activity` 形态。
- 2026-07-30: Defined Subagent Activity Observation in the domain language and opened this bounded implementation plan. / 2026-07-30：在领域语言中定义 Subagent 活动观察，并建立本有界实现计划。
- 2026-07-30: Added the exact typed source extractor and Session-local correlation path. Matching observations are appended after the Agent Coordination owner's semantic Raw References and consumed only from Protocol Logical Event construction; generic `callId`, Main event semantics, and cross-Session behavior remain unchanged. / 2026-07-30：增加精确的带类型 source extractor 与会话内 correlation 路径。匹配观察会附加在 Agent 协调 owner 的语义原始引用之后，并且只从协议层逻辑事件构建中消费；泛化 `callId`、主事件语义与跨会话行为保持不变。
- 2026-07-30: Added source, logical, and full build-index fixtures for exact matches, multiple observations, orphans, cross-Session replicas, non-coordination collisions, missing identities, unknown lookalikes, and real-shaped view-image mirrors. Full Node coverage passed 314/314, browser coverage passed 83/83, generated assets were current, package smoke passed, and documentation table validation passed. / 2026-07-30：增加 source、logical 与完整 build-index fixture，覆盖精确匹配、多条观察、orphan、跨会话副本、非协调碰撞、缺失 identity、未知相似类型，以及真实形态的 view-image 镜像。完整 Node 覆盖 314/314 通过，browser 覆盖 83/83 通过，生成资产保持最新，package smoke 通过，文档表格检查通过。
