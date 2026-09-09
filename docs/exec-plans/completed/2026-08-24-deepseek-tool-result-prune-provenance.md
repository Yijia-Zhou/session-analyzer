# DeepSeek tool-result prune provenance / DeepSeek 工具结果裁剪来源追溯

## Status / 状态

- Status: completed and archived after all local implementation and replay gates passed; narrowly scoped follow-up, not a new DeepSeek phase. GitHub Actions remains NOT RUN because no commit or push was authorized in this session. / 状态：全部本地实现与 replay gate 通过后完成并归档；属于窄范围后续，不是新的 DeepSeek 阶段。本次会话未获授权 commit 或 push，因此 GitHub Actions 仍为 NOT RUN。
- Baseline: `dsh-compaction-prune-provenance@44a141a31ce42a81ea6be6143ee249b9188eb900`, clean worktree; ancestry includes `towards-0.2.0`. / 基线：干净工作区上的 `dsh-compaction-prune-provenance@44a141a31ce42a81ea6be6143ee249b9188eb900`；祖先包含 `towards-0.2.0`。
- Upstream authority: DeepSeek Harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, `@deepseek-ai/dsh 0.1.1-rc.2`. / 上游权威：DeepSeek Harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，`@deepseek-ai/dsh 0.1.1-rc.2`。

## Objective / 目标

Relate one original Main tool operation, its later `compaction/prune` Protocol event, and the replacement `tool/result` Protocol event through exact adapter-owned provenance. Keep all three Logical Events and their existing disjoint Raw ownership; do not replace the historical result, add Main events, widen canonical contracts, or add browser source branches. / 通过精确、由 adapter 自有的 provenance，把一条原始 Main 工具操作、其后的 `compaction/prune` Protocol 事件与替换 `tool/result` Protocol 事件关联起来。保留三条 Logical Event 及其既有且互斥的 Raw ownership；不替换历史结果、不增加 Main 事件、不扩展 canonical contract，也不增加 browser 来源分支。

## Accepted evidence / 已接受证据

- Ignored current-writer evidence is immutable under `tmp/dsh-current-writer-*`; tests never depend on `tmp/`. / `tmp/dsh-current-writer-*` 下已忽略的 current-writer 证据保持不可变；测试绝不依赖 `tmp/`。
- Current writer emitted original `tool/result` seq 47, singleton prune seq 49, and replacement seq 50 with exact replace range and `sourceEventSeqs:[47]`; original and replacement share the durable call ID. / 当前 writer 产生原始 `tool/result` seq 47、singleton prune seq 49，以及带精确 replace range 与 `sourceEventSeqs:[47]` 的 replacement seq 50；原始与替换结果共享持久 call ID。
- Producer source appends prune and replacement synchronously, but seq identities—not adjacency—are the correlation authority. / Producer 源码同步追加 prune 与 replacement，但关联权威是 seq identity，而不是相邻关系。

## Invariants and architecture pressure / 不变量与架构压力

1. `compaction/prune` is Protocol provenance, not another Main operation. / `compaction/prune` 是 Protocol provenance，不是另一条 Main operation。
2. The original tool result and pruned model-surface replacement are distinct facts. / 原始工具结果与经裁剪的模型 surface 替换是不同事实。
3. Surface replacement never rewrites historical tool-output ownership. / Surface replacement 永不重写历史工具输出 ownership。
4. Correlation requires exact, unique source seq identities plus matching durable call ID; adjacency is only an integrity observation. / 关联要求精确且唯一的来源 seq identity 与匹配的持久 call ID；相邻性只作为完整性观察。
5. Seeded child continuation cannot claim inherited parent result evidence. / Seeded child continuation 不得认领继承自 parent 的 result 证据。
6. No canonical Session expansion or shared browser/source branch is justified. / 当前不支持扩展 canonical Session，也不支持增加共享 browser／source 分支。
7. Whole-file DeepSeek Detail/Raw readback performance debt remains open and unchanged. / DeepSeek Detail／Raw 全文件回读性能债保持开放且不变。

## Milestones / 里程碑

- [x] M1 — add a byte-protected sanitized format-v0 fixture and focused valid/defensive tests. / 增加受字节保护的脱敏 format-v0 fixture 与聚焦 valid／defensive 测试。
- [x] M2 — implement exact adapter-owned three-way provenance and Structured Detail/event refs. / 实现精确的 adapter 自有三向 provenance 与 Structured Detail／event ref。
- [x] M3 — run current-writer and six-session historical read-only replay gates. / 运行 current-writer 与六 Session 历史语料只读 replay gate。
- [x] M4 — update current spec/design/changelog, complete all validation, review, and archive this plan. / 更新当前 spec／design／changelog，完成全部验证、评审并归档本计划。

## Validation / 验证

- Focused prune provenance tests. / 聚焦 prune provenance 测试。
- All DeepSeek tests; source-adapter contract/conformance; affected Detail tests. / 全部 DeepSeek 测试；source-adapter contract／conformance；受影响 Detail 测试。
- Full Node suite, `release:check`, browser suite, package smoke, and `git diff --check`. / 完整 Node suite、`release:check`、browser suite、package smoke 与 `git diff --check`。
- Read-only replay of both ignored current-writer Sessions and the accepted six-session historical corpus. / 只读 replay 两份 ignored current-writer Session 与已接受的六 Session 历史语料。
- Full GitHub Actions matrix after push; until pushed, report it as NOT RUN. / Push 后要求完整 GitHub Actions matrix；push 前报告为 NOT RUN。

## Non-goals / 非目标

No approvals, hooks, command lifecycle, team, schedule, feedback, plan mode, auxiliary web-search requests, general compaction redesign, SQLite, future formats, or Raw random-access optimization. / 不处理 approval、hook、command lifecycle、team、schedule、feedback、plan mode、辅助 web-search request、通用 compaction redesign、SQLite、未来格式或 Raw random-access 优化。

## Progress log / 进度日志

- 2026-08-24: verified clean intended branch and exact baseline; accepted current-writer evidence and current upstream producer source; selected adapter-owned metadata plus existing source-neutral `event_refs`, with no canonical/browser change. / 已核验干净的预期分支与精确基线；接受 current-writer 证据与当前上游 producer 源码；选择 adapter 自有 metadata 加既有来源中立 `event_refs`，不修改 canonical／browser。
- 2026-08-24: implemented exact singleton seq/range/source-seq/call-ID correlation after child seed ownership; preserved all three existing Logical Events, their layers, historical result, and disjoint Raw ownership. / 实现 child seed ownership 后的精确 singleton seq／range／source-seq／call-ID 关联；保留三条既有 Logical Event、各自 layer、历史结果与不相交 Raw ownership。
- 2026-08-24: added the byte-protected sanitized current-writer-shaped fixture plus valid, malformed, mismatch, ambiguity, non-causal, non-adjacent, and inherited-parent tests; focused suite passed 11/11. / 新增受字节保护的脱敏 current-writer-shaped fixture，以及 valid、malformed、mismatch、ambiguity、non-causal、non-adjacent 与 inherited-parent 测试；聚焦 suite 11／11 通过。
- 2026-08-24: DeepSeek suite passed 65/65; source-adapter/Detail suite passed 73/73; `release:check` passed with generated assets current, full Node suite 716/716, and three-source package smoke; browser suite passed 121/121; `git diff --check` passed. / DeepSeek suite 65／65 通过；source-adapter／Detail suite 73／73 通过；`release:check` 通过，其中 generated asset 保持最新、完整 Node suite 716／716、三来源 package smoke 通过；browser suite 121／121 通过；`git diff --check` 通过。
- 2026-08-24: immutable current-writer replay verified hashes and Index/Materialized query parity, with smoke 42 Raw／23 Logical／6 Main／17 Protocol／0 prune relations and prune evidence 50 Raw／27 Logical／7 Main／20 Protocol／one exact three-event relation; both had zero target Raw ownership collisions. / 不可变 current-writer replay 验证 hash 与 Index／Materialized query parity；smoke 为 42 Raw／23 Logical／6 Main／17 Protocol／0 prune relation，prune 证据为 50 Raw／27 Logical／7 Main／20 Protocol／一条精确三 event relation；两者 target Raw ownership collision 均为零。
- 2026-08-24: the accepted six-session historical replay preserved exact Main counts, Phase 2A–2D semantics, Code Mode 12/35, retry/Goal/Todo/Permission/inbox oracles, zero false prune relations, and zero target Raw ownership collisions. Review found no blocking defect after tightening prune causality and token-count validation. / 已接受六 Session 历史 replay 保持精确 Main count、Phase 2A–2D 语义、Code Mode 12／35、retry／Goal／Todo／Permission／inbox oracle、零 false prune relation 与零 target Raw ownership collision。收紧 prune 因果顺序与 token-count 验证后，评审未发现阻塞缺陷。

## Result / 结果

The analyzer now exposes logical provenance among the original Main tool operation, `compaction/prune` Protocol event, and replacement `tool/result` Protocol event only when current-writer durable identities are exact, causal, child-owned, and unique. Detail keeps the historical result on the original operation and renders only the pruned model-surface content on the replacement. No Main count, Raw ownership, canonical Session contract, shared relation contract, browser branch, or other deferred DeepSeek family changed. The whole-file DeepSeek Detail/Raw readback debt remains open. / Analyzer 现在只在 current-writer 持久 identity 精确、具因果顺序、child-owned 且唯一时，才暴露原始 Main 工具 operation、`compaction/prune` Protocol event 与 replacement `tool/result` Protocol event 之间的逻辑 provenance。Detail 把历史结果保留在原始 operation 上，只在 replacement 上呈现经过 prune 的模型 surface 内容。Main count、Raw ownership、canonical Session contract、共享 relation contract、browser 分支及其它 deferred DeepSeek family 均未改变。DeepSeek Detail／Raw 整文件回读债务继续保持开放。
